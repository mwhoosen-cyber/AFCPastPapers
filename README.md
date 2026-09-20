# AFC Past Papers — learner site

The public front end of the Physical Sciences question bank: search questions by
grade, topic, year and type, and read the original question and marking memo.

Static HTML, CSS and one dependency-free script. No build step. Published with
GitHub Pages from the default branch root.

## Sign-in required

The collection is not public. Readers sign in with a shared class account, and
the database only answers a request carrying that session. The **publishable**
key in `config.js` is meant to be public and is deliberately not the access
control: on its own it now reads nothing.

That gate is enforced by Postgres row-level security, not by this page, so it
cannot be bypassed by editing the JavaScript or calling the API directly. New
sign-ups are disabled for the project, so the account cannot be self-issued.

Image and PDF links are signed URLs minted only for a signed-in reader, good for
an hour, and the page remembers the ones it has so your browser can reuse a
picture it already has instead of fetching it again under a new address. The
private bucket exposes nothing beyond the files referenced by the current
published collection.

The collection itself is kept in your browser and downloaded again only when a
teacher republishes it, and the grid shows small previews rather than the full
scans. Both are there to keep this site inside the hosting plan it runs on;
opening a question still shows the original image at full resolution.

This repository contains the learner front end only. The admin review worker,
OCR pipeline, paper JSON and credentials live in a separate private workspace
and are not part of this site.

## Reporting an error

Readers can flag a wrong topic, a mismatched memo or a bad crop from the reader.
Because the collection already requires a sign-in, the session is the check and
there is no CAPTCHA. Validation and the hourly caps live in the database, so
they hold even if the endpoint is called directly.

## Reading a paper

Zoom is continuous from 50% to 400% with a slider, the +/- buttons, the keyboard
(`+`, `-`, `0`) or a double-tap; `Fit` shows the whole page. Phones open at 200%,
since a fitted full-width crop is too small to read. Arrow keys and the buttons
at the foot of the reader move through the other questions on the same topic.

The site is dark by default; the switch in the header remembers your choice.
