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
- Lock-screen and headphone controls through the media session. Play reloads the chapter at the saved spot if the audio element is stuck, and the lock screen's play/pause state follows the real one.
- Auto-advance to the next chapter, limited to the range you chose to listen to. When the next chapter is already narrated, a second (spare) audio element preloads it and starts the moment the current chapter ends, so no audio is cut off. Loading a new source into an element that has already ended makes iOS play it silently while the phone is locked, which is why a spare element is used.

## Resume

Your position in each book is saved and restored. "Start listening" begins at the chosen chapter range rather than always chapter 1.

Each chapter also keeps its own listening spot. If you leave a chapter part-way and come back to it later, even after listening to other chapters, it picks up where you stopped. A chapter you listened to the end starts from the beginning next time. The spots are saved on the server, so they follow you between devices.

How the place is kept safe:

- Opening a book waits (a few seconds at most) for the saved places to arrive, so the app opening straight onto a book no longer starts it at the top.
- Each device also keeps its own copy of every book's place. Opening a book uses the newer of the server's copy and the device's, so a save that never reached the server is not lost. The server ignores a save that was recorded earlier than the one it already holds, so a slow request can't put you back.
- The place is saved when you pause, change chapter, or switch to another book (the book being left is saved first), every 30 seconds while playing, when the page unloads, and when the app goes to the background while playing. iOS often skips the unload event, which is why the last one exists.

The listening place and the reading place are separate. Listening is `progress.json`; reading is `reading.json` (see [Reader](reader.md)). The book-only reader never opens a book in the player, so reading, or opening a fic from Browse to read, does not move where you were listening.

## Downloading

Any narrated chapter can be downloaded as a named MP3. It is the same cached file that streams.

## Reading along

The book screen has a Listen | Read switch. Listen is this screen. Read shows the chapter text in step with the audio; see [Reader](reader.md).

## The Shelf and Browse

The Shelf lists the fics you have narrated or put there. Fics you have only added to [Browse](browse.md) become Shelf fics when you narrate them. Listening position and Browse's reading state both count towards "where you are".

## Notes

- With **Narrate the next chapter while I listen** on in **Settings** (the default), the player narrates the next chapter ahead so it is ready for auto-advance. Turn it off to spend less; the next chapter is then narrated when you reach it.
- iOS needs HTTP Range support to play and seek; the app provides it.
- Some players show a slightly off total duration for chapters built from several pieces. Playback is unaffected.
