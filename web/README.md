# Sixteen — MBTI personality assessment

A 70-item Myers–Briggs assessment with graded forced-choice responses, full type
profiles, and a per-account result history. Next.js 16 (App Router) on the
front, Firebase Authentication and Realtime Database behind it, deployable to
Vercel or as a container.

```
browser ──▶ Next.js (App Router)
              ├── static: landing, 16 type profiles, methodology
              ├── client: Firebase Auth + Realtime Database (users/<uid>/results)
              └── routes: /api/autofill  → Gemini  (fills the sheet in character)
                          /api/assistant → Gemini  (answers about your result)
```

There is no separate backend. Scoring runs in the browser, results are written
straight to the Realtime Database by the authenticated client, and the two API
routes exist only because they hold model credentials that must not reach the
browser.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in the Firebase values
npm run dev                    # http://localhost:3000
```

Firebase console → Project settings → General → Your apps → Web app → SDK setup
gives you every `NEXT_PUBLIC_FIREBASE_*` value. Then, in the console:

- **Authentication → Sign-in method** — enable **Google** and **Email/Password**.
- **Authentication → Settings → Authorized domains** — add your deploy domain.
- **Realtime Database** — create the instance, then push the rules:

```bash
npm i -g firebase-tools && firebase login
firebase deploy --only database --project <your-project-id>
```

The app degrades honestly when a credential is missing: without the Firebase
values sign-in is disabled and results stay in the browser; without
`GEMINI_API_KEY` the assistant reports that it is unconfigured and the auto-fill
falls back to a local simulator, labelling its results as simulated.

## The instrument

70 forced-choice items — 10 on E/I, 20 each on S/N, T/F and J/P. The published
version is binary; this one splits each pole into *strongly* (2 points) and
*slightly* (1 point), giving four options per item. That keeps the forced choice
(no neutral midpoint, so no central-tendency bias) while recording the magnitude
the binary format discards.

An axis reports the winner's share of the weight actually cast, so 50% is a dead
tie and 100% would be every item answered strongly one way. Exact ties resolve
toward I, N, F or P. The full derivation, along with the psychometric
limitations this instrument does not overcome, is on `/methodology`.

## Model-backed features

**Auto-fill** (`/api/autofill`, Gemini). Completes the whole sheet in character
as one of eight personas. The model sees all 70 items in a single pass rather
than being sampled per item, which is what keeps the answers internally
consistent — independent per-item sampling produces a near-tie on every axis,
the least interesting possible result. Falls back to a local simulator that
draws a hidden true type plus per-axis conviction. Both paths are recorded on
the stored result as `ai` or `simulated` and are never presented as human
responses; answering any item by hand reverts the sheet to `manual`.

**Assistant** (`/api/assistant`, Gemini). A floating panel that appears only for
signed-in users, since every answer is grounded in that account's own results.
The route verifies the caller's Firebase ID token against the Identity Toolkit
before spending a token, and streams the reply so the first words land in well
under a second.

## Data model

```
users/{uid}/results/{pushKey}
  type, axes[], tally{}, answers{}, durationMs, createdAt, serverCreatedAt,
  source: manual | ai | simulated, persona?
```

Push keys embed their creation time and sort lexicographically, so
`orderByKey().limitToLast(n)` is exactly "the n most recent" — no index, no
extra field. RTDB cannot sort descending, so the slice is reversed client-side.

`database.rules.json` denies everything by default and grants a user read and
write only under their own `uid`, with per-field validation on writes. A test
taken while signed out lives in `localStorage` and moves into the account on
sign-in.

## Deploying

**Vercel** — live at [shashvat-mbti.vercel.app](https://shashvat-mbti.vercel.app).
The project is connected to this repository with **Root Directory set to
`web`**, so a push to `main` builds and promotes to production on its own; the
repository root is a Python project and a build from there fails immediately.

Set the environment variables under Project Settings → Environment Variables.
`NEXT_PUBLIC_*` values are inlined at build time, so changing one requires a
redeploy rather than just an env edit — the running deployment keeps the values
it was built with. Add the Vercel domain to Firebase's authorized domains, or
Google sign-in fails there while working locally.

One Next.js setting matters for this: `next.config.ts` emits
`output: "standalone"` only when `VERCEL` is unset. Vercel's builder generates
its own trace manifests and standalone mode suppresses them, so leaving it on
fails the build looking for `.next/next-server.js.nft.json`. The Docker image
still gets the standalone output it needs.

**Container** —

```bash
cp .env.example .env && $EDITOR .env
docker compose up --build          # http://localhost:3000
```

The Firebase values are build args rather than runtime env for the same
inlining reason; `GEMINI_API_KEY` is server-side and stays runtime-only, so it
is never baked into the image.

## Sources and attribution

Neither the items nor the profile text are original to this project.

| What | Source |
| --- | --- |
| The 70 forced-choice items | [Humanmetrics — Jung Typology Test](https://www.humanmetrics.com/personality) |
| The sixteen type profiles | [The Personality Page](https://www.personalitypage.com/html/ENFJ.html) — description, strengths, relationship patterns, problem areas and ten rules |

The original project linked a university-hosted PDF that has since 404'd and was
never captured by the Wayback Machine, so it cannot be restored; the two live
sources above are what the material actually corresponds to, verified
line-for-line against the profile text shipped in `public/types/`.

Background reading, all linked from [`/methodology`](https://shashvat-mbti.vercel.app/methodology):

- Myers, I. B. & Myers, P. B. — *Gifts Differing: Understanding Personality Type* — <https://openlibrary.org/works/OL3589631W>
- Jung, C. G. — *Psychological Types* (Collected Works, Vol. 6) — <https://press.princeton.edu/books/paperback/9780691018133/collected-works-of-c-g-jung-volume-6>
- Pittenger, D. J. (2005) — *Cautionary comments regarding the Myers-Briggs Type Indicator*, Consulting Psychology Journal 57(3), 210–221 — <https://doi.org/10.1037/1065-9293.57.3.210>
- McCrae, R. R. & Costa, P. T. (1989) — *Reinterpreting the MBTI from the perspective of the five-factor model*, Journal of Personality 57(1), 17–40 — <https://doi.org/10.1111/j.1467-6494.1989.tb00759.x>

This is not the licensed MBTI® instrument and no equivalence to it is claimed;
MBTI is a trademark of its respective owner.
