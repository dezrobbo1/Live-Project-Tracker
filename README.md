# Live Project Tracker — Starter

A minimal, resilient scaffold for your live-tracking app with working **Import**, **Export**, **Delay Log**, and **Clear** buttons, header normalization (BOM/diacritics/punctuation), and a tiny Express API. Clean, boring, and hard to break.

## Features
- CSV **Import** with robust header normalization (no Unicode property escapes).
- **Export** current data as JSON (client triggers download).
- **Delay Log** endpoint.
- **Clear** endpoint.
- Vanilla JS + PapaParse (CDN) on the frontend, Express on the backend.
- File-based JSON persistence locally (Render will be ephemeral unless you attach a persistent store).

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000
```

Try importing `public/sample.csv` first.

## Deploy to Render
- Create a Web Service from this repo.
- Build command: `npm install`
- Start command: `npm start`
- Add a **Root Directory** of `/` and set **Auto-Deploy** if you like.

## Files
- `server.js` — Express API and static hosting of `/public`
- `public/index.html` — UI
- `public/app.js` — wiring, header normalization, API calls
- `public/styles.css` — basic styling
- `public/sample.csv` — demo import file
- `data.json` — created at runtime (local dev)

## API
- `GET /api/health`
- `GET /api/export` → `{tasks, delayLog}`
- `POST /api/tasks` `{ tasks: [...] }` → replace tasks
- `POST /api/delay-log` `{ message }` → append entry
- `POST /api/clear` → clear tasks

## Notes
- Header aliases live in `aliasMap` in `public/app.js`. Add any site-specific header variants there.
- Buttons are wired with a defensive `bind()` and a DOM-ready gate to avoid silent failures.
- If your buttons are inside forms, ensure `type="button"` (already set in `index.html`).
