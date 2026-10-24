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

## Limits

The heuristics were written against a small number of real EPUBs. Other EPUBs (series, many chapters, unusual markup) may leak notes into the narration.

## Fixing a leak

1. Put a minimal example of the markup in `tests/epub.test.ts` as a failing test.
2. Adjust `lib/epub.ts` until it passes.
3. Run `npm test`.

Tests build small EPUBs in memory; do not commit real books.
