import { NextResponse } from "next/server";
import { voiceFor } from "@/lib/narration/chaptervoice";
import { audioKey } from "@/lib/narration/tts";
import { spokenText } from "@/lib/pronunciation/pronunciation";
import { chapterText, plainParas } from "@/lib/reader/format";
import { readerEnabled } from "@/lib/reader/flag";
import { splitSentences } from "@/lib/reader/sentences";
import { chunkTimings, getReaderBook } from "@/lib/reader/store";
import { sentenceTimes } from "@/lib/reader/timeline";
import type { ReaderChapterData } from "@/lib/reader/types";
import { getObject, hasObject } from "@/lib/storage/storage";
import { BOOK_ID_RE, type Book } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One chapter for the reader: its paragraphs (formatted when the EPUB is saved, else plain), and,
 * when the chapter is narrated, when each sentence starts in the audio.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; chapter: string }> },
) {
  if (!readerEnabled()) return new Response("The reader is turned off.", { status: 404 });
  const { id, chapter } = await params;
  if (!BOOK_ID_RE.test(id)) return new Response("Bad book id.", { status: 400 });
  const raw = await getObject(`books/${id}.json`);
  if (!raw) return new Response("Book not found.", { status: 404 });
  const book = JSON.parse(raw.toString("utf8")) as Book;
  const ch = book.chapters[Number(chapter)];
  if (!ch) return new Response("Chapter not found.", { status: 404 });

  // Formatted paragraphs only count if they read exactly as the narrated text.
  const saved = (await getReaderBook(id))?.chapters[ch.index];
  const formatted = Boolean(saved && chapterText(saved) === ch.text);
  const paras = formatted ? saved! : plainParas(ch.text);

  const voice = voiceFor(book, ch.index);
  const spoken = spokenText(book, ch.index, ch.text);
  const narrated = await hasObject(audioKey(spoken, voice));

  let times: number[] | null = null;
  let total: number | null = null;
  if (narrated) {
    try {
      const timings = await chunkTimings(id, ch.index, spoken, voice);
      if (timings) {
        times = sentenceTimes(
          ch.text,
          splitSentences(paras).map((s) => s.off),
          spoken,
          timings,
        );
        total = timings.reduce((a, t) => a + t.d, 0);
      }
    } catch {
      times = null; // the page still reads; it just doesn't follow the audio
    }
  }

  const data: ReaderChapterData = {
    chapter: ch.index,
    title: ch.title,
    paras,
    times,
    total,
    narrated,
    formatted,
  };
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
