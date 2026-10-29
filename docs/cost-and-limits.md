# Cost and limits

Narration is the only real cost. It is paid once per chapter; replays come from the cache.

| Model | Price | A 100,000-word book (about 600k characters) |
| --- | --- | --- |
| `gpt-4o-mini-tts` (default) | about $0.015 per minute of audio | roughly $10 |
| `tts-1` | $15 per 1M characters | roughly $9 |
| Kokoro via DeepInfra | about $0.99 per 1M characters | roughly $0.60 |
| ElevenLabs Flash v2.5 | about $60 per 1M characters | roughly $36 |
| ElevenLabs v4 Turbo | about $40 per 1M characters | roughly $24 |
| ElevenLabs v4 | about $80 per 1M characters | roughly $48 |

Prices change. Cost estimates in the app are an upper bound because free tiers are not modelled.

## Monthly budget

The monthly limit (default $30, or `MONTHLY_BUDGET_USD` if set) stops narration once the estimated spend for the calendar month, across all narrators, reaches it. An optional `MONTHLY_CHAR_LIMIT` caps characters as well. Both are checked before every provider call.

The counter is batched in memory and written once per chapter, to keep storage operations low.

## Where you can see it

**Settings** shows the month's estimated spend against the limit, and you can change the limit there. A limit saved in Settings is stored server-side (`usage/limit.json`) and overrides `MONTHLY_BUDGET_USD`; "Use the default" removes it so the environment variable (or $30) applies again. The API is `PUT /api/usage` with `{ "limitUsd": 40 }` or `{ "limitUsd": null }`.

Narrating the next chapter while you listen ("Narrate the next chapter while I listen" in Settings, on by default) spends money on a chapter you might not reach. Turn it off to narrate only what you play.

## Password protection

A deployed app is behind one shared password (`APP_PASSWORD`) so nobody else can spend your credits. After 5 wrong passwords an address is locked out for 15 minutes.

## Always shown first

The app shows what a narration will cost before it starts, unless you turn that prompt off in Settings.
