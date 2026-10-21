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
2. Add environment variables: `OPENAI_API_KEY` and `APP_PASSWORD` (the app refuses to run in production without a password).
3. In the project's **Storage** tab, create a **Blob** store and connect it. That sets `BLOB_READ_WRITE_TOKEN` automatically and gives the app somewhere to keep parsed books and cached audio.
4. Deploy, open the URL on your phone, and "Add to Home Screen".

Narrating a long first chapter can take a minute or more. If requests time out on your plan, enable Fluid Compute in the Vercel project settings.

## Cost

Narration is the only real cost, and it is paid once per chapter (replays come from cache).

| Model | Price | A 100,000-word fic (about 600k characters) |
| --- | --- | --- |
| `gpt-4o-mini-tts` (default) | about $0.015 per minute of audio | roughly $10 |
| `tts-1` | $15 per 1M characters | roughly $9 |

Set `OPENAI_TTS_MODEL` to switch. `tts-1` has no tone instructions; `gpt-4o-mini-tts` does (`TTS_INSTRUCTIONS`).

## Notes

- Blob objects get unguessable URLs but are technically public. The app itself is behind the password; don't upload anything you'd consider sensitive.
- Chapter MP3s are made by joining several API responses, so some players show a slightly off total duration. Playback is fine.
- Only EPUB is supported. AO3's "Download > EPUB" is the best input because notes and summaries live in separate sections.

## Develop

```bash
npm test         # parser, chunking, and range-serving tests
npm run typecheck
```
