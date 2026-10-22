/**
 * MP3 pieces are joined by simply concatenating them, but many encoders start each piece with an
 * ID3 tag and a silent "Xing"/"Info" frame that tells players the length and a seek table for
 * that one piece. Left in the middle of a joined file they make players mis-measure the length and
 * jump back to the start when you seek. So every piece is stripped to bare audio frames first.
 */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

type Frame = { length: number; tagAt: number };

/** Layer III frame header at `at`, or null. Gives the frame length and where a Xing/Info tag would sit. */
function frameAt(b: Buffer, at: number): Frame | null {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  if (version === 1 || ((b[at + 1] >> 1) & 3) !== 1) return null; // reserved version, or not layer III
  const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[(b[at + 2] >> 4) & 15];
  const rate = RATES[version][(b[at + 2] >> 2) & 3];
  if (!bitrate || !rate) return null;
  const padding = (b[at + 2] >> 1) & 1;
  const mono = ((b[at + 3] >> 6) & 3) === 3;
  const length = Math.floor(((version === 3 ? 144 : 72) * bitrate * 1000) / rate) + padding;
  const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const crc = (b[at + 1] & 1) === 0 ? 2 : 0;
  return { length, tagAt: at + 4 + crc + side };
}

const isInfoFrame = (b: Buffer, at: number, f: Frame) => {
  const tag = b.toString("latin1", f.tagAt, f.tagAt + 4);
  return tag === "Xing" || tag === "Info" || b.toString("latin1", at + 36, at + 40) === "VBRI";
};

export function cleanMp3(input: Buffer): Buffer {
  let start = 0;
  let end = input.length;

  while (input.toString("latin1", start, start + 3) === "ID3" && start + 10 <= end) {
    const size = ((input[start + 6] & 0x7f) << 21) | ((input[start + 7] & 0x7f) << 14) | ((input[start + 8] & 0x7f) << 7) | (input[start + 9] & 0x7f);
    start += 10 + size + (input[start + 5] & 0x10 ? 10 : 0);
  }
  const first = frameAt(input, start);
  if (first && isInfoFrame(input, start, first)) start += first.length;

  if (end - start >= 128 && input.toString("latin1", end - 128, end - 125) === "TAG") end -= 128;
  return start >= end ? input : input.subarray(start, end);
}
