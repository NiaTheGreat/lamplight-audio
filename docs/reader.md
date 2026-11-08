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

1. The first time a narrated chapter is opened in the reader, the app measures the true length of each cached chunk and saves it in `timing/<bookId>.json`.
2. Each chunk's start time is exact. Sentences inside a chunk are placed by their length, with a little extra for sentence ends and paragraph breaks.
3. The page is therefore exact at every chunk boundary (about every minute and a half of audio) and a good estimate between them, usually within a second or two. Highlighting is by sentence, not word, for that reason.

Pronunciations don't affect this: the reader shows the original words, and the timing uses the text as it was spoken (the lines the chapter was narrated with). The timing record is tied to the chapter's audio file, so re-reading or re-narrating a chapter measures it again on its own.

It costs nothing extra: no provider call is made, the measurement reads the cached chunks once per chapter, and the timing file is written once per chapter. The cost of reading is a few storage reads when a chapter is first opened.

## What is stored

| Key | Contents |
| --- | --- |
| `epubs/<bookId>.epub` | the original upload (about 1 MB) |
| `reader/<bookId>.json` | the formatted chapters made from it |
| `timing/<bookId>.json` | measured chunk lengths per chapter |

The formatted chapters and timing are caches that can be rebuilt; the EPUB is the source. The book record and narrated text are unchanged, so no audio cache key is affected.

## Turning it off

Set `READER_ENABLED=false` (see [Configuration](configuration.md)) and redeploy or restart. The Listen | Read switch disappears, the reader routes answer 404, and nothing is saved when books are added. Leaving it unset keeps it on. Books keep working exactly as before either way.

## Removing it

The reader is kept apart from the rest of the code. To take it out:

1. Delete `lib/reader/`, `components/reader/`, `app/api/reader/`, `app/styles/reader.css`, `lib/client/reader.ts`, `tests/reader*.test.ts`, the reader test in `e2e/app.spec.ts` and this page.
2. Remove its few hooks into other code:
   - `app/globals.css`: the `reader.css` import.
   - `app/book/[id]/page.tsx`: the `useReaderView` hook, the `ViewSwitch`, and the `Reader` early return.
   - `app/api/books/route.ts`: the `format` option and the `saveReaderBook` call.
   - `lib/epub.ts`: the `format` option, `collapseSpaces`, the marks in `normalize`, and the `paras` handling in `parseEpub` and `extractChapter`; and `paras?` in `lib/types.ts`.
3. Optionally delete the `epubs/`, `reader/` and `timing/` objects from storage.

Narration, the player and the stored books don't depend on any of it.
