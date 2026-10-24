# Documentation

An EPUB-to-audiobook generator. Upload an EPUB, narrate each chapter once with text-to-speech, cache the audio, then stream it in a mobile-friendly player or download it as an MP3.

## Using the app

- [Getting started](getting-started.md): run it locally and add your first book.
- [Adding books](adding-books.md): uploading EPUBs, what gets skipped, large files.
- [Listening](listening.md): the player, resume, sleep timer, bedside mode, lock-screen controls.
- [Narrators and voices](narrators.md): OpenAI, Kokoro and ElevenLabs voices, changing a book's narrator, per-chapter voices.
- [Pronunciations](pronunciations.md): teach the narrator how to say names and words.
- [Narrating in the background](background-narration.md): whole-book jobs, the Queue, pause and cancel.
- [Re-reading chapters](rereading.md): narrate a chapter again with a different voice or pronunciation list.
- [Cost and limits](cost-and-limits.md): prices, the monthly budget, estimates.
- [Best practices](best-practices.md): recommended setup and habits (R2 storage, Kokoro to save money, spend caps).

## Running your own copy

- [Deployment](deployment.md): Vercel, Cloudflare R2, or Docker on your own machine.
- [Configuration reference](configuration.md): every environment variable.
- [Troubleshooting](troubleshooting.md): common problems.

The project is released under the [MIT License](../LICENSE).

## For contributors

- [Architecture](architecture.md): how the pieces fit together.
- [EPUB parsing](epub-parsing.md): how chapters and notes are detected.
- [Storage](storage.md): what is stored where, and keeping operation counts low.
- [Contributing](../CONTRIBUTING.md): checks, conventions, adding a narration provider.
