# Re-reading chapters

Audio is generated once and cached, so changing a pronunciation or voice does not alter chapters you have already narrated. To hear a change, re-read the chapter.

## How

- **One chapter:** use the re-read button on a narrated chapter in the player.
- **Several chapters:** select them on the chapter picker, then use the re-read form. The chapters' audio is cleared and a background job narrates exactly those chapters, not the gaps between them.

The re-read form lets you choose:

- a pronunciation list (keep the current one, none, or a named list)
- a voice for those chapters
- optionally, to make that voice the default for the whole book from now on

It shows the price first and ends in a **Narrate** button. Re-reading is refused while a job is running.

## What happens

The chapter's pinned pronunciation lines are dropped, its audio is deleted and the chapter is marked un-narrated. Other narrated chapters keep the voice and lines they have.
