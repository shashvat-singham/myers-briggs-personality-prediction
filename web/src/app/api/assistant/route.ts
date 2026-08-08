/* Assistant backend: verifies the caller is a signed-in Firebase user, then
   streams an answer from Gemini grounded in the context the client sends —
   the user's own results plus their type profile. The key lives only in the
   server environment and never reaches the browser.

   Two things dominate latency here, and both are handled:
     - reasoning models spend most of their budget thinking before emitting a
       single token, and this assistant summarizes context it has already been
       given, so a reasoning budget buys nothing. gemini-3.5-flash-lite does no
       thinking and returns in about a second.
     - waiting for the whole completion before responding. The answer is
       streamed instead, so text appears as it is generated. */

export const runtime = "nodejs";

const GEMINI_MODEL = "gemini-3.5-flash-lite";

const SYSTEM_PROMPT = `You are the assistant embedded in Sixteen, a Myers-Briggs personality assessment.

Answer using the CONTEXT provided (the user's own results and the profile for their type). Be concise and concrete — a short paragraph or a few bullets. When the question is about their result, use the actual numbers from the snapshot rather than speaking in generalities.

Be honest about the instrument's limits. The four dichotomies are continuous, not bimodal, so a narrow margin genuinely means the axis is unresolved rather than that the user is "a weak I". Test-retest reliability is moderate and type can change between attempts. Never frame a type as a constraint on what someone can do, and never present it as a basis for hiring, placement, or a decision about another person.

If something isn't covered by the context, say so plainly rather than inventing details.`;

type HistoryItem = { role: "user" | "model"; text: string };

/* Verified tokens are cached briefly so only the first message in a session
   pays for the round trip to Google. Firebase ID tokens live an hour; five
   minutes is well inside that and bounds how long a revoked token works. */
const VERIFY_TTL = 5 * 60_000;
const verified = new Map<string, number>();

async function verifyIdToken(idToken: string): Promise<boolean> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return false;

  const hit = verified.get(idToken);
  if (hit && Date.now() < hit) return true;

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { users?: unknown[] };
    const ok = Array.isArray(data.users) && data.users.length > 0;
    if (ok) {
      // Keep the map from growing without bound on a long-lived instance.
      if (verified.size > 500) verified.clear();
      verified.set(idToken, Date.now() + VERIFY_TTL);
    }
    return ok;
  } catch {
    return false;
  }
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  let body: { idToken?: unknown; question?: unknown; context?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid request.", 400);
  }

  const { idToken, question, context } = body;
  if (typeof idToken !== "string" || typeof question !== "string" || !question.trim()) {
    return errorResponse("Missing fields.", 400);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "The assistant isn't configured on this deployment. Set the GEMINI_API_KEY secret.",
      503,
    );
  }

  if (!(await verifyIdToken(idToken))) {
    return errorResponse("Please sign in again.", 401);
  }

  const history: HistoryItem[] = Array.isArray(body.history)
    ? (body.history as HistoryItem[])
        .filter(
          (h) => h && (h.role === "user" || h.role === "model") && typeof h.text === "string",
        )
        .slice(-6)
    : [];

  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text.slice(0, 2000) }] })),
    {
      role: "user",
      parts: [
        {
          text: `CONTEXT:\n${
            typeof context === "string" ? context.slice(0, 12000) : "(none)"
          }\n\nQUESTION: ${question.slice(0, 2000)}`,
        },
      ],
    },
  ];

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
      }),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("assistant_upstream_failed", upstream.status, detail.slice(0, 300));
    const hint =
      upstream.status === 401 || upstream.status === 403
        ? " (GEMINI_API_KEY was rejected — check the key in AI Studio.)"
        : upstream.status === 404
          ? ` (The model ${GEMINI_MODEL} isn't available to this project.)`
          : "";
    return errorResponse(`The assistant couldn't answer right now.${hint}`, 502);
  }

  /* Re-emit only the answer text as a plain token stream. The client appends
     each chunk as it lands, so the first words show up in well under a second
     instead of after the whole completion. */
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let emitted = false;

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last partial line for the next chunk.
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const text =
            json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
          if (text) {
            emitted = true;
            controller.enqueue(encoder.encode(text));
          }
        } catch {
          // A partial JSON payload will arrive complete in a later chunk.
        }
      }
    },
    flush(controller) {
      if (!emitted) {
        controller.enqueue(
          encoder.encode("The assistant returned an empty answer. Try rephrasing."),
        );
      }
    },
  });

  return new Response(upstream.body.pipeThrough(stream), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
