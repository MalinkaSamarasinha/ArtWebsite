const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IS_VERCEL = !!process.env.VERCEL;

const app = express();
app.set('trust proxy', 1);

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */
// Admin login. On Vercel these MUST be set as environment variables
// (sessions are stateless, so SESSION_SECRET has to be the same on every request).
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let SESSION_SECRET = process.env.SESSION_SECRET;
let ADMIN_CONFIGURED = true;

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  if (IS_VERCEL) {
    ADMIN_CONFIGURED = false;
    console.error('[admin] ADMIN_PASSWORD and SESSION_SECRET must be set in Vercel environment variables. Admin login is disabled.');
  } else {
    if (!ADMIN_PASSWORD) {
      ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
      console.warn(`\n[admin] ADMIN_PASSWORD is not set. Temporary password for this run: ${ADMIN_PASSWORD}\n`);
    }
    if (!SESSION_SECRET) SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  }
}

const SESSION_MS = 1000 * 60 * 60 * 8; // 8 hours
const COOKIE_NAME = 'admin_session';

// Database: Turso in production (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN),
// a local SQLite file when running on your own computer.
const db = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: 'file:' + path.join(ROOT, 'database.sqlite') }
);

// Images: Vercel Blob in production (BLOB_READ_WRITE_TOKEN), local /public/uploads otherwise.
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const uploadDir = path.join(PUBLIC_DIR, 'uploads');
if (!USE_BLOB && !IS_VERCEL) fs.mkdirSync(uploadDir, { recursive: true });

/* ------------------------------------------------------------------ *
 * Middleware
 * ------------------------------------------------------------------ */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Vercel rejects request bodies over ~4.5 MB, so keep uploads under that.
const MAX_UPLOAD = 4 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
  }
});
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

/* ------------------------------------------------------------------ *
 * Image storage
 * ------------------------------------------------------------------ */
async function saveImage(file) {
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${EXT[file.mimetype]}`;
  if (USE_BLOB) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`artworks/${name}`, file.buffer, { access: 'public', contentType: file.mimetype });
    return blob.url;
  }
  if (IS_VERCEL) throw new Error('Image storage is not configured (missing BLOB_READ_WRITE_TOKEN).');
  await fs.promises.writeFile(path.join(uploadDir, name), file.buffer);
  return `/uploads/${name}`;
}

async function removeImage(url) {
  try {
    if (/^https:\/\/[^/]*blob\.vercel-storage\.com\//.test(url)) {
      const { del } = await import('@vercel/blob');
      await del(url);
    } else if (url.startsWith('/uploads/')) {
      await fs.promises.unlink(path.join(uploadDir, path.basename(url)));
    }
    // bundled /artwork/* images are never deleted
  } catch (e) {
    console.error('Could not remove image:', url, e.message);
  }
}

/* ------------------------------------------------------------------ *
 * Database setup
 * ------------------------------------------------------------------ */
const initialArtworks = [
  { title: "Cactus at Dawn", medium: "Acrylic", description: "Size: 10 × 12 inches", image_url: "/artwork/cactus.jpg" },
  { title: "The dance of the dragonflies", medium: "Acrylic", description: "Size: 35 × 23 inches", image_url: "/artwork/Firefly.jpeg" },
  { title: "Paddy Fields", medium: "Acrylic", description: "Size: 24 × 36 inches", image_url: "/artwork/paddy.jpg" },
  { title: "Serenity", medium: "Acrylic", description: "Size: 24 × 24 inches", image_url: "/artwork/serenity.jpg" },
  { title: "life among corals", medium: "Acrylic", description: "Size: 24 × 24 inches", image_url: "/artwork/life_among_corals.jpg" },
  { title: "Monarakudumbiya and Nidikumba", medium: "Acrylic", description: "Size: 12 × 14 inches", image_url: "/artwork/monarakudumbiya_and_nidikumba.jpg" },
  { title: "Moss", medium: "Acrylic", description: "Size: 32 × 24 inches", image_url: "/artwork/moss.jpg" },
  { title: "Blazing sunset", medium: "Acrylic", description: "Size: 32 × 24 inches", image_url: "/artwork/the_blazing_sun.jpg" },
  { title: "Garland maker", medium: "Acrylic", description: "Size: 15 × 19 inches", image_url: "/artwork/the_garland_maker.jpg" },
  { title: "The ocean wave", medium: "Acrylic", description: "Size: 20 × 28 inches", image_url: "/artwork/the_ocean_wave.jpeg" },
  { title: "Kandyan drummer", medium: "Oil", description: "Size: 19 × 25 inches", image_url: "/artwork/Kandyan_dancer.jpg" },
  { title: "Stilt fishermen", medium: "Watercolour", description: "Size: 17 × 11 inches", image_url: "/artwork/stilt_fishermen.jpg" },
  { title: "The wild Sambar herds in the Horton Plains", medium: "Watercolour", description: "Size: 17 × 11 inches", image_url: "/artwork/the_wild_sambar_herds_in_the_horton_plains.jpg" },
  { title: "Breath of the hearth", medium: "Watercolour", description: "Size: 16 × 11 inches", image_url: "/artwork/hearth.jpeg" },
  { title: "The wild Sambar in the Horton Plains", medium: "Watercolour", description: "Size: 17 × 11 inches", image_url: "/artwork/the_wild_sambar_in_the_horton_plains.jpg" }
];

// Turn a libSQL result into plain objects ({ id, title, ... })
function rowsOf(result) {
  return result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]])));
}

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS artworks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      medium TEXT NOT NULL,
      description TEXT,
      image_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Migration: surface (Canvas/Paper) and framed (Framed/Unframed)
  const cols = rowsOf(await db.execute('PRAGMA table_info(artworks)')).map((c) => c.name);
  if (!cols.includes('surface')) await db.execute('ALTER TABLE artworks ADD COLUMN surface TEXT');
  if (!cols.includes('framed')) await db.execute('ALTER TABLE artworks ADD COLUMN framed TEXT');

  // Guards against double-seeding if two cold starts race each other
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_image_url ON artworks(image_url)');

  const count = rowsOf(await db.execute('SELECT COUNT(*) AS count FROM artworks'))[0].count;
  if (Number(count) === 0) {
    console.log('Seeding artworks into database...');
    await db.batch(
      initialArtworks.map((a) => ({
        sql: 'INSERT OR IGNORE INTO artworks (title, medium, description, image_url) VALUES (?, ?, ?, ?)',
        args: [a.title, a.medium, a.description, a.image_url]
      })),
      'write'
    );
  }
}

// Runs once per server instance; every /api request waits for it
let ready = null;
const ensureReady = () => {
  if (!ready) ready = initDb().catch((e) => { ready = null; throw e; });
  return ready;
};

app.use('/api', async (req, res, next) => {
  try { await ensureReady(); next(); }
  catch (e) { console.error('Database init failed:', e); res.status(500).json({ error: 'Database is not available.' }); }
});

/* ------------------------------------------------------------------ *
 * Admin session helpers (signed httpOnly cookie, no extra dependencies)
 * ------------------------------------------------------------------ */
const sign = (value) => crypto.createHmac('sha256', SESSION_SECRET || '').update(value).digest('hex');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isAdmin(req) {
  if (!ADMIN_CONFIGURED) return false;
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig || Number(expiry) < Date.now()) return false;
  return safeEqual(sig, sign(expiry));
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Admin login required.' });
}

// Basic brute-force protection: 5 failed logins per IP per 15 minutes (per server instance)
const failedLogins = new Map();
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
function tooManyAttempts(ip) {
  const rec = failedLogins.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) return false;
  return rec.count >= MAX_FAILS;
}
function recordFail(ip) {
  const rec = failedLogins.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) failedLogins.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

/* ------------------------------------------------------------------ *
 * Validation helpers
 * ------------------------------------------------------------------ */
const ALLOWED_MEDIUMS = ['Acrylic', 'Watercolour', 'Oils'];
const ALLOWED_SURFACES = ['Canvas', 'Paper'];
const ALLOWED_FRAMING = ['Framed', 'Unframed'];

// Optional enum: '' / missing -> null, valid -> value, anything else -> undefined (invalid)
function optionalEnum(value, allowed) {
  if (value === undefined || value === null || value === '') return null;
  return allowed.includes(value) ? value : undefined;
}

const fail = (res, e) => { console.error(e); res.status(500).json({ error: 'Something went wrong. Please try again.' }); };

/* ------------------------------------------------------------------ *
 * API routes
 * ------------------------------------------------------------------ */
app.get('/api/admin/status', (req, res) => {
  res.json({ admin: isAdmin(req) });
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_CONFIGURED) return res.status(503).json({ error: 'Admin login is not configured on the server.' });
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });

  const { password } = req.body || {};
  if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
    recordFail(ip);
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  failedLogins.delete(ip);
  const expiry = String(Date.now() + SESSION_MS);
  const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_MS / 1000}`];
  if (req.secure) flags.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${expiry}.${sign(expiry)}; ${flags.join('; ')}`);
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ success: true });
});

// Get all artworks (public)
app.get('/api/artworks', async (req, res) => {
  try {
    const { medium } = req.query;
    let result;
    if (medium && String(medium).toLowerCase() !== 'all') {
      let target = String(medium).toLowerCase();
      if (target === 'oils') target = 'oil';
      result = await db.execute({
        sql: 'SELECT * FROM artworks WHERE LOWER(medium) = ? OR LOWER(medium) = ? ORDER BY id DESC',
        args: [target, target + 's']
      });
    } else {
      result = await db.execute('SELECT * FROM artworks ORDER BY id DESC');
    }
    res.json(rowsOf(result));
  } catch (e) { fail(res, e); }
});

// Upload new artwork (admin)
app.post('/api/artworks', requireAdmin, (req, res) => {
  upload.single('artImage')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 4 MB).' : uploadErr.message;
      return res.status(400).json({ error: msg });
    }
    try {
      const { title, medium, description } = req.body;
      const surface = optionalEnum(req.body.surface, ALLOWED_SURFACES);
      const framed = optionalEnum(req.body.framed, ALLOWED_FRAMING);

      if (!req.file) return res.status(400).json({ error: 'Art image is required.' });
      if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
      if (!ALLOWED_MEDIUMS.includes(medium)) return res.status(400).json({ error: 'Invalid medium.' });
      if (surface === undefined) return res.status(400).json({ error: 'Invalid surface.' });
      if (framed === undefined) return res.status(400).json({ error: 'Invalid framing option.' });

      const imageUrl = await saveImage(req.file);
      try {
        const r = await db.execute({
          sql: 'INSERT INTO artworks (title, medium, description, image_url, surface, framed) VALUES (?, ?, ?, ?, ?, ?)',
          args: [title.trim(), medium, (description || '').trim(), imageUrl, surface, framed]
        });
        res.json({ success: true, id: Number(r.lastInsertRowid), imageUrl });
      } catch (dbErr) {
        await removeImage(imageUrl); // don't leave an orphaned file behind
        throw dbErr;
      }
    } catch (e) { fail(res, e); }
  });
});

// Edit artwork details (admin)
app.put('/api/artworks/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

    const { title, medium, description } = req.body || {};
    const surface = optionalEnum(req.body && req.body.surface, ALLOWED_SURFACES);
    const framed = optionalEnum(req.body && req.body.framed, ALLOWED_FRAMING);

    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
    if (!ALLOWED_MEDIUMS.includes(medium)) return res.status(400).json({ error: 'Invalid medium.' });
    if (surface === undefined) return res.status(400).json({ error: 'Invalid surface.' });
    if (framed === undefined) return res.status(400).json({ error: 'Invalid framing option.' });

    const r = await db.execute({
      sql: 'UPDATE artworks SET title = ?, medium = ?, description = ?, surface = ?, framed = ? WHERE id = ?',
      args: [title.trim(), medium, String(description || '').trim(), surface, framed, id]
    });
    if (r.rowsAffected === 0) return res.status(404).json({ error: 'Artwork not found.' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// Delete artwork (admin)
app.delete('/api/artworks/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

    const row = rowsOf(await db.execute({ sql: 'SELECT image_url FROM artworks WHERE id = ?', args: [id] }))[0];
    if (!row) return res.status(404).json({ error: 'Artwork not found.' });

    await db.execute({ sql: 'DELETE FROM artworks WHERE id = ?', args: [id] });
    await removeImage(row.image_url);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// Submit inquiry (public)
app.post('/api/inquiries', async (req, res) => {
  try {
    const { name, email, message } = req.body || {};
    if (!name || !email || !message) return res.status(400).json({ error: 'All fields are required.' });
    await db.execute({ sql: 'INSERT INTO inquiries (name, email, message) VALUES (?, ?, ?)', args: [name, email, message] });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// Unknown API routes -> JSON 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Any other page (including the hidden /admin entry) -> the single-page site
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

module.exports = app;
