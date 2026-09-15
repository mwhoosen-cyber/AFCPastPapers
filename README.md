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

Image and PDF links are short-lived signed URLs minted only for a signed-in
reader. The private bucket exposes nothing beyond the files referenced by the
current published collection.

This repository contains the learner front end only. The admin review worker,
OCR pipeline, paper JSON and credentials live in a separate private workspace
and are not part of this site.

## Reporting a problem is not connected yet

`turnstileSiteKey` is still a placeholder, so the in-page "Report a problem"
form fails closed with a message telling the reader it is unavailable. To turn
it on, create a Cloudflare Turnstile widget for this site's hostname, put the
site key here, set `TURNSTILE_SECRET_KEY` and `ALLOWED_ORIGINS` as Supabase Edge
Function secrets, and deploy the `report-question` function.
