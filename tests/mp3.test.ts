import { describe, expect, it } from "vitest";
import { cleanMp3, inspectMp3, joinMp3 } from "@/lib/narration/mp3";

// MPEG1 layer III, 128 kbps, 44.1 kHz, stereo, no CRC: 417-byte frames.
const header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
const frame = (fill: number) => Buffer.concat([header, Buffer.alloc(413, fill)]);
const infoFrame = () => {
  const f = Buffer.alloc(417);
  header.copy(f);
  f.write("Info", 4 + 32, "latin1");
  return f;
};
const id3 = (bodySize: number) =>
  Buffer.concat([Buffer.from("ID3\x04\x00\x00\x00\x00\x00" + String.fromCharCode(bodySize), "latin1"), Buffer.alloc(bodySize)]);

describe("cleanMp3", () => {
  it("leaves bare audio frames alone", () => {
    const audio = Buffer.concat([frame(1), frame(2)]);
    expect(cleanMp3(audio).equals(audio)).toBe(true);
  });
  it("strips an ID3 tag and the Xing/Info frame in front", () => {
    const audio = Buffer.concat([frame(1), frame(2)]);
    const wrapped = Buffer.concat([id3(20), infoFrame(), audio]);
    expect(cleanMp3(wrapped).equals(audio)).toBe(true);
  });
  it("strips a trailing ID3v1 tag", () => {
    const audio = frame(3);
    const tag = Buffer.concat([Buffer.from("TAG", "latin1"), Buffer.alloc(125)]);
    expect(cleanMp3(Buffer.concat([audio, tag])).equals(audio)).toBe(true);
  });
  it("does not touch data that isn't MP3 frames", () => {
    const junk = Buffer.alloc(1000, 1);
    expect(cleanMp3(junk).equals(junk)).toBe(true);
  });
});

describe("inspectMp3", () => {
  it("counts frames and flags extra length headers in a joined file", () => {
    const piece = Buffer.concat([infoFrame(), frame(1), frame(2)]);
    const joined = Buffer.concat([piece, piece]); // the buggy join: an Info frame in the middle too
    const r = inspectMp3(joined);
    expect(r.frames).toBe(6);
    expect(r.infoFramesAt).toEqual([0, 3 * 417]);
    expect(r.firstFrame).toMatchObject({ mpegVersion: "MPEG1", bitrateKbps: 128, sampleRate: 44100 });
    expect(r.seconds).toBeCloseTo((4 * 1152) / 44100, 1);
    const clean = inspectMp3(Buffer.concat([cleanMp3(piece), cleanMp3(piece)]));
    expect(clean.infoFramesAt).toEqual([]);
    expect(clean.frames).toBe(4);
  });
  it("reports where it lost sync", () => {
    const r = inspectMp3(Buffer.concat([frame(1), Buffer.alloc(100, 7)]));
    expect(r.lostSyncAt).toBe(417);
  });
});

// MPEG2 layer III, mono, 24 kHz, as Kokoro makes it: frame length = 72 * bitrate / 24000.
const v2 = (bitrateIdx: number, fill: number) => {
  const kbps = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][bitrateIdx];
  const len = Math.floor((72 * kbps * 1000) / 24000);
  return Buffer.concat([Buffer.from([0xff, 0xf3, (bitrateIdx << 4) | 0x04, 0xc4]), Buffer.alloc(len - 4, fill)]);
};
const v2Info = () => {
  const f = v2(6, 0); // 48 kbps: 144 bytes
  f.write("Info", 4 + 9, "latin1");
  return f;
};

describe("joining variable-bitrate pieces (Kokoro)", () => {
  it("strips every length header and writes one correct one up front", () => {
    // Each piece is several sentence streams, each opening with its own Info frame.
    const sentence = () => Buffer.concat([v2Info(), v2(1, 1), v2(8, 2), v2(3, 3), v2(8, 4)]);
    const piece = Buffer.concat([sentence(), sentence(), sentence()]);
    const joined = joinMp3([piece, piece], { repair: true });

    const r = inspectMp3(joined);
    expect(r.lostSyncAt).toBeUndefined();
    expect(r.infoFramesAt).toEqual([0]); // only ours
    expect(r.frames).toBe(1 + 6 * 4 * 1 + 0 + 6 * 0); // our header + 6 sentences x 4 audio frames
    expect(r.seconds).toBeCloseTo((24 * 576) / 24000, 1);

    // The header states the true frame count and file size.
    const frameLen = 144;
    const tag = 4 + 9;
    expect(joined.toString("latin1", tag, tag + 4)).toBe("Xing");
    expect(joined.readUInt32BE(tag + 8)).toBe(24);
    expect(joined.readUInt32BE(tag + 12)).toBe(joined.length);
    expect(joined.length).toBeGreaterThan(frameLen);
    // Seek table starts at the beginning of the audio and never goes backwards.
    const toc = [...joined.subarray(tag + 16, tag + 116)];
    expect(toc[0]).toBe(Math.floor((frameLen / joined.length) * 256));
    expect(toc.every((v, i) => i === 0 || v >= toc[i - 1])).toBe(true);
  });
  it("leaves constant-bitrate audio as plain concatenation", () => {
    const a = Buffer.concat([frame(1), frame(2)]);
    expect(joinMp3([a, a], { repair: true }).equals(Buffer.concat([a, a]))).toBe(true);
  });
  it("does nothing but concatenate unless asked to repair (other providers)", () => {
    const piece = Buffer.concat([v2Info(), v2(1, 1), v2(8, 2)]);
    expect(joinMp3([piece, piece]).equals(Buffer.concat([piece, piece]))).toBe(true);
  });
});
