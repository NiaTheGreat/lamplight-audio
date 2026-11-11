# Narrating in the background

## Narrate a whole book

From a book's narrating screen you can narrate the whole book, or a range of chapters, without keeping the page open. Choosing a range lets you skip chapters you have already read. A different voice can be chosen for the batch without changing the book's default.

A job record is saved in storage. A worker narrates for about 250 seconds, saves its place, then calls itself again to continue. If a hop is lost, the page shows "stalled" after 8 minutes with a **Resume where it stopped** button.

## When the narrator is busy

Providers sometimes answer "busy, retry later" (DeepInfra's `429 Model busy`, or a 503). Lamplight waits and tries again on its own: up to six tries per piece of text, waiting about 3, 6, 12, 24 and 30 seconds (randomly shortened a little so parallel pieces don't retry in step), or as long as the provider's `Retry-After` header asks, up to a minute. While it waits, the narrating screen shows "DeepInfra busy, retrying in N s…". An empty balance is not treated as busy; that still stops straight away.

If the provider is still busy, or never answers (each try gets 75 seconds), after all tries, the job stops with nothing spent and the narrating screen offers two choices:

- **Try again** continues the job with the same narrator.
- **Use OpenAI for these chapters** (only shown when `OPENAI_API_KEY` is set) reads the chapters the job had left in an OpenAI voice you pick. It shows the price for both narrators first. This happens only when you press it, never automatically. It applies to those chapters only: the book's narrator is unchanged, chapters already narrated keep their voice, and the voice will sound different.

## Job states

A job is `running`, `paused`, `done`, `cancelled` or `error`.

- **Pause** stops after the current chunk (checked at most every 8 seconds). Nothing more is spent until you continue.
- **Resume** continues from where it stopped.
- **Cancel** ends the job. Audio already generated is kept.

Only one job runs per book at a time. Changing narrator, editing pronunciations and re-reading are refused while a job runs.

## The Queue

The **Queue** tab lists everything being narrated or waiting: whole-book jobs and one-chapter narrations started by pressing play. It shows an estimate such as "about 12 min". The estimate comes from narration speed measured by the worker per provider, and says "time not known yet" until about 3,000 characters have been measured.

## Deployment note

The worker calls its own production URL, so on Vercel turn off Deployment Protection for the production domain, or the hops will fail. See [Deployment](deployment.md).
