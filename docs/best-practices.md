# Best practices

Recommended ways to run and use the app, and why.

## Storage: use Cloudflare R2

Use R2 in production rather than Vercel Blob. The app makes many small reads and writes (a record per chunk, job progress, polling), and Blob's Hobby plan caps "advanced operations" at 2,000 a month, which this kind of use exhausts quickly. R2's free tier covers typical use with millions of operations, has no charge for data leaving, and works through the standard S3 API. Locally you need no storage at all: files go to `./.cache`.

Keep the bucket private. Audio reaches the browser through short-lived signed links.

## Narrators: match the voice to the book

| Choice | Best for | Trade-off |
| --- | --- | --- |
| OpenAI `gpt-4o-mini-tts` (default) | Books you care about; supports tone instructions | About $10 for a 100,000-word book |
| OpenAI `tts-1` | Slightly cheaper OpenAI voice | No tone instructions |
| ElevenLabs Flash v2.5 | Short pieces you want in a specific voice | About $60 per million characters, roughly six times OpenAI; not yet tested against the real API |
| ElevenLabs v4 Turbo / v4 | When Flash isn't expressive enough | About $40 / $80 per million characters (list prices); not yet tested against the real API |
| Kokoro via DeepInfra | Long books, casual listening, trying a book out | About 1/16th the price; the voice is generally less expressive than OpenAI's, and voice quality here is not fully verified |

A sensible pattern: narrate with Kokoro to try a book cheaply, and switch to an OpenAI voice only for books you love. Changing narrator only affects chapters narrated afterwards, so you can start cheap and upgrade later without paying twice for the early chapters. See [Narrators and voices](narrators.md).

Use [Hear](pronunciations.md) and the voice previews in Settings to compare voices before narrating anything long.

## Spend: keep a cap on

- Keep a monthly limit. The default is $30 (`MONTHLY_BUDGET_USD`); change it in Settings if you want a tighter or looser limit.
- Keep the "confirm before narrating" prompt on. It shows the price first.
- Consider turning off "Narrate the next chapter while I listen" if you often drop books part-way.
- Set a hard monthly limit in each provider's own dashboard too. `MONTHLY_BUDGET_USD` is only the app's estimate.
- Use a chapter range instead of narrating a whole book, especially for books you have already read part of.
- Estimates are an upper bound, because free tiers are not modelled.

## Pronunciations: fix names before narrating

Audio is paid for once, so a mispronounced name costs money to fix.

1. Put recurring names and words in a [pronunciation list](pronunciations.md) and mark it automatic, so every new book gets it.
2. Try tricky respellings with the **Hear** button, which costs almost nothing.
3. Only then narrate the book.

To change a chapter that is already narrated, use [re-read](rereading.md), which shows the price first.

## Long books

- Use background narration for whole books so you don't have to keep the page open. See [Narrating in the background](background-narration.md).
- Narrate the next few chapters ahead of where you are, not the whole book up front, if you may drop it.
- Start with the first chapter in the player to confirm the voice and notes-skipping suit the book.

## Notes and summaries

Leave **Skip notes and summaries** on. Check the first chapter after adding an unfamiliar EPUB: if notes are being read aloud, see [EPUB parsing](epub-parsing.md).

## Deployment

- Set a strong `APP_PASSWORD`. The app refuses to run in production without one.
- Turn off Vercel Deployment Protection on the production domain, or background narration cannot chain.
- Add the bucket CORS rule so large EPUBs can upload. See [Deployment](deployment.md).
- Keep secrets in the host's environment variables, never in the repo.
- Rotate your API keys if you ever suspect they leaked. The README section "Keeping your keys safe" has the steps.
- Self-hosting with Docker? Put it behind HTTPS (Tailscale Serve or a Cloudflare Tunnel) before exposing it beyond your home network, and keep a strong `APP_PASSWORD`. Back up the `lamplight-data` volume.

## Listening

- Use the sleep timer (including "end of chapter") for night listening.
- Let the player prefetch the next chapter so auto-advance doesn't wait on narration.
- Add the site to your home screen on your phone.
