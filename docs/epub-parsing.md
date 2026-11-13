# EPUB parsing

`lib/epub.ts` turns an EPUB into chapters of plain text. It is the riskiest code in the project because EPUBs vary widely in structure.

## Chapters

Chapters follow the book's reading order. Each chapter's title comes from its first heading (or the document title). File names that look like paths are ignored as titles. Front matter such as cover, nav, table of contents, title page, colophon and copyright is skipped.

EPUBs converted from a PDF, where pieces are cut by page, are handled by recognising plain "Part N: ..." or "Chapter N" lines as chapter boundaries and merging stray pieces.

## Notes and summaries

With note-skipping on, the parser removes:

- files named like `preface` or `afterword`
- elements with common note and summary markers (`.meta`, `#notes`, `#summary`, `#endnotes`, `.notes`, `.summary`, `#preface`, `#afterword`)
- a heading or label such as "Summary", "Notes", "Chapter End Notes", "A/N" together with the blockquote that follows it
- pointer lines such as "See the end of the chapter for notes"
- small stray pieces between chapters, which are treated as notes

Landmark headings such as "Chapter Text" are not narrated.

Calibre-converted EPUBs turn note headings into plain paragraph labels and rename files to `*_split_000.xhtml`; the parser handles that case too.

## Reader copy

With the `format` option, `parseEpub` also returns each chapter as paragraphs with italics, bold, block quotes and scene breaks (`paras`). The narrated `text` is computed first and is never affected; the reader copy is dropped if it would not read exactly as `text`. See [Reader](reader.md).

## Work details

With the `meta` option, `parseEpub` also returns `Book.meta`: the summary, fandoms, rating, category, warnings, relationships, characters, tags, language, series, word count, chapter counts, complete or not, and dates (`lib/catalog/`). It is groundwork for the Browse view and nothing shows it yet. Details come from two places, the first one found for each field winning:

1. **An AO3 work-info block** (`<dl class="tags">` with Rating, Archive Warning, Category, Fandom, Relationship, Characters, Additional Tags, Language, Series and Stats, then the summary, and the link back to the work for its number). It sits in the preface, which narration skips, so it is read from the first few files and any file named like `preface`, before the skip. A work is complete when Stats says `Chapters: 5/5`; `3/?` and `3/10` are not.
2. **The EPUB's package file**: `dc:description` (summary), `dc:subject` (a fandom when the file has an `urn:ao3:<n>` identifier, otherwise tags), `dc:language` (turned into a name such as "English"), `dc:date`, and the AO3 work number.

Word count falls back to counting the parsed text (within a fraction of a percent of AO3's own count on the two real files tried), and the chapter count to the number of chapters found.

Files exported by tools other than AO3's own download may carry only the package-file details: no rating, tags, dates or complete flag. Those fields then stay empty rather than guessed. Reading details never touches `text`, the book id or the audio cache keys.

## Limits

The heuristics were written against a small number of real EPUBs. Other EPUBs (series, many chapters, unusual markup) may leak notes into the narration.

## Fixing a leak

1. Put a minimal example of the markup in `tests/epub.test.ts` as a failing test.
2. Adjust `lib/epub.ts` until it passes.
3. Run `npm test`.

Tests build small EPUBs in memory; do not commit real books.
