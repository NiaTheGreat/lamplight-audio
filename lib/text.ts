/**
 * Split text into pieces small enough for the OpenAI speech endpoint
 * (hard limit 4096 characters per request). Splits on paragraph breaks first,
 * then sentences, then words, so narration never cuts mid-sentence unless it
 * has to.
 */
export function splitForTts(text: string, max = 3800): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  let current = "";
  const flush = () => {
    if (current) {
      out.push(current);
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    const pieces = paragraph.length > max ? splitLong(paragraph, max) : [paragraph];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > max) flush();
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  flush();
  return out;
}

function splitLong(paragraph: string, max: number): string[] {
  const out: string[] = [];
  let current = "";
  const sentences = paragraph.split(/(?<=[.!?…]["”’)]?)\s+/);
  for (const sentence of sentences) {
    const pieces = sentence.length > max ? hardSplit(sentence, max) : [sentence];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 1 > max) {
        out.push(current);
        current = "";
      }
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) out.push(current);
  return out;
}

function hardSplit(sentence: string, max: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of sentence.split(/\s+/)) {
    if (word.length > max) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
      continue;
    }
    if (current && current.length + word.length + 1 > max) {
      out.push(current);
      current = "";
    }
    current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out;
}
