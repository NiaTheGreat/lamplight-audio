# Listening offline

By default Lamplight needs a connection: each chapter streams from storage. To listen without one, **keep** the chapters you want on your phone first.

## Keeping a chapter

On a book's page, each narrated chapter has a circle-arrow button. Tap it to save that chapter on this device; the icon becomes a ring with a check. Tap again to remove it. Settings shows how many chapters are kept and how much space the app uses, with a **Remove all** button.

Kept chapters play from the device, so they start instantly, seek normally, and keep working with the lock screen and headphone controls. A chapter that isn't kept still streams as before.

Only narrated chapters can be kept. Keeping one downloads its MP3 through the app (the same file as the MP3 download), so it costs nothing in narration; it counts as a few storage reads.

## What works offline

- Kept chapters play.
- Pages you have already opened (the Shelf, a book's page) open from the last copy the phone saw. If the connection is slow (over 4 seconds) and a copy exists, that copy is used.
- Anything that needs the server (Browse search of new fics, the Queue, narrating, Settings that save) does not work offline.

## Re-reading and deleting

Re-reading a chapter (a new voice or pronunciation list) or deleting a book removes the kept copies on the device that made the change, so old audio never plays. Another device that kept the old chapter still has it until you remove it there.

## iPhone notes

- Safari can clear saved data when the phone is low on space. **Add Lamplight to the Home Screen**: installed web apps get a larger allowance and are cleared much less often. The app also asks the browser to keep its storage.
- A chapter is roughly 1 MB per minute of audio, so long fics take real space.
- If a kept copy has been cleared, the player falls back to streaming that chapter.

## How it works (for contributors)

- `public/sw.js` is the service worker. It answers `/offline-audio/<book>/<chapter>` from Cache Storage (`lamplight-offline-audio-v1`) with HTTP Range support, because iOS Safari needs Range to play and seek. If the copy is missing it redirects to `/api/audio/<book>/<chapter>`. Everything else same-origin is network first with the last good response as a fallback (`lamplight-shell-v1`), except streaming audio, the worker, queue, login, usage, speed, uploads and pronounce routes, which are never cached.
- `lib/client/offline.ts` keeps the list of kept chapters in `localStorage` (`lamplight:offline`) so the player can choose the address without an async lookup. `audioSrc(bookId, chapter)` returns the kept address or the streaming one; the player uses it everywhere it sets the audio source.
- The service worker is registered only in production (`components/OfflineRegistrar.tsx`). `middleware.ts` does not password-protect `/sw.js`.
- Keeping fetches `?download=1`, which is same-origin; the plain audio address redirects to R2, which a page can't read without bucket CORS.
- Not tried on a real phone yet: playing a kept chapter with the screen locked and seeking inside it on iOS Safari.
