const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// --- Admin auth config ---
// Set ADMIN_PASSWORD (and ideally SESSION_SECRET) as environment variables on your host.
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.warn(`\n[admin] ADMIN_PASSWORD is not set. Temporary password for this run: ${ADMIN_PASSWORD}\n`);
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 1000 * 60 * 60 * 8; // 8 hours
const COOKIE_NAME = 'admin_session';

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set up Multer for handling art uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
  }
});

// --- Session helpers (signed, httpOnly cookie; no extra dependencies) ---
const sign = (value) => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');

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

// Basic brute-force protection: 5 failed logins per IP per 15 minutes
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

// Initialize SQLite Database
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log('Connected to SQLite database.');
});

// Seed Initial Artworks from Previous Website
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

// Create Tables & Auto-Seed Database
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS artworks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      medium TEXT NOT NULL,
      description TEXT,
      image_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed data if database table is empty
  db.get("SELECT COUNT(*) AS count FROM artworks", (err, row) => {
    if (row && row.count === 0) {
      console.log("Seeding artworks into database...");
      const stmt = db.prepare("INSERT INTO artworks (title, medium, description, image_url) VALUES (?, ?, ?, ?)");
      initialArtworks.forEach((art) => {
        stmt.run(art.title, art.medium, art.description, art.image_url);
      });
      stmt.finalize();
    }
  });
});

// --- API ROUTES ---

// Get all artworks (Public)
app.get('/api/artworks', (req, res) => {
  const { medium } = req.query;
  let sql = 'SELECT * FROM artworks ORDER BY id DESC';
  let params = [];

  // Match medium filters, standardizing 'oils' / 'oil'
  if (medium && medium.toLowerCase() !== 'all') {
    let targetMedium = medium.toLowerCase();
    if (targetMedium === 'oils') targetMedium = 'oil';

    sql = 'SELECT * FROM artworks WHERE LOWER(medium) = LOWER(?) OR LOWER(medium) = LOWER(?) ORDER BY id DESC';
    params = [targetMedium, targetMedium + 's'];
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- Admin auth routes ---
app.get('/api/admin/status', (req, res) => {
  res.json({ admin: isAdmin(req) });
});

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
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

// Upload New Artwork (Admin only)
const ALLOWED_MEDIUMS = ['Acrylic', 'Watercolour', 'Oils'];

app.post('/api/artworks', requireAdmin, (req, res) => {
  upload.single('artImage')(req, res, (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });

    const { title, medium, description } = req.body;
    const discard = () => { if (req.file) fs.unlink(req.file.path, () => {}); };

    if (!req.file) return res.status(400).json({ error: 'Art image is required.' });
    if (!title || !title.trim()) { discard(); return res.status(400).json({ error: 'Title is required.' }); }
    if (!ALLOWED_MEDIUMS.includes(medium)) { discard(); return res.status(400).json({ error: 'Invalid medium.' }); }

    const imageUrl = `/uploads/${req.file.filename}`;
    const sql = 'INSERT INTO artworks (title, medium, description, image_url) VALUES (?, ?, ?, ?)';

    db.run(sql, [title.trim(), medium, (description || '').trim(), imageUrl], function (err) {
      if (err) { discard(); return res.status(500).json({ error: err.message }); }
      res.json({ success: true, id: this.lastID, imageUrl });
    });
  });
});

// Delete Artwork (Admin only)
app.delete('/api/artworks/:id', requireAdmin, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

  db.get('SELECT image_url FROM artworks WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Artwork not found.' });

    db.run('DELETE FROM artworks WHERE id = ?', [id], (delErr) => {
      if (delErr) return res.status(500).json({ error: delErr.message });
      // Only remove files we uploaded ourselves, never the bundled /artwork images
      if (row.image_url.startsWith('/uploads/')) {
        const filePath = path.join(uploadDir, path.basename(row.image_url));
        fs.unlink(filePath, () => {});
      }
      res.json({ success: true });
    });
  });
});

// Submit Inquiry (Public)
app.post('/api/inquiries', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const sql = 'INSERT INTO inquiries (name, email, message) VALUES (?, ?, ?)';
  db.run(sql, [name, email, message], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Unknown API routes -> JSON 404 (not the HTML page)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Serve Frontend (including the hidden /admin login entry)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});