# Reader

The reader is an optional second view of a book. **Listen** is the screen the app has always had and stays the default. **Read** shows the chapter text and keeps it in step with the audio, both ways. It is an add-on: it can be turned off with one setting and removed by deleting its folders.

## Using it

On a book, pick **Read** in the Listen | Read switch. The choice is remembered on that device.

- **Following the audio.** The sentence being spoken is lit and the view follows it. Scroll or swipe away and following pauses; **Back to reading** resumes it.
- **Steering the audio.** Tap any sentence to jump the audio there (and start playing if it was paused). The slider and the skip buttons work too.
- **Scroll or pages.** The book icon at the top switches between continuous scrolling and book-style pages. In pages mode, tap the left or right edge, or swipe, to turn the page; the page turns by itself as the audio moves on. **A** / **A** change the text size. Both choices are remembered per device.
- **Italics, quotes and scene breaks** are shown as in the EPUB. Block quotes get a left rule and scene breaks show as a centred "· · ·". Links and images are shown as their text only.
- **Chapters that aren't narrated** can still be read. Tapping a sentence remembers your place (on this device). **Read aloud** narrates the chapter; once it is narrated, the audio starts where you had got to.

## Books added before the reader

Their EPUB was not kept, so they open as plain text with a note. Choose **Attach EPUB** and pick the same file: it is accepted only if every chapter's text is exactly what the book already holds (both "skip notes" settings are tried), so nothing narrated can drift from the page. If it differs (an updated work, a different download), the app lists the chapters that differ and does not attach it; add that file as a new book instead. Chapters with identical text reuse their audio at no cost, because audio is stored by a hash of the text and voice, not by the file. Attaching never re-narrates anything. Adding the same file again on the Add page attaches it too, and is the way to do it for files over about 4 MB.

New books keep their EPUB automatically.

## How the audio and text are matched

The narrator returns one MP3 per chunk of about 1,500 characters (see [Architecture](architecture.md)); the chapter's audio is those chunks joined. No provider (OpenAI, Kokoro, ElevenLabs) is asked for word timings.

1. The first time a narrated chapter is opened in the reader, the app reads each cached chunk's MP3 and saves what it finds in `timing/<bookId>.json`: the chunk's length, where speech starts and ends, and where it pauses. Nothing is decoded: every MP3 frame records how many bits its sound took, so silence shows up as frames that took almost none.
2. Each chunk's start time is exact. Inside a chunk, sentence starts are first guessed from their length (with extra for sentence ends and paragraph breaks) across the part that is really speech, then pulled onto the pauses actually heard. A pause is used only if it is close to the guess; a sentence with no pause nearby keeps its guess, shifted by how far its neighbours moved.
3. Guessing by length alone ran ahead of the audio, most visibly on short sentences that the narrator pauses around. Matching real pauses fixed that: against a speech-synthesiser recording with known sentence starts, the length-only guess was about a second out and the pause-matched times were within 0.15 s (`tests/speech.test.ts`). It is still an estimate where a narrator doesn't pause, so highlighting is by sentence, not word.
4. If the device's player reports a different chapter length from the measured one, the reader says so, because its clock and the measured times then disagree.

Kokoro audio is variable bitrate, so players seek with a 100-entry table written into the file. Each entry can only point to the nearest 1/256 of the file (a few seconds of audio on a long chapter), and the player then assumes it landed exactly. The table used to round down, so after a seek or a pause that re-seeks the audio sat a few seconds earlier than the player's clock and the highlight ran ahead; it now rounds to the nearest step, which leaves at most about half a step of error either way. Chapters narrated before this keep the old table until you use **Fix seeking in finished chapters** on the book's narrating screen (free). Playing from the start never seeks, so it is unaffected.

Pronunciations don't affect this: the reader shows the original words, and the timing uses the text as it was spoken (the lines the chapter was narrated with). The timing record is tied to the chapter's audio file, so re-reading or re-narrating a chapter measures it again on its own.

It costs nothing extra: no provider call is made, the measurement reads the cached chunks once per chapter, and the timing file is written once per chapter. The cost of reading is a few storage reads when a chapter is first opened.

## What is stored

| Key | Contents |
| --- | --- |
| `epubs/<bookId>.epub` | the original upload (about 1 MB) |
| `reader/<bookId>.json` | the formatted chapters made from it |
| `timing/<bookId>.json` | measured chunk lengths, speech extent and pauses per chapter |

The formatted chapters and timing are caches that can be rebuilt; the EPUB is the source. The book record and narrated text are unchanged, so no audio cache key is affected.

## Book only (no player)

**Read** on a Browse card opens the book on its own, like an e-book app: just the text, no player and nothing narrated (`components/reader/BookReader.tsx`). Tap the middle of the page to show the menu: back to Browse, text settings, chapters, and a headphones button. Pages is the default (tap or swipe the left and right edges to turn; turning past the end goes to the next chapter); Scroll is in the text settings, along with the font (**Literata**, the default, made for long reading; **Atkinson Hyperlegible**; **Georgia**, the device's own book serif; and **Lamplight**'s Fraunces), a **Bold text** switch, line spacing (Tight, Normal, Roomy) and three themes: **Lamplight** (the app's own look), **Calm** (warm brown with soft cream text) and **Black** (white on pure black), remembered per device (`abg:bk-font`, `abg:bk-bold`, `abg:bk-leading`, `abg:bk-theme`; the fonts are loaded in `app/layout.tsx` and only fetched when used; colours in `app/styles/reader.css`), with a **Next chapter** button at the end. The next chapters are fetched in the background while you read, so turning past the end of a chapter does not wait, and the book-only view asks the server for the text alone. A thin line at the top and bottom says where you are (chapter, page, percent of the book), and the place in the chapter is remembered on the device (`abg:bk-spot:<id>`). The headphones button opens Listen; on a chapter that isn't narrated it shows the price first and does nothing until you confirm. The view is the device-local `abg:view` value `book` (the Listen | Read switch is `listen` / `read`).

## Reading and listening keep separate places

The book-only view (`components/reader/BookReader.tsx`) loads its own copy of the book and chooses its own chapter: the link's `?chapter=` (Browse's Continue; removed from the address once used), else the spot left on this device (`abg:bk-spot:<id>`), else Browse's reading state. It never opens the book in the player, so the player's book, chapter and saved listening place stay as they were, and the audio keeps playing if it was. The headphones button is the only way across: for a narrated chapter it goes to Listen at the saved listening place (a book never listened to starts at the chapter you are reading); for an un-narrated chapter it asks the price, then narrates that chapter, which moves the listening place on purpose. The Listen | Read side (`Reader.tsx`) shares the player's chapter by design.

## Reading progress

The reader tells the server which chapter is open and when its end has been reached (`components/browse/useReadingProgress.ts`, `reading.json`), so [Browse](browse.md) can show Unread, Reading or Finished and offer **Continue**. Opening a fic from Browse goes to `/book/<id>?chapter=<n>` in the book-only view (above); the Read side of the Listen | Read switch records progress the same way. Nothing breaks if these calls fail.

## Turning it off

Set `READER_ENABLED=false` (see [Configuration](configuration.md)) and redeploy or restart. The Listen | Read switch disappears, the reader routes answer 404, and nothing is saved when books are added. Leaving it unset keeps it on. Books keep working exactly as before either way.

## Removing it

The reader is kept apart from the rest of the code. To take it out:

1. Delete `lib/reader/`, `components/reader/` (including `BookReader.tsx`), `app/api/reader/`, `app/styles/reader.css`, `lib/client/reader.ts`, `tests/reader*.test.ts`, the reader test in `e2e/app.spec.ts` and this page.
2. Remove its few hooks into other code:
   - `app/globals.css`: the `reader.css` import.
   - `components/reader/Reader.tsx`: `useReadingProgress` (also used by Browse; see [Browse](browse.md)).
   - `app/book/[id]/page.tsx`: the `useReaderView` hook, the `ViewSwitch`, and the `Reader` early return.
   - `app/api/books/route.ts`: the `format` option and the `saveReaderBook` call.
   - `lib/epub.ts`: the `format` option, `collapseSpaces`, the marks in `normalize`, and the `paras` handling in `parseEpub` and `extractChapter`; and `paras?` in `lib/types.ts`.
3. Optionally delete the `epubs/`, `reader/` and `timing/` objects from storage.

Narration, the player and the stored books don't depend on any of it.
