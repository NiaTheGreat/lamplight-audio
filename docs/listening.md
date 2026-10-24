# Listening

The player is one persistent audio element that lives above the screens, so audio keeps playing while you move around the app.

## Playing a chapter

- Press play on a narrated chapter and it streams immediately.
- Press play on a chapter that is not narrated yet and the app starts a one-chapter background job, then plays when the audio exists. It keeps narrating if you close the tab, and shows in the [Queue](background-narration.md). Moving to another chapter cancels the job it started.
- If another job is already running for the book, the player narrates the chapter directly instead.
- Press play on an un-narrated chapter while a different chapter is playing and it is narrated in the background without interrupting what you hear. It shows in the Queue and turns ready when done.
- If narrating a chapter fails, it is marked failed and the reason is shown. Pressing play again tries again.

By default the app asks before narrating (the cost is shown first). You can turn that prompt off in **Settings**; the setting is stored on the device.

## Controls

- Play, pause, seek and skip between chapters.
- Playback speed. The default is set in **Settings**.
- Sleep timer: off, 15, 30 or 60 minutes, or end of chapter. The default is set in **Settings**.
- Bedside mode and a screen-dimming layer for night listening. The dimming level is set in **Settings**.
- Lock-screen and headphone controls through the media session.
- Auto-advance to the next chapter, limited to the range you chose to listen to.

## Resume

Your position in each book is saved and restored. "Start listening" begins at the chosen chapter range rather than always chapter 1.

Each chapter also keeps its own listening spot. If you leave a chapter part-way and come back to it later, even after listening to other chapters, it picks up where you stopped. A chapter you listened to the end starts from the beginning next time. The spots are saved on the server, so they follow you between devices.

## Downloading

Any narrated chapter can be downloaded as a named MP3. It is the same cached file that streams.

## Notes

- With **Narrate the next chapter while I listen** on in **Settings** (the default), the player narrates the next chapter ahead so it is ready for auto-advance. Turn it off to spend less; the next chapter is then narrated when you reach it.
- iOS needs HTTP Range support to play and seek; the app provides it.
- Some players show a slightly off total duration for chapters built from several pieces. Playback is unaffected.
