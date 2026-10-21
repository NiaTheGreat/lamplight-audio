import { NextResponse } from "next/server";
import { parseEpub } from "@/lib/epub";
import { putObject } from "@/lib/storage";
import { summarize } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Upload an EPUB, parse it into chapters, and store the parsed book. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Couldn't read the upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an EPUB file first." }, { status: 400 });
  }

  const skipNotes = form.get("skipNotes") !== "false";

  try {
    const book = await parseEpub(Buffer.from(await file.arrayBuffer()), { skipNotes });
    await putObject(`books/${book.id}.json`, JSON.stringify(book), "application/json");
    return NextResponse.json(summarize(book));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read that EPUB.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
