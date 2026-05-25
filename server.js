const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DB_PATH = path.join(DB_DIR, 'data.db');
let db;

// Simple token store
const sessions = {};

function genToken() { return crypto.randomBytes(32).toString('hex'); }

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions[token]) return res.status(401).json({ error: 'Nav autorizēts' });
  req.user = sessions[token];
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Tikai adminiem' });
  next();
}

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_groups (
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, group_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`);

  // Create default admin
  const adminExists = db.exec("SELECT id FROM users WHERE username='admin'");
  if (adminExists.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run("INSERT INTO users (username, password, role) VALUES ('admin', ?, 'admin')", [hash]);
    console.log('Default admin created: admin / admin123');
  }

  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ============ AUTH ============

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const rows = db.exec("SELECT * FROM users WHERE username = ?", [username]);
  if (rows.length === 0 || rows[0].values.length === 0)
    return res.status(401).json({ error: 'Nepareizs lietotājvārds vai parole' });

  const cols = rows[0].columns;
  const vals = rows[0].values[0];
  const user = {};
  cols.forEach((c, i) => user[c] = vals[i]);

  if (!bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Nepareizs lietotājvārds vai parole' });

  const token = genToken();
  sessions[token] = { id: user.id, username: user.username, role: user.role };
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 4)
    return res.status(400).json({ error: 'Lietotājvārds un parole (min 4 simboli) obligāti' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, 'user')", [username, hash]);
    saveDB();
    res.json({ message: 'Reģistrācija veiksmīga' });
  } catch (e) {
    res.status(400).json({ error: 'Lietotājvārds jau aizņemts' });
  }
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/logout', auth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  delete sessions[token];
  res.json({ ok: true });
});

// ============ GROUPS ============

app.get('/api/groups', auth, (req, res) => {
  const rows = db.exec("SELECT * FROM groups ORDER BY name");
  if (rows.length === 0) return res.json([]);
  const cols = rows[0].columns;
  const groups = rows[0].values.map(v => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = v[i]);
    return obj;
  });
  res.json(groups);
});

app.post('/api/groups', auth, adminOnly, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Grupas nosaukums obligāts' });
  try {
    db.run("INSERT INTO groups (name) VALUES (?)", [name.trim()]);
    saveDB();
    const r = db.exec("SELECT last_insert_rowid() as id");
    res.json({ id: r[0].values[0][0], name: name.trim() });
  } catch (e) {
    res.status(400).json({ error: 'Grupa ar šādu nosaukumu jau eksistē' });
  }
});

app.delete('/api/groups/:id', auth, adminOnly, (req, res) => {
  db.run("DELETE FROM exams WHERE group_id = ?", [req.params.id]);
  db.run("DELETE FROM user_groups WHERE group_id = ?", [req.params.id]);
  db.run("DELETE FROM groups WHERE id = ?", [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

// ============ EXAMS ============

app.get('/api/groups/:groupId/exams', auth, (req, res) => {
  const rows = db.exec("SELECT * FROM exams WHERE group_id = ? ORDER BY exam_date", [req.params.groupId]);
  if (rows.length === 0) return res.json([]);
  const cols = rows[0].columns;
  const exams = rows[0].values.map(v => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = v[i]);
    return obj;
  });
  res.json(exams);
});

app.post('/api/groups/:groupId/exams', auth, adminOnly, (req, res) => {
  const { subject, exam_date, note } = req.body;
  if (!subject || !exam_date) return res.status(400).json({ error: 'Priekšmets un datums obligāti' });
  db.run("INSERT INTO exams (group_id, subject, exam_date, note) VALUES (?, ?, ?, ?)",
    [req.params.groupId, subject.trim(), exam_date, (note || '').trim()]);
  saveDB();
  const r = db.exec("SELECT last_insert_rowid() as id");
  res.json({ id: r[0].values[0][0], group_id: parseInt(req.params.groupId), subject: subject.trim(), exam_date, note: (note || '').trim() });
});

app.delete('/api/exams/:id', auth, adminOnly, (req, res) => {
  db.run("DELETE FROM exams WHERE id = ?", [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

// ============ USER GROUP ASSIGNMENT ============

app.get('/api/users', auth, adminOnly, (req, res) => {
  const rows = db.exec("SELECT id, username, role, created_at FROM users ORDER BY username");
  if (rows.length === 0) return res.json([]);
  const cols = rows[0].columns;
  res.json(rows[0].values.map(v => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = v[i]);
    return obj;
  }));
});

app.get('/api/users/:userId/groups', auth, (req, res) => {
  const rows = db.exec(
    "SELECT g.* FROM groups g JOIN user_groups ug ON g.id = ug.group_id WHERE ug.user_id = ? ORDER BY g.name",
    [req.params.userId]
  );
  if (rows.length === 0) return res.json([]);
  const cols = rows[0].columns;
  res.json(rows[0].values.map(v => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = v[i]);
    return obj;
  }));
});

app.post('/api/users/:userId/groups/:groupId', auth, adminOnly, (req, res) => {
  try {
    db.run("INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)", [req.params.userId, req.params.groupId]);
    saveDB();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Lietotājs jau piešķirts šai grupai' });
  }
});

app.delete('/api/users/:userId/groups/:groupId', auth, adminOnly, (req, res) => {
  db.run("DELETE FROM user_groups WHERE user_id = ? AND group_id = ?", [req.params.userId, req.params.groupId]);
  saveDB();
  res.json({ ok: true });
});

// SPA fallback
app.get('/{0,}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Admin login: admin / admin123');
  });
});
