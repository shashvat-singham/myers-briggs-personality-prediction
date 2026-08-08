import { NextResponse } from "next/server";
import { PERSONAS, questionsForPrompt } from "@/lib/personas";
import { QUESTIONS } from "@/lib/scoring";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gemini-3.5-flash-lite";

/**
 * Have the model sit the instrument as a named persona.
 *
 * The point is a coherent respondent, not speed: it answers all seventy items
 * in one pass with the whole sheet in view, so its answers stay consistent
 * across an axis in a way independent per-item sampling cannot be.
 *
 * The response is a flat array of 70 integers, one per item in order. Sending
 * the option prose back would triple the output for no gain — the client owns
 * the option order, and index 0–3 is [strongly A, slightly A, slightly B,
 * strongly B].
 */
const ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: {
    reasoning: {
      type: "STRING",
      description:
        "One or two sentences on how this persona approaches the world, for the user to read.",
    },
    answers: {
      type: "ARRAY",
      description: `Exactly ${QUESTIONS.length} integers between 0 and 3, one per item in order.`,
      items: { type: "INTEGER" },
    },
  },
  required: ["reasoning", "answers"],
} as const;

const SYSTEM_PROMPT = [
  "You are completing a 70-item Myers-Briggs style questionnaire in character as a specific persona.",
  "",
  "Each item offers two opposing statements, A and B. Answer on a 4-point forced-choice scale:",
  "  0 = strongly A    1 = slightly A    2 = slightly B    3 = strongly B",
  "",
  "Answer as the persona actually is, not as they would like to be seen. Stay consistent:",
  "a real respondent leans the same way across items that probe the same trait, so your answers",
  "should hold together rather than reading as independent choices. Use the slight options where",
  "the persona is genuinely ambivalent — a sheet answered entirely at full strength is not credible.",
  "",
  `Return exactly ${QUESTIONS.length} integers in item order.`,
].join("\n");

function errorResponse(error: string, message: string, status: number) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // The client falls back to the local simulator, which is a legitimate
    // outcome rather than a failure — say so plainly.
    return errorResponse(
      "not_configured",
      "GEMINI_API_KEY is not set on this deployment.",
      501,
    );
  }

  let personaId: string | undefined;
  try {
    ({ personaId } = (await request.json()) as { personaId?: string });
  } catch {
    // No body is fine — a persona gets picked below.
  }

  const persona =
    PERSONAS.find((p) => p.id === personaId) ??
    PERSONAS[Math.floor(Math.random() * PERSONAS.length)];

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: [
                    `Persona: ${persona.label} — ${persona.blurb}`,
                    "",
                    "Items:",
                    questionsForPrompt(),
                  ].join("\n"),
                },
              ],
            },
          ],
          generationConfig: {
            // Run warm: two people matching the same persona description would
            // not answer identically, and a fixed sheet per persona would make
            // repeat runs pointless.
            temperature: 1,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
            responseSchema: ANSWER_SCHEMA,
          },
        }),
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("autofill_upstream_failed", upstream.status, detail.slice(0, 300));
      return errorResponse("upstream_failed", "The model couldn't complete the sheet.", 502);
    }

    const payload = (await upstream.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(raw) as { reasoning?: string; answers?: number[] };

    if (!Array.isArray(parsed.answers) || parsed.answers.length < QUESTIONS.length) {
      // A short sheet is not worth salvaging: padding it with simulated answers
      // would label a half-generated run as if the model produced all of it.
      throw new Error(
        `expected ${QUESTIONS.length} answers, got ${parsed.answers?.length ?? "none"}`,
      );
    }

    // Map positionally onto question numbers — the array is in item order.
    const answers: Record<number, number> = {};
    QUESTIONS.forEach((q, i) => {
      const value = parsed.answers![i];
      answers[q.no] = Number.isInteger(value) && value >= 0 && value <= 3 ? value : 1;
    });

    return NextResponse.json({
      source: "ai",
      persona: persona.label,
      reasoning: parsed.reasoning,
      answers,
    });
  } catch (error) {
    console.error("autofill_failed", error);
    return errorResponse("upstream_failed", "The model couldn't complete the sheet.", 502);
  }
}
