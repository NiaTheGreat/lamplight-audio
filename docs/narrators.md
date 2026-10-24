# Narrators and voices

A **narrator** is a string identifying a voice.

| Form | Meaning |
| --- | --- |
| `ballad` (a plain voice name) | An OpenAI voice |
| `deepinfra:kokoro:af_bella` | A Kokoro-82M voice through DeepInfra |
| `elevenlabs:flash:<voiceId>` | An ElevenLabs Flash v2.5 voice |

## Providers

- **OpenAI** (default). Model `gpt-4o-mini-tts`, or `tts-1` by setting `OPENAI_TTS_MODEL`. `gpt-4o-mini-tts` supports tone instructions (`TTS_INSTRUCTIONS`).
- **Kokoro via DeepInfra.** About 1/16th the price. Enabled by `DEEPINFRA_API_KEY`; without it the Kokoro voices show as "needs a key".

- **ElevenLabs Flash v2.5.** Female premade voices, about $60 per million characters (the priciest option). Enabled by `ELEVENLABS_API_KEY`. Not yet tested against the real API.

Hear voices in **Settings** before choosing.

## A book's narrator

Every book has a default narrator, chosen when it is added (new books get the default from Settings). You can change it at any time, but not while a narration job is running.

Chapters that are already narrated stay pinned to the voice they were narrated in, so changing the narrator only affects chapters narrated afterwards. This also means a half-listened book never changes voice behind you.

## Per-chapter voices

A range of chapters can be read in a different voice without changing the book's default: choose a voice when narrating a range, or use the re-read form ([Re-reading chapters](rereading.md)). Only chapters that are not yet narrated are affected unless you re-read them.

## Why audio is cached by voice

Each chunk of audio is stored under a hash of its text and settings. Changing narrator creates new audio; switching back reuses the old audio for free. Keys for plain OpenAI voice names must never change, since audio already paid for lives under them (`tests/cachekeys.test.ts` pins them).

## Known gaps

ElevenLabs has been tested only against a local fake server. Kokoro voice names and quality are taken from the model card and have been tested only against a local fake server. DeepInfra may reject some voices.
