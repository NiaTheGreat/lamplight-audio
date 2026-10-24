/**
 * MP3 pieces are joined by simply concatenating them, but many encoders start each piece with an
 * ID3 tag and a silent "Xing"/"Info" frame that tells players the length and a seek table for
 * that one piece. Left in the middle of a joined file they make players mis-measure the length and
 * jump back to the start when you seek. So every piece is stripped to bare audio frames first.
 */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

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

type Walked = {
  /** Audio frames only: no tags, no length headers, no junk. */
  audio: Buffer;
  lengths: number[];
  bitrateIdx: Set<number>;
  /** The first audio frame's header, as a template for a length header. */
  first?: { b1: number; b2: number; b3: number; version: number };
};

const SIDE_INFO = (version: number, mono: boolean) =>
  version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;

/**
 * Read an MP3 frame by frame, keeping only audio frames. Some encoders (Kokoro via DeepInfra) put a
 * Xing/Info frame at the start of every sentence's stream, hundreds of them in one chapter, and
 * a few put ID3 tags in; players take the first for the whole file's length and seek table.
 */
function walk(input: Buffer): Walked {
  const kept: Buffer[] = [];
  const lengths: number[] = [];
  const bitrateIdx = new Set<number>();
  let first: Walked["first"];
  let at = 0;
  while (input.toString("latin1", at, at + 3) === "ID3" && at + 10 <= input.length) {
    const size =
      ((input[at + 6] & 0x7f) << 21) |
      ((input[at + 7] & 0x7f) << 14) |
      ((input[at + 8] & 0x7f) << 7) |
      (input[at + 9] & 0x7f);
    at += 10 + size + (input[at + 5] & 0x10 ? 10 : 0);
  }
  // A frame counts only if the next one follows right after it (or it ends the data).
  const valid = (pos: number) => {
    const f = frameAt(input, pos);
    if (!f || pos + f.length > input.length) return null;
    const next = pos + f.length;
    const trailer =
      input.length - next === 128 && input.toString("latin1", next, next + 3) === "TAG";
    return next === input.length || trailer || frameAt(input, next) ? f : null;
  };
  while (at + 4 <= input.length) {
    const f = valid(at);
    if (!f) {
      at++; // junk (an ID3v1 tag, a damaged byte): skip to the next real frame
      continue;
    }
    if (!isInfoFrame(input, at, f)) {
      kept.push(input.subarray(at, at + f.length));
      lengths.push(f.length);
      bitrateIdx.add((input[at + 2] >> 4) & 15);
      first ??= {
        b1: input[at + 1],
        b2: input[at + 2],
        b3: input[at + 3],
        version: (input[at + 1] >> 3) & 3,
      };
    }
    at += f.length;
  }
  return { audio: Buffer.concat(kept), lengths, bitrateIdx, first };
}

/** Audio frames only. Data with no MP3 frames in it is returned as it came. */
export function cleanMp3(input: Buffer): Buffer {
  const w = walk(input);
  return w.lengths.length === 0 ? input : w.audio;
}

/**
 * A Xing frame saying exactly how many frames and bytes follow, with a seek table, so a player
 * knows the true length of a variable-bitrate file and can jump to any point in it.
 */
function xingFrame(
  first: NonNullable<Walked["first"]>,
  lengths: number[],
  audioBytes: number,
): Buffer {
  const { b1, b2, b3, version } = first;
  const mono = ((b3 >> 6) & 3) === 3;
  const tagAt = 4 + SIDE_INFO(version, mono);
  const needed = tagAt + 4 + 4 + 4 + 4 + 100;
  const table = version === 3 ? BITRATES_V1 : BITRATES_V2;
  const rate = RATES[version][(b2 >> 2) & 3];
  let idx = 1;
  while (idx < 14 && Math.floor(((version === 3 ? 144 : 72) * table[idx] * 1000) / rate) < needed)
    idx++;
  const length = Math.floor(((version === 3 ? 144 : 72) * table[idx] * 1000) / rate);

  const frame = Buffer.alloc(length);
  frame[0] = 0xff;
  frame[1] = b1 | 1; // no CRC
  frame[2] = (idx << 4) | (b2 & 0x0c); // this bitrate, same sample rate, no padding
  frame[3] = b3 & 0xc0; // same channel mode
  frame.write("Xing", tagAt, "latin1");
  frame.writeUInt32BE(0x7, tagAt + 4); // frames, bytes and seek table present
  frame.writeUInt32BE(lengths.length, tagAt + 8);
  const total = length + audioBytes;
  frame.writeUInt32BE(total, tagAt + 12);

  // Seek table: how far into the file (of 256) each percent of the audio is.
  const before: number[] = [0];
  for (const l of lengths) before.push(before[before.length - 1] + l);
  for (let i = 0; i < 100; i++) {
    const frameIdx = Math.floor((i / 100) * lengths.length);
    frame[tagAt + 16 + i] = Math.min(255, Math.floor(((length + before[frameIdx]) / total) * 256));
  }
  return frame;
}

/**
 * Join MP3 pieces into one file. By default this just concatenates, exactly as OpenAI audio always
 * has been. With `repair` (Kokoro only), every piece is stripped to bare audio frames and, if the
 * result is variable bitrate, a correct length header is put in front.
 */
export function joinMp3(pieces: Buffer[], opts: { repair?: boolean } = {}): Buffer {
  // Only for providers whose audio needs it (Kokoro). Others are joined exactly as they always were.
  if (!opts.repair) return Buffer.concat(pieces);
  const walked = pieces.map(walk).filter((w) => w.lengths.length > 0);
  if (walked.length === 0) return Buffer.concat(pieces);
  const audio = Buffer.concat(walked.map((w) => w.audio));
  const bitrates = new Set(walked.flatMap((w) => [...w.bitrateIdx]));
  if (bitrates.size <= 1) return audio;
  const lengths = walked.flatMap((w) => w.lengths);
  return Buffer.concat([xingFrame(walked[0].first!, lengths, audio.length), audio]);
}

export type Mp3Report = {
  bytes: number;
  id3v2Bytes: number;
  /** Xing/Info/VBRI length-header frames found anywhere (more than one in a joined file is the seeking bug). */
  infoFramesAt: number[];
  frames: number;
  firstFrame?: { mpegVersion: string; bitrateKbps: number; sampleRate: number; mono: boolean };
  bitrates: Record<string, number>;
  sampleRates: number[];
  seconds: number;
  /** Byte offset where frame parsing lost sync, if it did. */
  lostSyncAt?: number;
};

const SAMPLES_PER_FRAME: Record<number, number> = { 3: 1152, 2: 576, 0: 576 };

/** Walk an MP3 frame by frame and describe it, to see why a player can't measure or seek it. */
export function inspectMp3(b: Buffer): Mp3Report {
  const report: Mp3Report = {
    bytes: b.length,
    id3v2Bytes: 0,
    infoFramesAt: [],
    frames: 0,
    bitrates: {},
    sampleRates: [],
    seconds: 0,
  };
  let at = 0;
  while (b.toString("latin1", at, at + 3) === "ID3" && at + 10 <= b.length) {
    const size =
      ((b[at + 6] & 0x7f) << 21) |
      ((b[at + 7] & 0x7f) << 14) |
      ((b[at + 8] & 0x7f) << 7) |
      (b[at + 9] & 0x7f);
    at += 10 + size;
    report.id3v2Bytes = at;
  }
  const rates = new Set<number>();
  while (at + 4 <= b.length) {
    const f = frameAt(b, at);
    if (!f) {
      if (b.toString("latin1", b.length - 128, b.length - 125) === "TAG" && at >= b.length - 128)
        break;
      report.lostSyncAt = at;
      break;
    }
    const version = (b[at + 1] >> 3) & 3;
    const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[(b[at + 2] >> 4) & 15];
    const rate = RATES[version][(b[at + 2] >> 2) & 3];
    if (report.frames === 0) {
      report.firstFrame = {
        mpegVersion: version === 3 ? "MPEG1" : version === 2 ? "MPEG2" : "MPEG2.5",
        bitrateKbps: bitrate,
        sampleRate: rate,
        mono: ((b[at + 3] >> 6) & 3) === 3,
      };
    }
    if (isInfoFrame(b, at, f)) report.infoFramesAt.push(at);
    else report.seconds += SAMPLES_PER_FRAME[version] / rate;
    report.bitrates[bitrate] = (report.bitrates[bitrate] ?? 0) + 1;
    rates.add(rate);
    report.frames++;
    at += f.length;
  }
  report.sampleRates = [...rates];
  report.seconds = Math.round(report.seconds * 10) / 10;
  return report;
}
