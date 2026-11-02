# Deploying The Canvas by D on Vercel

Vercel can't keep files, so the artwork data lives in **Turso** (free hosted SQLite)
and uploaded images live in **Vercel Blob**. Both have free tiers.

## 1. Turso (artwork data)
1. Sign up at https://turso.tech and create a database (pick a region near Sri Lanka, e.g. Singapore).
2. Copy the database URL (starts with `libsql://`).
3. Create an auth token for that database and copy it.

## 2. Vercel Blob (uploaded images)
1. In your Vercel project: **Storage → Create → Blob**. Make it a **Public** store.
2. Connect it to this project. Vercel adds `BLOB_READ_WRITE_TOKEN` automatically.

## 3. Environment variables
Vercel project → **Settings → Environment Variables**, add for Production:

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | the password you will log in with at `/admin` |
| `SESSION_SECRET` | a long random string (30+ characters) |
| `TURSO_DATABASE_URL` | the `libsql://...` URL from step 1 |
| `TURSO_AUTH_TOKEN` | the token from step 1 |

## 4. Deploy
Push to GitHub (Vercel redeploys on every push), or click **Redeploy** after adding the variables.
`vercel.json` already tells Vercel how to serve the site, so no framework settings are needed
(if Vercel shows a Framework Preset, leave it on **Other**).

The first visit creates the tables and adds the 15 existing artworks automatically.
Then open `https://your-site/admin` to log in.

## Running on your own computer
```
npm install
ADMIN_PASSWORD=yourpassword npm start      # PowerShell: $env:ADMIN_PASSWORD="yourpassword"; npm start
```
Open http://localhost:3000. Locally the data is saved in `database.sqlite` and images in `public/uploads`
(both ignored by git), so nothing you test locally touches the live site.

## Notes
- Photos over ~4 MB are shrunk in the browser before upload (Vercel's request limit is 4.5 MB).
- Never commit your passwords or tokens. Only set them in Vercel's environment variables.
