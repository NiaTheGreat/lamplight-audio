# Browse

Browse is a second view of your library, beside the Shelf. The **Shelf** is what you are listening to. **Browse** lists every fic you have added, with its summary, tags, rating, length and whether it is complete, so you can search and filter, read a fic straight away in the [book-only reader](reader.md), and narrate only the ones you pick. Adding a fic to Browse costs nothing.

## Adding fics

**Add EPUBs** (top of Browse) takes any number of files at once and adds them one after another with a progress line; a file that fails is listed with the reason and the rest carry on. Files over about 4 MB go straight to storage first, as on the Add page (see [Adding books](adding-books.md)). The same EPUB twice is one fic.

A fic added here is **Browse only**: it is not on the Shelf, and narration is not started. It uses the default narrator and the default pronunciation list, and the narrator can be changed when you press **Narrate…**. Skip-notes is on. The EPUB and the reader's formatted copy are kept, so **Read** always shows the EPUB's own text and formatting.

The Add page (**Add a fic** on the Shelf) still adds straight to the Shelf, with a narrator and list chosen up front. Those fics appear in Browse too.

## Finding a fic

The side column on a wide screen, or the **Filters** button on a phone, offers:

- **Search**: every word must match somewhere in the title, author, summary, fandom, tags, pairings or characters.
- **Your reading**: Unread, In progress, Finished. The All / Unread / Reading / Finished switch above the list does the same.
- **Narration**: not narrated, partly, fully.
- **Length**: any, under 20k, 20–100k, 100k+ words. **Complete works only.**
- **Language**, **rating**, **fandom**.
- **Tags**: include and exclude (type two or more letters), plus popular tags with counts; tap once to include, again to exclude. Pairings, characters, warnings and category also match here, and so do tags you added yourself.
- **Sort**: recently opened (the default), date added, last updated, published, title, author, word count; either direction.

The list shows 25 fics a page. The filters, sort and page are kept in the address (`/browse?complete=1&min=100000&page=2`), so Back, refresh and bookmarks return to the same view. Counts next to filters come from the whole library.

A fic whose file does not say something (no rating, no tags, no complete flag) simply never matches a filter on it. See "What the file provides".

## Reading state

Every fic says **Unread**, **Reading · Chapter 12 of 24** (with a thin bar) or **Finished**, and its button becomes **Continue · ch 12**.

- Opening a chapter in the reader records it; scrolling to the bottom (or reaching the last page) records that chapter as read. Reading the end of the last chapter marks the fic Finished.
- Listening counts too: the later of your reading and your listening position says where to continue.
- **Mark finished** and **Mark unread** are in a fic's detail view. Marking unread hides older listening until you read or listen again.
- The record is kept on the server, so your phone and your computer agree.

## A fic's detail view

Tap a title. It shows the whole summary, every tag, warnings, pairings and characters, the chapters (a tick on those you finished, "you stopped here"; tap one to read from it), a link to the work on AO3 when the file names it, and:

- **Your tags**: add tags of your own; they work in filters.
- **Status**: As the file says, Complete, or In progress. Useful when the file does not say.
- **Remove from library**: takes it out of Browse and the Shelf. Its text and any narration are kept, so adding the EPUB again brings it back.

## From library to narrated

1. **Browse only**: added, free, readable.
2. **Narrate…** (shows about what the rest costs in its narrator) puts the fic on the Shelf and opens its chapter picker (range, narrator, pronunciations, prices), as for any fic. **Read aloud** on a chapter in the reader narrates that chapter and also puts the fic on the Shelf once it is done.
3. **On the Shelf**: everything works as in [Listening](listening.md) and [Narrating in the background](background-narration.md). Browse still lists the fic, shows "9 of 24 narrated · on your shelf", and **Listen** replaces **Narrate…**.

Opening a Browse-only fic to read does not put it on the Shelf.

## What the file provides

Details are read from the EPUB when it is added ([EPUB parsing](epub-parsing.md#work-details)):

| Source | What it gives |
| --- | --- |
| An AO3 download | rating, warnings, category, fandom, pairings, characters, tags, language, series, dates, word count, chapters (`32/?` means unfinished), summary, work number |
| An EPUB from another tool | whatever its package file has: usually title, author, summary, language and subjects; AO3-derived exports also carry the work number |
| Any EPUB | word count and chapter count, counted from the text |

Fics added before Browse existed get their details read once, the first time you open Browse (from the kept EPUB; books whose EPUB was never kept show with counts only until you [attach it](reader.md)).

## How it works

- `catalog/index.json` holds one compact entry per fic, so Browse reads one file however many fics there are, and filters in the browser. Designed for about 2,000 fics. The full summary of each is in `catalog/<bookId>.json`. See [Storage](storage.md).
- A fic is on the Shelf exactly when `library/<bookId>.json` exists. Browse-only fics have none until narration starts (`ensureLibraryEntry` in `lib/storage/library.ts`, called by the narrate route, `markNarrated` and **Narrate…**). `GET /api/books/[id]` does not make a Shelf entry for a fic that is in the catalog.
- `reading.json` holds the reading record.
- Code: `lib/catalog/` (types, parsing, filters and read state are pure and tested; `store.ts` is the server side), `app/browse/`, `components/browse/`, `app/api/catalog/`, `app/api/reading/`, `lib/storage/reading.ts`, `app/styles/browse.css`.

## Removing it

Browse does not change narration or playback. To take it out: delete the folders above and `lib/client/upload.ts`, the `browse.css` import, the Browse tab in `components/AppChrome.tsx`, the `browse` and catalog parts of `app/api/books/route.ts`, the `inCatalog` guard in `app/api/books/[id]/route.ts`, `useReadingProgress` in `components/reader/Reader.tsx`, and the catalog helpers in `lib/client/api.ts`.
