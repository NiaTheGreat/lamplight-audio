# Configuration

All settings are environment variables. `.env.example` lists them; locally put them in `.env.local`.

## Required

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI narration |
| `APP_PASSWORD` | Shared login password. Required in production. |

## Narration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEEPINFRA_API_KEY` | none | Enables Kokoro voices |
| `ELEVENLABS_API_KEY` | none | Enables ElevenLabs voices |
| `ELEVENLABS_TTS_MODEL` | built in | Override the ElevenLabs model |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | Or `tts-1` |
| `OPENAI_TTS_VOICE` | `ballad` | Default OpenAI voice |
| `TTS_INSTRUCTIONS` | none | Tone instructions (`gpt-4o-mini-tts` only) |
| `TTS_END_PAD` | built in | Text appended to each piece so the last words are not clipped. Empty disables it. |

## Spending limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONTHLY_BUDGET_USD` | `30` | Stop narrating at this estimated monthly spend |
| `MONTHLY_CHAR_LIMIT` | none | Optional cap in characters |

## Storage

Leave empty locally; audio is then cached in `./.cache`.

| Variable | Purpose |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account |
| `R2_ACCESS_KEY_ID` | R2 API token |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | Bucket name |
| `R2_ENDPOINT` | Override the R2 endpoint (optional) |
| `CACHE_DIR` | Local cache folder (default `./.cache`) |

## Testing

`OPENAI_BASE_URL`, `DEEPINFRA_BASE_URL` and `ELEVENLABS_BASE_URL` point a provider at a mock server. Tests must never call the real OpenAI API.
