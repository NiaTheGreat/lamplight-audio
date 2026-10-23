import { defaultVoice } from "./tts";
import type { Book } from "../types";

/** Who narrates a chapter: its own voice if it has one, else the fic's. */
export function voiceFor(book: Pick<Book, "voice" | "chapterVoices">, index: number): string {
  return book.chapterVoices?.[index] ?? book.voice ?? defaultVoice();
}
