# Listening

The player is one persistent audio element that lives above the screens, so audio keeps playing while you move around the app.

## Playing a chapter

- Press play on a narrated chapter and it streams immediately.
- Press play on a chapter that is not narrated yet and the app starts a one-chapter background job, then plays when the audio exists. It keeps narrating if you close the tab, and shows in the [Queue](background-narration.md). Moving to another chapter cancels the job it started.
- If another job is already running for the book, the player narrates the chapter directly instead.

By default the app asks before narrating (the cost is shown first). You can turn that prompt off in **Settings**; the setting is stored on the device.

## Controls

- Play, pause, seek and skip between chapters.
- Playback speed (default set in Settings).
- Sleep timer: off, 15, 30 or 60 minutes, or end of chapter.
- Bedside mode and a screen-dimming layer for night listening.
- Lock-screen and headphone controls through the media session.
- Auto-advance to the next chapter, limited to the range you chose to listen to.

## Resume

Your position in each book is saved and restored. "Start listening" begins at the chosen chapter range rather than always chapter 1.

## Downloading

Any narrated chapter can be downloaded as a named MP3. It is the same cached file that streams.

## Notes

- The player prefetches the next chapter so it is ready for auto-advance.
- iOS needs HTTP Range support to play and seek; the app provides it.
- Some players show a slightly off total duration for chapters built from several pieces. Playback is unaffected.
