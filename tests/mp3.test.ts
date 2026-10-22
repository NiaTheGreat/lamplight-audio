import { describe, expect, it } from "vitest";
import { cleanMp3, inspectMp3 } from "@/lib/mp3";

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
