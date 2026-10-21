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
- Single-user for now (one shared password, one shared library). Might become multi-user later. If so: real auth in `middleware.ts`, library/books keyed per user, resume position moved server-side, and per-user narration spend limits. Audio can stay shared since its keys are hashes of text and settings.

## Layout

- `lib/epub.ts` EPUB parsing and note stripping. The riskiest code, since it is written against how AO3 structures EPUBs.
- `lib/text.ts` splits chapters into chunks under OpenAI's 4096-character limit.
- `lib/tts.ts` calls OpenAI, retries on 429/5xx, caches each chunk, and joins the MP3 pieces.
- `lib/narration.ts` + `app/api/worker/[id]` + `app/api/books/[id]/narrate` background narration of a whole book: a job record in storage, a worker that narrates ~250s then calls itself again.
- `lib/library.ts` records which chapters are narrated for the library list.
- `lib/http.ts` serves audio with HTTP Range support. iOS Safari needs this to play and seek.
- `app/api/audio/[id]/[chapter]/route.ts` generates a chapter if it isn't cached, then serves it.
- `components/PlayerProvider.tsx` the one persistent `<audio>` element and all playback logic (chapter loading, auto-advance, sleep timer, resume, lock-screen controls, background-job polling). It lives in the root layout so audio keeps playing while screens change.
- `components/AppChrome.tsx` tab bar, mini player, dim layer and bedside mode. `components/Icon.tsx` is the line-icon set.
- Screens: `app/page.tsx` library, `app/add`, `app/book/[id]` player, `app/book/[id]/narrating`, `app/settings`. The look is called Lamplight (tokens in `app/globals.css`): warm near-black, cream text, candle amber, Fraunces + Hanken Grotesk. No purple, no pure white, no emoji icons.
- `lib/settings.ts` / `lib/settings-shared.ts` (server vs client-safe) and `lib/progress.ts` are small server-side records (settings, listening position). Each book stores its own `voice`, fixed when first added.

## Working rules

- Run `npm test` and `npm run typecheck` before pushing. Add a test when fixing a parser bug.
- Never commit secrets. `.env.local` is gitignored; `.env.example` lists the variables.
- Work on a branch and open a PR rather than pushing to `main`.
- Never call the real OpenAI API in tests. Point `OPENAI_BASE_URL` at a local mock.
- Keep the UI usable one-handed on a phone: big tap targets, dark theme, no horizontal scrolling.

## Known gaps

- The Lamplight screens were checked with screenshots only against a fake OpenAI server. Playing real audio, the sleep timer, bedside mode and auto-advance haven't been exercised in a real browser or on a phone.
- Paste-an-AO3-link is a disabled placeholder (scraping is a standing decision to avoid).
- Background narration (self-chaining worker) works locally against a mock but hasn't run on real Vercel. Check that the worker can call its own production URL (Deployment Protection off) and that a >250s book hops correctly.
- Note-stripping has been checked against one real AO3 download ("Download > EPUB"). AO3 builds its EPUBs with Calibre, so they turn note headings into plain `<p>` labels and name the files `*_split_000.xhtml` instead of preface/afterword. Other AO3 works may differ (series, anonymous works, many chapters). If an EPUB leaks notes into the narration, fix `lib/epub.ts` and add that case to `tests/epub.test.ts`.
- iOS lock-screen playback and auto-advance between chapters haven't been tested on a real phone.
- Chapter narration can take a minute or more the first time. Long chapters are narrated chunk by chunk (`synthesizeChapter` in `lib/tts.ts`): each chunk is cached on its own, and if the ~200s budget runs out the audio route returns `202 {ready,total}` and the player retries, resuming where it stopped. The 202/retry flow hasn't been tried against real Vercel or a real phone.
