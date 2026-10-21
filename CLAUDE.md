# audiobook-generator

Personal tool (single user, Nia) that turns EPUBs into audiobooks. Upload an EPUB, narrate each chapter once with OpenAI TTS, cache the audio, then stream it in a mobile-friendly player or download it as an MP3. Mostly AO3 fanfic EPUBs, but any EPUB should work. It is used from a phone, often at night with the screen locked.

## Decisions already made (don't relitigate without asking)

- Next.js 15 (App Router, TypeScript), hosted on Vercel. Stay on Next 15 for now; Next 16 renames `middleware.ts` to `proxy.ts`.
- Input is EPUB upload. No live scraping of AO3 (fragile). A paste-a-link convenience that fetches AO3's EPUB download is a possible later add-on.
- Narration is OpenAI TTS. Default `gpt-4o-mini-tts`, switchable to `tts-1` via `OPENAI_TTS_MODEL`. Cost matters: it should be cheap, so audio is generated once per chapter and cached (`audioKey` in `lib/tts.ts`).
- Streaming playback is the default; MP3 download is also available. Both come from the same cached file.
- Author's notes, chapter summaries and end notes are stripped before narration (`lib/epub.ts`). This must stay on by default. The upload form has a toggle.
- Storage is Vercel Blob in production and `./.cache` locally (`lib/storage.ts`).
- The deployed app is behind one shared password (`APP_PASSWORD`, checked in `middleware.ts`) so nobody else can spend the OpenAI credits.

## Layout

- `lib/epub.ts` EPUB parsing and note stripping. The riskiest code, since it is written against how AO3 structures EPUBs.
- `lib/text.ts` splits chapters into chunks under OpenAI's 4096-character limit.
- `lib/tts.ts` calls OpenAI, retries on 429/5xx, and joins the MP3 pieces.
- `lib/http.ts` serves audio with HTTP Range support. iOS Safari needs this to play and seek.
- `app/api/audio/[id]/[chapter]/route.ts` generates a chapter if it isn't cached, then serves it.
- `app/page.tsx` the single-page player (upload, chapter list, speed, resume, lock-screen controls).

## Working rules

- Run `npm test` and `npm run typecheck` before pushing. Add a test when fixing a parser bug.
- Never commit secrets. `.env.local` is gitignored; `.env.example` lists the variables.
- Work on a branch and open a PR rather than pushing to `main`.
- Never call the real OpenAI API in tests. Point `OPENAI_BASE_URL` at a local mock.
- Keep the UI usable one-handed on a phone: big tap targets, dark theme, no horizontal scrolling.

## Known gaps

- Note-stripping has been checked against one real EPUB (an AO3 work run through Calibre, which turns note headings into plain `<p>` labels and renames preface/afterword files). A raw, unconverted AO3 download hasn't been tried. If an EPUB leaks notes into the narration, fix `lib/epub.ts` and add that case to `tests/epub.test.ts`.
- iOS lock-screen playback and auto-advance between chapters haven't been tested on a real phone.
- Chapter narration can take a minute or more the first time. Very long chapters may hit Vercel's function time limit.
