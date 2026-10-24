# Deployment

The app is built for Vercel with Cloudflare R2 storage, but any host that runs Next.js 15 and can reach an S3-compatible bucket works.

## Vercel

1. Get the code into your own GitHub account and deploy it from there. There are two ways, and the difference is updates:
   - **Deploy button (no updates).** The "Deploy with Vercel" button in the [README](../README.md#quick-start) copies the repo into your account and prompts for the environment variables. The copy is standalone and does not follow later changes to this repo.
   - **Fork (updates).** Fork the repo on GitHub, then import your fork at vercel.com/new. The fork stays linked to this repo: when new changes land, click **Sync fork** on your fork's GitHub page and Vercel redeploys it. Syncing is one click, not automatic.
2. Add environment variables: `OPENAI_API_KEY` and `APP_PASSWORD`. The app refuses to run in production without a password. See [Configuration](configuration.md) for the rest.
3. Create a Cloudflare R2 bucket (private is fine) and an API token with Object Read and Write on it. Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` to Vercel.
4. Add a CORS rule to the bucket (Settings, CORS Policy) so the browser can upload large EPUBs directly:

   ```json
   [{"AllowedOrigins": ["https://YOUR-APP.vercel.app"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600}]
   ```

   Without it, small EPUBs still work and large ones fail with a message about CORS.
5. Turn off Vercel Deployment Protection for the production domain. The background worker calls its own URL and preview URLs behind SSO will not chain.
6. Deploy, open the URL on your phone and choose "Add to Home Screen".

If requests time out on your plan, enable Fluid Compute in the Vercel project settings.

## Docker (self-hosting)

To run it on your own computer, NAS or small server without Vercel or Cloudflare, use `docker-compose.yml`. The steps (download the compose file and `.env.example`, set `OPENAI_API_KEY` and a strong `APP_PASSWORD`, `docker compose up -d`) are in the [README](../README.md#self-host-docker). Books and audio are kept in the `lamplight-data` volume, so back that up.

## Keys

Spend caps, rotating keys and what to do if one leaks are covered in "Keeping your keys safe" in the [README](../README.md).

## Notes

- The bucket stays private. Audio is streamed through short-lived (one hour) signed links handed out by the password-protected app.
- R2's free tier covers typical use.
- Do not commit `.env.local`. Use the host's environment variables for secrets.
- If you rename or move the GitHub repository, open the Vercel project's Settings, then Git, and check it still points at the repo. Reconnect it there if it does not; your environment variables are kept.
