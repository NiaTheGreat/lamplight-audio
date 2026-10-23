// A stand-in for OpenAI's speech endpoint, for browser tests. It answers every request with
// silent MP3 audio long enough to pass the app's "too little audio" check. It never costs anything.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_OPENAI_PORT || 4010);
// One MPEG-1 Layer III frame (128 kbit/s, 44.1 kHz, no padding) is 417 bytes and plays as 26 ms of silence.
const frame = Buffer.alloc(417);
frame.set([0xff, 0xfb, 0x90, 0x00]);

createServer((req, res) => {
  if (req.method === "POST" && req.url?.endsWith("/audio/speech")) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const { input = "" } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      // Over 50 bytes per character (the app's minimum), and at least a couple of seconds.
      const frames = Math.max(80, Math.ceil((input.length * 60) / frame.length));
      res.setHeader("Content-Type", "audio/mpeg");
      res.end(Buffer.concat(Array.from({ length: frames }, () => frame)));
    });
    return;
  }
  if (req.url === "/health") return void res.end("ok");
  res.statusCode = 404;
  res.end("not found");
}).listen(port, "127.0.0.1", () => console.log(`fake OpenAI on ${port}`));
