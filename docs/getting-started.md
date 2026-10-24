# Getting started

## Requirements

- Node.js and npm
- An OpenAI API key (narration is paid per character, see [Cost and limits](cost-and-limits.md))

## Run locally

```bash
npm install
cp .env.example .env.local   # then add your OPENAI_API_KEY
npm run dev
```

Open http://localhost:3000. Locally, parsed books and audio are cached in `./.cache`, so no cloud storage is needed.

## Your first book

1. Open **Add** and choose an EPUB (or drop it on the box).
2. Pick a narrator and, optionally, a [pronunciation list](pronunciations.md).
3. Leave **Skip notes and summaries** on unless you want them read aloud.
4. Open the book from the library and press play on a chapter. The first time a chapter plays it is narrated, which can take a minute or more. After that it plays from the cache for free.

## Run with Docker

To run it on your own computer or a small server without Node, use Docker. The steps are in the [README](../README.md#self-host-docker); phone access over HTTPS is covered in [Deployment](deployment.md).

## Optional: more narrators

Set `DEEPINFRA_API_KEY` to turn on the Kokoro voices, which cost far less, or `ELEVENLABS_API_KEY` for ElevenLabs voices (the priciest option). See [Narrators and voices](narrators.md).

## Next steps

- To use it from your phone, see [Deployment](deployment.md).
- Before sharing a deployment or key, read "Keeping your keys safe" in the [README](../README.md).
- To pre-narrate a whole book, see [Narrating in the background](background-narration.md).
