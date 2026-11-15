# Storage

`lib/storage/storage.ts` stores records in Cloudflare R2 (S3 API via `aws4fetch`) in production and in `./.cache` locally. The Docker image sets `CACHE_DIR=/data`, a volume, so a self-hosted copy needs no cloud storage; back that volume up.

## What is stored

| Key | Contents |
| --- | --- |
| book records | parsed text, chapters, narrator, pronunciation lines |
| `audio/<hash>.mp3` and chunk pieces | narrated audio, keyed by hash of text and settings |
| `progress.json` | listening position per book, plus the spot in each part-listened chapter; each save carries the device's time (`at`) and an older one never replaces a newer one |
| `keys/<bookId>.json` | where each narrated chapter's audio is, so playing never reads the whole book |
| `epubs/<bookId>.epub`, `reader/<bookId>.json`, `timing/<bookId>.json` | the original EPUB, its formatted chapters and measured chunk lengths and pauses, for the optional [reader](reader.md) |
| `catalog/index.json`, `catalog/<bookId>.json` | the [Browse](browse.md) list (one entry per fic, read in one request) and each fic's full summary |
| `reading.json` | where you are in each fic in the reader (chapter, chapters finished, finished or marked unread) |
| `library/<bookId>.json` | the Shelf entry: which chapters are narrated. A fic with none is Browse only |
| `jobs/<bookId>.json`, `jobs/active.json`, `jobs/live.json` | background jobs and what is being narrated |
| `stats/speed.json` | measured narration speed for estimates |
| usage counters and limit | monthly spend, and the limit set in Settings |
| `pronlists.json` | named pronunciation lists |

## Keeping operations low

Object stores bill, and rate-limit, by operation count. The app avoids tight polling and storage listings: the Queue reads `jobs/active.json` rather than listing, Browse reads one `catalog/index.json` rather than every fic, the usage counter is flushed once per chapter, and narration speed once per worker run.

## Security

The bucket stays private. Audio reaches the browser through short-lived signed URLs, handed out only to logged-in users. Chapter audio is cached only briefly (10 minutes) because a chapter can be rebuilt under the same key; never mark it immutable.
