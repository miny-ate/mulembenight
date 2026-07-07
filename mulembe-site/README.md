# Mulembe Night — site structure

This is now a multi-page static site. Upload the whole `mulembe-site/` folder
to your host as-is (e.g. Firebase Hosting, Netlify, GitHub Pages, or any
static file server) — the folder layout below **is** the URL layout.

```
mulembe-site/
├── index.html          → yoursite.com/                 (home: hero, events, lineup, tiers, FAQ)
├── tickets/index.html  → yoursite.com/tickets/          (payment page — pay + claim a ticket)
├── lookup/index.html   → yoursite.com/lookup/           (lost-ticket lookup)
├── gate/index.html     → yoursite.com/gate/             (staff gate scanner)
├── admin/index.html    → yoursite.com/admin/            (staff/admin sign-in + dashboard)
├── assets/
│   ├── style.css       (shared styles for every page)
│   └── app.js          (shared Firebase config, helpers, auth — edit config here)
└── mulembe-logo.png    (add your own logo file here — referenced by every page)
```

## Before going live

1. Drop your logo image in as `mulembe-site/mulembe-logo.png`.
2. Open `assets/app.js` and fill in `firebaseConfig` and `TICKET_SALT`
   (a long random string). Every page pulls its config from this one file.
3. Set the Firestore security rules — they're written out in full in the
   comment block at the bottom of `assets/app.js`.
4. Create your first admin account from the **Staff / Admin** page, then in
   the Firebase console add a `users/<that account's UID>` document with
   `{ role: "admin" }`.
5. As noted in the code, ticket signing currently happens client-side with
   `TICKET_SALT` visible in page source — fine for a demo, but move issuance
   + signing into a Cloud Function with a server-side secret before a real
   event, so nobody can forge tickets by reading the JS.

## What changed from the single-file version

- Split into five pages (home, tickets/payment, lookup, gate, admin) that
  share one CSS file and one JS config/helpers file, instead of one giant
  HTML file with everything inline.
- The **home page** now links each event card and each ticket tier straight
  to `/tickets/?event=...&tier=...`, which pre-selects that event/tier on
  the payment page.
- The **artist lineup cards** now have a dedicated photo slot (dashed
  placeholder box) above the artist's name, so you can drop in a headshot
  and the artist's name/slot as soon as the lineup is confirmed — just
  replace the placeholder `<div class="artist-photo">` contents with
  `<img src="...">` and swap "Artist name TBA" for the real name in
  `index.html`.
