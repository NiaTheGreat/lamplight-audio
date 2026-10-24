# Troubleshooting

**"That doesn't look like an EPUB."** The file must end in `.epub`. Other formats are not supported.

**Large EPUBs fail with a message about CORS.** Add the CORS rule from [Deployment](deployment.md) to your R2 bucket. Files under about 4 MB do not need it.

**Notes or summaries are being read aloud.** Check that **Skip notes and summaries** was on when the book was added. If it was, the EPUB's structure may not be recognised: see [EPUB parsing](epub-parsing.md) for how to report or fix it.

**A name is mispronounced.** Add a line in the book's [pronunciations](pronunciations.md), try it with **Hear**, then [re-read](rereading.md) the chapter.

**Narration stopped partway ("stalled").** A hop of the background worker was lost. Press **Resume**. On Vercel, make sure Deployment Protection is off for the production domain.

**Narration refused: budget reached.** The monthly spend limit was hit. Raise `MONTHLY_BUDGET_USD` or wait for the next month.

**A chapter takes a long time the first time.** Long chapters are narrated chunk by chunk. If the time budget runs out the player retries and resumes where it stopped. Replays are instant.

**Playback won't seek on iPhone.** The audio route supports Range requests, which iOS needs. If you proxy the app, make sure the proxy forwards Range headers.

**Locked out of login.** After 5 wrong passwords an address is locked out for 15 minutes.
