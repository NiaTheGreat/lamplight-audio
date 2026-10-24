# Adding books

## Uploading

Choose an EPUB on the **Add** screen, or drop one on the upload box. The file is parsed into chapters and the book appears in your library.

Only EPUB is supported. Pasting a link is a disabled placeholder on the Add screen (live scraping of websites is intentionally avoided).

## Large files

Hosts such as Vercel limit request bodies to about 4.5 MB. EPUBs over about 4 MB are therefore uploaded by the browser straight to cloud storage using a signed URL, then parsed on the server and the temporary file deleted. This needs a CORS rule on the storage bucket, see [Deployment](deployment.md). Small files work without it.

## What is skipped

With **Skip notes and summaries** on (the default), these are removed before narration:

- summaries and notes at the start of a book or chapter
- end notes
- front and back matter such as cover, table of contents and copyright pages

Turn the toggle off to have everything read. How detection works, and its limits, is described in [EPUB parsing](epub-parsing.md).

Each chapter's title is read aloud at the start of the chapter.

## Narrator and pronunciation list

When you add a book you choose its narrator (see [Narrators and voices](narrators.md)) and which [pronunciation list](pronunciations.md) to copy into it. The default narrator for new books is set in **Settings**.

## Re-uploading

Re-uploading an EPUB clears the saved audio locations for that book. Audio is cached under hashes of the text and settings, so chapters whose text and voice are unchanged are not paid for again.
