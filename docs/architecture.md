# Architecture

Next.js 15 (App Router, TypeScript), meant for Vercel. Storage is Cloudflare R2 in production and `./.cache` locally.

## Flow

1. **Upload.** `POST /api/books` parses the EPUB (`lib/epub.ts`) into chapters and saves the book. Files over about 4 MB go straight to R2 through a signed URL first (`app/api/uploads`, `lib/storage/uploads.ts`).
2. **Narrate.** `lib/narration/text.ts` splits a chapter into chunks under the provider's character limit. `lib/narration/tts.ts` calls the provider (with retries), caches each chunk and joins the MP3 pieces (`lib/narration/mp3.ts`).
3. **Play.** `app/api/audio/[id]/[chapter]` serves audio: `?progress=1`, `?prepare=1` (narrate if needed), `?download=1` (named MP3) or plain (redirect to a short-lived signed R2 URL, or served from disk locally).

## Modules

| Area | Files |
| --- | --- |
| EPUB parsing | `lib/epub.ts`, `lib/narration/text.ts` |
| Providers | `lib/providers/` (one file per provider), `PROVIDER_INFO` in `lib/narrators-shared.ts` |
| Narration | `lib/narration/tts.ts`, `lib/narrators-shared.ts`, `lib/narration/narrator.ts`, `lib/narration/mp3.ts` |
| Background jobs | `lib/narration/narration.ts`, `app/api/worker/[id]`, `app/api/books/[id]/narrate`, `lib/storage/live.ts` |
| Pronunciations | `lib/pronunciation/pronunciation.ts`, `lib/pronunciation/pronlists.ts` |
| Voices per chapter | `lib/narration/chaptervoice.ts`, `lib/narration/reread.ts` |
| Budget and speed | `lib/storage/usage.ts`, `lib/storage/speed.ts`, `lib/eta.ts`, `lib/storage/throttle.ts` |
| Player | `components/PlayerProvider.tsx`, `components/AppChrome.tsx` |
| Storage | `lib/storage/storage.ts`, `lib/storage/keys.ts`, `lib/storage/library.ts` |

## Design decisions

- **Cache by content.** Audio keys are hashes of the spoken text and settings, so identical text and voice are never narrated twice. Keys for plain OpenAI voice names are pinned by tests and must not change.
- **Single user.** One shared password and one shared library. Moving to multi-user would need real auth in `middleware.ts`, books keyed per user, server-side resume positions and per-user spend limits.
- **Streaming and download share one file.**
- **Notes stripped by default** before narration.
- **Persistent player.** One `<audio>` element in the root layout so playback survives navigation.
- **Low storage operation counts.** Avoid tight polling and list calls; batch counters.

## Look

Dark theme with warm near-black, cream text and amber accents; Fraunces and Hanken Grotesk fonts. Tokens are in `app/styles/tokens.css`. Keep the UI usable one-handed on a phone.

The logo (a lamp over an open book) is the app icon. `app/icon.png`, `app/apple-icon.png` (full-bleed, since iOS rounds it itself, used for "Add to Home Screen") and `app/favicon.ico` are picked up by Next.js automatically, and `middleware.ts` lets them through without the password so the login page shows the icon too.
