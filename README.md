# audiobook-generator

Upload an EPUB (AO3 downloads work great) and listen to it as an audiobook in your phone's browser. Narration is generated once per chapter with OpenAI's text-to-speech, cached, and then streamed or downloaded as an MP3.

- **Skips author's notes and summaries** (toggle on the upload form)
- **Streams** with play/pause/seek, speed control, lock-screen controls, and auto-advance to the next chapter
- **Downloads** any chapter as an MP3
- **Resumes** where you left off
- **Password-protected** when deployed, so nobody else can spend your OpenAI credits

## Run locally

```bash
npm install
cp .env.example .env.local   # then add your OPENAI_API_KEY
npm run dev
```

Open http://localhost:3000. Locally, audio is cached in `./.cache`.

## Deploy (Vercel)

1. Import this repo at vercel.com/new.
2. Add environment variables: `OPENAI_API_KEY` and `APP_PASSWORD` (the app refuses to run in production without a password). Optional: `MONTHLY_CHAR_LIMIT` (default 3,000,000 characters, about $48) stops narration once reached.
3. Create a Cloudflare **R2** bucket for parsed books and cached audio: in the Cloudflare dashboard go to R2, create a bucket (private is fine), then **Manage R2 API Tokens** and create a token with **Object Read & Write** on that bucket. Add these variables in Vercel: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. 
   **One more bucket setting, for EPUBs over ~4 MB** (Vercel won't accept bigger request bodies, so the browser uploads them straight to R2): open the bucket's **Settings → CORS Policy → Add** and paste
   ```json
   [{"AllowedOrigins": ["https://YOUR-APP.vercel.app"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600}]
   ```
   using your real site address. Without it, small EPUBs still work and large ones fail with a message about CORS.
   (R2's free tier covers this app: 10 GB, millions of operations, no charge for data leaving. Vercel Blob's Hobby limits did not.)
4. Deploy, open the URL on your phone, and "Add to Home Screen".

Narrating a long first chapter can take a minute or more. If requests time out on your plan, enable Fluid Compute in the Vercel project settings.

**Background narration:** "Narrate whole book in the background" works without keeping the page open. A worker route (`/api/worker/[id]`) narrates for up to ~250 seconds, saves its place in R2 (`jobs/<id>.json`), then calls itself to continue. If a hop is lost, the page shows "stalled" after 8 minutes with a Resume button. It needs the production URL to be reachable from the function itself, so turn off Vercel Deployment Protection for the production domain (preview URLs behind SSO won't chain).

## Cost

Narration is the only real cost, and it is paid once per chapter (replays come from cache).

| Model | Price | A 100,000-word fic (about 600k characters) |
| --- | --- | --- |
| `gpt-4o-mini-tts` (default) | about $0.015 per minute of audio | roughly $10 |
| `tts-1` | $15 per 1M characters | roughly $9 |

Set `OPENAI_TTS_MODEL` to switch. `tts-1` has no tone instructions; `gpt-4o-mini-tts` does (`TTS_INSTRUCTIONS`).

## Notes

- The R2 bucket is private. Audio is streamed through short-lived (one hour) signed links that the password-protected app hands out.
- Chapter MP3s are made by joining several API responses, so some players show a slightly off total duration. Playback is fine.
- Only EPUB is supported. AO3's "Download > EPUB" is the best input because notes and summaries live in separate sections.

## Develop

```bash
npm test         # parser, chunking, and range-serving tests
npm run typecheck
```
