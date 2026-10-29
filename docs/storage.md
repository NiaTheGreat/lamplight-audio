# Storage

`lib/storage/storage.ts` stores records in Cloudflare R2 (S3 API via `aws4fetch`) in production and in `./.cache` locally. The Docker image sets `CACHE_DIR=/data`, a volume, so a self-hosted copy needs no cloud storage; back that volume up.

## What is stored

| Key | Contents |
| --- | --- |
| book records | parsed text, chapters, narrator, pronunciation lines |
| `audio/<hash>.mp3` and chunk pieces | narrated audio, keyed by hash of text and settings |
| `progress.json` | listening position per book, plus the spot in each part-listened chapter |
| `keys/<bookId>.json` | where each narrated chapter's audio is, so playing never reads the whole book |
| `jobs/<bookId>.json`, `jobs/active.json`, `jobs/live.json` | background jobs and what is being narrated |
| `stats/speed.json` | measured narration speed for estimates |
| usage counters and limit | monthly spend, and the limit set in Settings |
| `pronlists.json` | named pronunciation lists |

## Keeping operations low

Object stores bill, and rate-limit, by operation count. The app avoids tight polling and storage listings: the Queue reads `jobs/active.json` rather than listing, the usage counter is flushed once per chapter, and narration speed once per worker run.

## Security

The bucket stays private. Audio reaches the browser through short-lived signed URLs, handed out only to logged-in users. Chapter audio is cached only briefly (10 minutes) because a chapter can be rebuilt under the same key; never mark it immutable.
