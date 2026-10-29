# Contributing

Start with the [README](README.md) to run the app. `CLAUDE.md` is the design record: it lists decisions already made and how each part works, so read it before changing behavior.

## Setup

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY at least
npm run dev                  # http://localhost:3000, audio cached in ./.cache
```

Never call the real OpenAI API in tests. They use a local fake server.

## Checks (CI runs all of these on every PR)

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint (Next.js rules). Warnings are allowed, errors fail. |
| `npm run format:check` | Prettier (`npm run format` fixes it). CSS and Markdown are not formatted. |
| `npm test` | Vitest: parsing, cache keys, MP3 joining, API client, and the real player in jsdom |
| `npm run test:e2e` | Playwright on a phone-sized Chromium against a fake OpenAI server. Set `E2E_CHROMIUM` to a Chromium binary if `playwright install` isn't possible. |

Add a test when fixing a parser bug. Run `tests/player.test.ts` after touching `components/PlayerProvider.tsx` or `components/player/`. Add a spec in `e2e/app.spec.ts` when you add a screen.

## Where things live

- `app/`: pages and API routes. `app/styles/`: the stylesheet, one file per area (`globals.css` only imports them, in an order that matters).
- `components/`: UI. `components/player/`: pieces of the player that don't need the audio element.
- `lib/storage/`, `lib/narration/`, `lib/pronunciation/`, `lib/providers/`, `lib/client/`: server and browser logic grouped by domain. Client-safe pure modules stay at the top of `lib/`.

## Adding a narration provider

1. Add a `PROVIDER_INFO` row in `lib/narrators-shared.ts` (label, key env var, price per million characters, minimum bytes per character, whether the MP3 needs repair), plus its voices and narrator-id parsing.
2. Add `lib/providers/<name>.ts` with `cacheLayout` (the audio cache key) and `request` (the HTTP call).
3. Register it in `lib/providers/index.ts`.
4. Add `tests/<name>.test.ts`.

Never change the cache key for plain OpenAI voice names. `tests/cachekeys.test.ts` pins them, because audio already paid for lives under them.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | OpenAI narration |
| `APP_PASSWORD` | in production | Shared login password. The app returns 500 in production without it. |
| `DEEPINFRA_API_KEY` | no | Kokoro narrators |
| `ELEVENLABS_API_KEY` | no | ElevenLabs narrators |
| `OPENAI_TTS_MODEL` | no | `gpt-4o-mini-tts` (default) or `tts-1` |
| `OPENAI_TTS_VOICE` | no | Default voice for new books |
| `TTS_INSTRUCTIONS` | no | Tone instructions (`gpt-4o-mini-tts` only) |
| `TTS_END_PAD` | no | Text appended to each piece so the last words aren't clipped. Empty disables it. |
| `ELEVENLABS_TTS_MODEL` | no | Override the model for ElevenLabs Flash narrators |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | on Vercel | Cloudflare R2 storage. Leave empty locally to use `./.cache`. |
| `R2_ENDPOINT` | no | Override the R2 endpoint |
| `MONTHLY_BUDGET_USD` | no | Default monthly spend limit (30); a limit saved in Settings overrides it |
| `MONTHLY_CHAR_LIMIT` | no | Optional monthly cap in characters |
| `CACHE_DIR` | no | Local cache folder (default `./.cache`) |
| `OPENAI_BASE_URL`, `DEEPINFRA_BASE_URL`, `ELEVENLABS_BASE_URL` | no | Point a provider at a mock server (tests do this) |
| `E2E_CHROMIUM`, `FAKE_OPENAI_PORT` | no | Browser test setup |

Never commit secrets. `.env.local` is gitignored.

## Pull requests

Work on a branch and open a PR rather than pushing to `main`. Keep a PR to one change, and say what you ran to check it.
