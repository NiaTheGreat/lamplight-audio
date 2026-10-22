# audiobook-generator

Personal tool (single user, Nia) that turns EPUBs into audiobooks. Upload an EPUB, narrate each chapter once with OpenAI TTS, cache the audio, then stream it in a mobile-friendly player or download it as an MP3. Mostly AO3 fanfic EPUBs, but any EPUB should work. It is used from a phone, often at night with the screen locked.

## Decisions already made (don't relitigate without asking)

- Next.js 15 (App Router, TypeScript), hosted on Vercel. Stay on Next 15 for now; Next 16 renames `middleware.ts` to `proxy.ts`.
- Input is EPUB upload. No live scraping of AO3 (fragile). A paste-a-link convenience that fetches AO3's EPUB download is a possible later add-on.
- Narration is OpenAI TTS by default (`gpt-4o-mini-tts`, switchable to `tts-1` via `OPENAI_TTS_MODEL`), or Kokoro-82M through DeepInfra for about 1/16th the price. A "narrator" is a string: a plain voice name ("ballad") is the original OpenAI narrator; `deepinfra:kokoro:af_bella` is Kokoro. Each book keeps its narrator in `voice`; it can be changed only while nothing is narrated yet. Cost matters: it should be cheap, so audio is generated once per chapter and cached (`audioKey` in `lib/tts.ts`).
- Streaming playback is the default; MP3 download is also available. Both come from the same cached file.
- Author's notes, chapter summaries and end notes are stripped before narration (`lib/epub.ts`). This must stay on by default. The upload form has a toggle.
- Storage is Cloudflare R2 (S3 API via `aws4fetch`) in production and `./.cache` locally (`lib/storage.ts`). It replaced Vercel Blob, whose Hobby limits (2,000 advanced operations a month) were exhausted by polling and per-chunk writes. Keep operation counts low anyway: avoid tight polling and unneeded list calls.
- The deployed app is behind one shared password (`APP_PASSWORD`, checked in `middleware.ts`) so nobody else can spend the OpenAI credits.
- Single-user for now (one shared password, one shared library). Might become multi-user later. If so: real auth in `middleware.ts`, library/books keyed per user, resume position moved server-side, and per-user narration spend limits. Audio can stay shared since its keys are hashes of text and settings.

## Layout

- `lib/epub.ts` EPUB parsing and note stripping. The riskiest code, since it is written against how AO3 structures EPUBs.
- `lib/text.ts` splits chapters into chunks under OpenAI's 4096-character limit.
- `lib/tts.ts` calls OpenAI, retries on 429/5xx, caches each chunk, and joins the MP3 pieces.
- `lib/narration.ts` + `app/api/worker/[id]` + `app/api/books/[id]/narrate` background narration of a whole book: a job record in storage (with an optional `from`/`to` chapter range, so you can skip chapters you've already read), a worker that narrates ~250s then calls itself again.
- `app/api/uploads` + `lib/uploads.ts`: EPUBs over ~4 MB are PUT by the browser straight to R2 via a signed URL (Vercel caps request bodies at ~4.5 MB), then `POST /api/books` with `{uploadKey}` reads, parses and deletes the temporary file. Needs a CORS rule on the bucket (see README).
- `lib/library.ts` records which chapters are narrated for the library list.
- `lib/http.ts` serves audio with HTTP Range support. iOS Safari needs this to play and seek.
- `app/api/audio/[id]/[chapter]/route.ts` has four modes: `?progress=1`, `?prepare=1` (narrate if needed, no bytes), `?download=1` (proxied named MP3), and plain (307 redirect to a short-lived signed R2 URL so the phone streams from the CDN; served from disk locally).
- `lib/narrators-shared.ts` (client-safe) narrator ids, Kokoro voices, prices per million characters. `lib/tts.ts` builds the request per provider and shares retries/checks. `lib/narrator.ts` changes a book's narrator. **Never change `audioKey` for plain voice names**: `tests/cachekeys.test.ts` pins the real keys (audio already paid for lives under them); new narrators use a separate versioned layout.
- `lib/usage.ts` monthly dollar budget (`MONTHLY_BUDGET_USD`, default $30, priced per narrator) plus an optional `MONTHLY_CHAR_LIMIT`, checked before every provider call. `lib/throttle.ts` locks a login address out for 15 minutes after 5 wrong passwords.
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

- Kokoro/DeepInfra has been tested only against a local fake server (request shape from DeepInfra's OpenAI-compatible docs). Real voice names, request limits per chunk, and sound quality are unverified until a real key is used; the Kokoro voice list comes from the model card and DeepInfra may reject some.
- The Kokoro price ($0.99 per million characters) is the figure shown on DeepInfra's Kokoro page; DeepInfra's own pages have disagreed. Free tiers are not modelled, so cost estimates are an upper bound.
- Direct-to-R2 EPUB upload (signed PUT URL + bucket CORS) is tested only against an in-memory stand-in, not real R2.
- The audio redirect to R2 (and Range playback through it on iOS Safari) hasn't been tried on real Vercel/phone. The `?prepare=1` flow avoids a cross-origin fetch on purpose; the audio element itself follows the redirect.
- The Lamplight screens were checked with screenshots only against a fake OpenAI server. Playing real audio, the sleep timer, bedside mode and auto-advance haven't been exercised in a real browser or on a phone.
- Paste-an-AO3-link is a disabled placeholder (scraping is a standing decision to avoid).
- Background narration (self-chaining worker) works locally against a mock but hasn't run on real Vercel. Check that the worker can call its own production URL (Deployment Protection off) and that a >250s book hops correctly.
- Note-stripping has been checked against one real AO3 download ("Download > EPUB"). AO3 builds its EPUBs with Calibre, so they turn note headings into plain `<p>` labels and name the files `*_split_000.xhtml` instead of preface/afterword. Other AO3 works may differ (series, anonymous works, many chapters). If an EPUB leaks notes into the narration, fix `lib/epub.ts` and add that case to `tests/epub.test.ts`.
- iOS lock-screen playback and auto-advance between chapters haven't been tested on a real phone.
- Chapter narration can take a minute or more the first time. Long chapters are narrated chunk by chunk (`synthesizeChapter` in `lib/tts.ts`): each chunk is cached on its own, and if the ~200s budget runs out the audio route returns `202 {ready,total}` and the player retries, resuming where it stopped. The 202/retry flow hasn't been tried against real Vercel or a real phone.
