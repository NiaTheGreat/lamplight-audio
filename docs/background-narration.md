# Narrating in the background

## Narrate a whole book

From a book's narrating screen you can narrate the whole book, or a range of chapters, without keeping the page open. Choosing a range lets you skip chapters you have already read. A different voice can be chosen for the batch without changing the book's default.

A job record is saved in storage. A worker narrates for about 250 seconds, saves its place, then calls itself again to continue. If a hop is lost, the page shows "stalled" after 8 minutes with a **Resume** button.

## Job states

A job is `running`, `paused`, `done`, `cancelled` or `error`.

- **Pause** stops after the current chunk (checked at most every 8 seconds).
- **Resume** continues from where it stopped.
- **Cancel** ends the job. Audio already generated is kept.

Only one job runs per book at a time. Changing narrator, editing pronunciations and re-reading are refused while a job runs.

## The Queue

The **Queue** tab lists everything being narrated or waiting: whole-book jobs and one-chapter narrations started by pressing play. It shows an estimate such as "about 12 min". The estimate comes from narration speed measured by the worker per provider, and says "time not known yet" until about 3,000 characters have been measured.

## Deployment note

The worker calls its own production URL, so on Vercel turn off Deployment Protection for the production domain, or the hops will fail. See [Deployment](deployment.md).
