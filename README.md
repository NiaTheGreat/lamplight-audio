# lamplight-audio

Upload an EPUB and listen to it as an audiobook in your phone's browser (or on desktop browseer). Narration is generated once per chapter with OpenAI's text-to-speech, cached, and then streamed or downloaded as an MP3.

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

## Self-host (Docker)

Run it on your own computer, a NAS or a small server. No Vercel and no Cloudflare: books and audio are kept in a Docker volume.

```bash
curl -O https://raw.githubusercontent.com/NiaTheGreat/lamplight-audio/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/NiaTheGreat/lamplight-audio/main/.env.example
# edit .env: set OPENAI_API_KEY and a strong APP_PASSWORD
docker compose up -d
```

Open http://localhost:3000 (or the machine's address on your network, port 3000). Updating is `docker compose pull && docker compose up -d`. Your library lives in the `lamplight-data` volume, so back that up.

- **Phone access.** Lock-screen controls and "Add to Home Screen" need HTTPS. The easy ways are [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve) or a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Once you reach the app over https, remove `COOKIE_SECURE: "false"` from `docker-compose.yml`.
- **Reverse proxy.** The background worker calls itself on the container's own port (`WORKER_ORIGIN`), so a proxy needs no special setup.
- **Keys.** Read "Keeping your keys safe" below; the same advice applies. Don't expose port 3000 to the internet without HTTPS and a strong `APP_PASSWORD`.
- **Your own R2 bucket** also works: fill in the `R2_*` variables and the volume is no longer used for audio.

## Deploy (Vercel)

1. Import this repo at vercel.com/new.
2. Add environment variables: `OPENAI_API_KEY` and `APP_PASSWORD` (the app refuses to run in production without a password). Optional: `DEEPINFRA_API_KEY` turns on the Kokoro narrators (about $1 per million characters, far cheaper than OpenAI's ~$16), `ELEVENLABS_API_KEY` turns on the ElevenLabs Flash narrators (female voices; about $60 per million characters, the priciest option), and `MONTHLY_BUDGET_USD` (default 30) stops narration once the estimated month's spending reaches it.
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

## Keeping your keys safe

The app holds paid API keys, so set it up with these in mind:

- **Spend caps.** Set a hard monthly limit in the OpenAI, DeepInfra and ElevenLabs dashboards. `MONTHLY_BUDGET_USD` is only the app's own estimate.
- **Least privilege.** Use an OpenAI project key with a project budget, and an R2 token limited to the one bucket with Object Read & Write.
- **Vercel env vars.** Mark every secret **Sensitive** (it can't be read back after saving), give it to **Production** only, and use separate keys for local development.
- **Never commit `.env.local`.** It is gitignored; `.env.example` lists the variable names only. CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every PR and fails if a key-shaped string is committed. Also turn on GitHub's **secret scanning** and **push protection** in your repository settings.
- **Rotating.** OpenAI, DeepInfra and ElevenLabs keys can only be rotated by hand in their dashboards: create a new key, update it in Vercel, redeploy, then delete the old one. Do this every few months, and straight away if a key was ever pasted or committed (removing it from git history is not enough).
- **A strong `APP_PASSWORD`**, since anyone who gets in can spend your credits.

## Notes

- The R2 bucket is private. Audio is streamed through short-lived (one hour) signed links that the password-protected app hands out.
- Chapter MP3s are made by joining several API responses, so some players show a slightly off total duration. Playback is fine.
- Only EPUB is supported. AO3's "Download > EPUB" is the best input because notes and summaries live in separate sections.

## Documentation

Guides for using, deploying and contributing are in [`docs/`](docs/README.md).

## Develop

```bash
npm test         # unit tests
npm run lint
npm run format:check
npm run typecheck   # see CONTRIBUTING.md for the full list
```

## Using this responsibly

- This is a single-user tool: one shared password and one shared library. It is not built for strangers to share a deployment.
- You bring your own OpenAI, DeepInfra and ElevenLabs keys, pay for your own narration, and follow each provider's terms.
- The narration is AI-generated. OpenAI's usage policies ask that listeners are told the voice is not human, so say so if you share the audio.
- Only narrate works you have the right to use. Many fic authors do not want their work turned into AI audio or shared outside the site.

## License

[MIT](LICENSE).
