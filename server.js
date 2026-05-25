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

const sessions = {};
function genToken() { return crypto.randomBytes(32).toString('hex'); }

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions[token]) return res.status(401).json({ error: 'Nav autorizēts' });
  req.user = sessions[token];
  next();
}

function superOnly(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Tikai galvenajam adminam' });
  next();
}

// Check if user is superadmin OR group_admin for given group
function groupAdminOrSuper(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  const groupId = req.params.groupId || req.params.id;
  if (!groupId) return res.status(400).json({ error: 'Nav norādīta grupa' });
  const r = db.exec("SELECT role FROM user_groups WHERE user_id = ? AND group_id = ?", [req.user.id, groupId]);
  if (r.length > 0 && r[0].values[0][0] === 'admin') return next();
  return res.status(403).json({ error: 'Nav tiesību šai grupai' });
}

function rowsToObjects(result) {
  if (!result || result.length === 0) return [];
  const cols = result[0].columns;
  return result[0].values.map(v => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = v[i]);
    return obj;
  });
}

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
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

  db.run(`CREATE TABLE IF NOT EXISTS groups_tbl (
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
    FOREIGN KEY (group_id) REFERENCES groups_tbl(id) ON DELETE CASCADE
  )`);

  // role: 'member' or 'admin'
  db.run(`CREATE TABLE IF NOT EXISTS user_groups (
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    PRIMARY KEY (user_id, group_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups_tbl(id) ON DELETE CASCADE
  )`);

  // status: 'pending', 'approved', 'rejected'
  db.run(`CREATE TABLE IF NOT EXISTS join_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups_tbl(id) ON DELETE CASCADE
  )`);

  // Migrate: if old 'groups' table exists, rename it
  try { db.run("ALTER TABLE groups RENAME TO groups_tbl"); console.log('Migrated: groups -> groups_tbl'); } catch(e) {}

  const adminExists = db.exec("SELECT id FROM users WHERE username='admin'");
  if (adminExists.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run("INSERT INTO users (username, password, role) VALUES ('admin', ?, 'superadmin')", [hash]);
    console.log('Default superadmin created: admin / admin123');
  } else {
    // Migrate: upgrade old 'admin' role to 'superadmin'
    db.run("UPDATE users SET role = 'superadmin' WHERE username = 'admin' AND role = 'admin'");
  }

  // Migrate: add 'role' column to user_groups if missing
  try { db.run("ALTER TABLE user_groups ADD COLUMN role TEXT DEFAULT 'member'"); } catch(e) {}

  saveDB();
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ============ AUTH ============

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = rowsToObjects(db.exec("SELECT * FROM users WHERE username = ?", [username]));
  if (users.length === 0) return res.status(401).json({ error: 'Nepareizs lietotājvārds vai parole' });
  const user = users[0];
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
  delete sessions[req.headers.authorization?.replace('Bearer ', '')];
  res.json({ ok: true });
});

app.post('/api/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4)
    return res.status(400).json({ error: 'Jaunā parole min 4 simboli' });
  const users = rowsToObjects(db.exec("SELECT * FROM users WHERE id = ?", [req.user.id]));
  if (users.length === 0) return res.status(404).json({ error: 'Lietotājs nav atrasts' });
  if (!bcrypt.compareSync(oldPassword, users[0].password))
    return res.status(401).json({ error: 'Nepareiza pašreizējā parole' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.run("UPDATE users SET password = ? WHERE id = ?", [hash, req.user.id]);
  saveDB();
  res.json({ ok: true });
});

// ============ GROUPS ============

app.get('/api/groups', auth, (req, res) => {
  res.json(rowsToObjects(db.exec("SELECT * FROM groups_tbl ORDER BY name")));
});

app.post('/api/groups', auth, superOnly, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Grupas nosaukums obligāts' });
  try {
    db.run("INSERT INTO groups_tbl (name) VALUES (?)", [name.trim()]);
    saveDB();
    const r = rowsToObjects(db.exec("SELECT * FROM groups_tbl WHERE name = ?", [name.trim()]));
    res.json(r[0]);
  } catch (e) {
    res.status(400).json({ error: 'Grupa jau eksistē' });
  }
});

app.delete('/api/groups/:id', auth, superOnly, (req, res) => {
  db.run("DELETE FROM exams WHERE group_id = ?", [req.params.id]);
  db.run("DELETE FROM user_groups WHERE group_id = ?", [req.params.id]);
  db.run("DELETE FROM join_requests WHERE group_id = ?", [req.params.id]);
  db.run("DELETE FROM groups_tbl WHERE id = ?", [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

// ============ EXAMS ============

app.get('/api/groups/:groupId/exams', auth, (req, res) => {
  // User must be member/admin of this group, or superadmin
  if (req.user.role !== 'superadmin') {
    const membership = rowsToObjects(db.exec(
      "SELECT * FROM user_groups WHERE user_id = ? AND group_id = ?", [req.user.id, req.params.groupId]
    ));
    if (membership.length === 0) return res.status(403).json({ error: 'Tu neesi šīs grupas dalībnieks' });
  }
  res.json(rowsToObjects(db.exec("SELECT * FROM exams WHERE group_id = ? ORDER BY exam_date", [req.params.groupId])));
});

app.post('/api/groups/:groupId/exams', auth, groupAdminOrSuper, (req, res) => {
  const { subject, exam_date, note } = req.body;
  if (!subject || !exam_date) return res.status(400).json({ error: 'Priekšmets un datums obligāti' });
  db.run("INSERT INTO exams (group_id, subject, exam_date, note) VALUES (?, ?, ?, ?)",
    [req.params.groupId, subject.trim(), exam_date, (note || '').trim()]);
  saveDB();
  const r = rowsToObjects(db.exec("SELECT * FROM exams WHERE group_id = ? ORDER BY id DESC LIMIT 1", [req.params.groupId]));
  res.json(r[0]);
});

app.delete('/api/exams/:id', auth, (req, res) => {
  const exams = rowsToObjects(db.exec("SELECT * FROM exams WHERE id = ?", [req.params.id]));
  if (exams.length === 0) return res.status(404).json({ error: 'Nav atrasts' });
  const exam = exams[0];
  if (req.user.role !== 'superadmin') {
    const membership = rowsToObjects(db.exec(
      "SELECT * FROM user_groups WHERE user_id = ? AND group_id = ? AND role = 'admin'", [req.user.id, exam.group_id]
    ));
    if (membership.length === 0) return res.status(403).json({ error: 'Nav tiesību' });
  }
  db.run("DELETE FROM exams WHERE id = ?", [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

// ============ MY GROUPS (for regular users) ============

app.get('/api/my-groups', auth, (req, res) => {
  if (req.user.role === 'superadmin') {
    return res.json(rowsToObjects(db.exec("SELECT * FROM groups_tbl ORDER BY name")));
  }
  const groups = rowsToObjects(db.exec(
    "SELECT g.*, ug.role as my_role FROM groups_tbl g JOIN user_groups ug ON g.id = ug.group_id WHERE ug.user_id = ? ORDER BY g.name",
    [req.user.id]
  ));
  res.json(groups);
});

// ============ JOIN REQUESTS ============

app.post('/api/groups/:groupId/join', auth, (req, res) => {
  const gid = req.params.groupId;
  // Already a member?
  const existing = rowsToObjects(db.exec("SELECT * FROM user_groups WHERE user_id = ? AND group_id = ?", [req.user.id, gid]));
  if (existing.length > 0) return res.status(400).json({ error: 'Tu jau esi šīs grupas dalībnieks' });
  // Already requested?
  const pending = rowsToObjects(db.exec(
    "SELECT * FROM join_requests WHERE user_id = ? AND group_id = ? AND status = 'pending'", [req.user.id, gid]
  ));
  if (pending.length > 0) return res.status(400).json({ error: 'Pieprasījums jau nosūtīts' });
  db.run("INSERT INTO join_requests (user_id, group_id, status) VALUES (?, ?, 'pending')", [req.user.id, gid]);
  saveDB();
  res.json({ ok: true });
});

app.get('/api/my-requests', auth, (req, res) => {
  const reqs = rowsToObjects(db.exec(
    "SELECT jr.*, g.name as group_name FROM join_requests jr JOIN groups_tbl g ON jr.group_id = g.id WHERE jr.user_id = ? ORDER BY jr.created_at DESC",
    [req.user.id]
  ));
  res.json(reqs);
});

// Get pending requests (for group admins and superadmin)
app.get('/api/groups/:groupId/requests', auth, groupAdminOrSuper, (req, res) => {
  const reqs = rowsToObjects(db.exec(
    "SELECT jr.*, u.username FROM join_requests jr JOIN users u ON jr.user_id = u.id WHERE jr.group_id = ? AND jr.status = 'pending' ORDER BY jr.created_at",
    [req.params.groupId]
  ));
  res.json(reqs);
});

// All pending requests (superadmin)
app.get('/api/all-requests', auth, (req, res) => {
  if (req.user.role === 'superadmin') {
    const reqs = rowsToObjects(db.exec(
      "SELECT jr.*, u.username, g.name as group_name FROM join_requests jr JOIN users u ON jr.user_id = u.id JOIN groups_tbl g ON jr.group_id = g.id WHERE jr.status = 'pending' ORDER BY jr.created_at"
    ));
    return res.json(reqs);
  }
  // Group admins see their groups' requests
  const reqs = rowsToObjects(db.exec(
    "SELECT jr.*, u.username, g.name as group_name FROM join_requests jr JOIN users u ON jr.user_id = u.id JOIN groups_tbl g ON jr.group_id = g.id JOIN user_groups ug ON ug.group_id = jr.group_id WHERE jr.status = 'pending' AND ug.user_id = ? AND ug.role = 'admin' ORDER BY jr.created_at",
    [req.user.id]
  ));
  res.json(reqs);
});

app.post('/api/requests/:id/approve', auth, (req, res) => {
  const reqs = rowsToObjects(db.exec("SELECT * FROM join_requests WHERE id = ? AND status = 'pending'", [req.params.id]));
  if (reqs.length === 0) return res.status(404).json({ error: 'Pieprasījums nav atrasts' });
  const jr = reqs[0];
  // Check permission
  if (req.user.role !== 'superadmin') {
    const membership = rowsToObjects(db.exec(
      "SELECT * FROM user_groups WHERE user_id = ? AND group_id = ? AND role = 'admin'", [req.user.id, jr.group_id]
    ));
    if (membership.length === 0) return res.status(403).json({ error: 'Nav tiesību' });
  }
  db.run("UPDATE join_requests SET status = 'approved' WHERE id = ?", [req.params.id]);
  try {
    db.run("INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, 'member')", [jr.user_id, jr.group_id]);
  } catch(e) {} // already member
  saveDB();
  res.json({ ok: true });
});

app.post('/api/requests/:id/reject', auth, (req, res) => {
  const reqs = rowsToObjects(db.exec("SELECT * FROM join_requests WHERE id = ? AND status = 'pending'", [req.params.id]));
  if (reqs.length === 0) return res.status(404).json({ error: 'Pieprasījums nav atrasts' });
  const jr = reqs[0];
  if (req.user.role !== 'superadmin') {
    const membership = rowsToObjects(db.exec(
      "SELECT * FROM user_groups WHERE user_id = ? AND group_id = ? AND role = 'admin'", [req.user.id, jr.group_id]
    ));
    if (membership.length === 0) return res.status(403).json({ error: 'Nav tiesību' });
  }
  db.run("UPDATE join_requests SET status = 'rejected' WHERE id = ?", [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

// ============ USER MANAGEMENT (superadmin) ============

app.get('/api/users', auth, (req, res) => {
  if (req.user.role !== 'superadmin') {
    // Group admins can see members of their groups
    const members = rowsToObjects(db.exec(
      "SELECT DISTINCT u.id, u.username, u.role, ug.group_id, ug.role as group_role FROM users u JOIN user_groups ug ON u.id = ug.user_id WHERE ug.group_id IN (SELECT group_id FROM user_groups WHERE user_id = ? AND role = 'admin')",
      [req.user.id]
    ));
    return res.json(members);
  }
  res.json(rowsToObjects(db.exec("SELECT id, username, role, created_at FROM users ORDER BY username")));
});

app.get('/api/groups/:groupId/members', auth, (req, res) => {
  if (req.user.role !== 'superadmin') {
    const membership = rowsToObjects(db.exec(
      "SELECT * FROM user_groups WHERE user_id = ? AND group_id = ?", [req.user.id, req.params.groupId]
    ));
    if (membership.length === 0) return res.status(403).json({ error: 'Nav tiesību' });
  }
  const members = rowsToObjects(db.exec(
    "SELECT u.id, u.username, u.role as global_role, ug.role as group_role FROM users u JOIN user_groups ug ON u.id = ug.user_id WHERE ug.group_id = ? ORDER BY ug.role DESC, u.username",
    [req.params.groupId]
  ));
  res.json(members);
});

// Set group admin (superadmin only)
app.post('/api/groups/:groupId/set-admin/:userId', auth, superOnly, (req, res) => {
  const existing = rowsToObjects(db.exec(
    "SELECT * FROM user_groups WHERE user_id = ? AND group_id = ?", [req.params.userId, req.params.groupId]
  ));
  if (existing.length === 0) {
    db.run("INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, 'admin')", [req.params.userId, req.params.groupId]);
  } else {
    db.run("UPDATE user_groups SET role = 'admin' WHERE user_id = ? AND group_id = ?", [req.params.userId, req.params.groupId]);
  }
  saveDB();
  res.json({ ok: true });
});

app.post('/api/groups/:groupId/remove-admin/:userId', auth, superOnly, (req, res) => {
  db.run("UPDATE user_groups SET role = 'member' WHERE user_id = ? AND group_id = ?", [req.params.userId, req.params.groupId]);
  saveDB();
  res.json({ ok: true });
});

app.delete('/api/groups/:groupId/members/:userId', auth, groupAdminOrSuper, (req, res) => {
  db.run("DELETE FROM user_groups WHERE user_id = ? AND group_id = ?", [req.params.userId, req.params.groupId]);
  saveDB();
  res.json({ ok: true });
});

// Direct add user to group (superadmin)
app.post('/api/groups/:groupId/add-member/:userId', auth, superOnly, (req, res) => {
  try {
    db.run("INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, 'member')", [req.params.userId, req.params.groupId]);
    saveDB();
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: 'Jau ir dalībnieks' });
  }
});

// SPA fallback
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(500).send('index.html not found - check public/ folder');
    }
  } else {
    next();
  }
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Servera kļūda' });
});

initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`DB path: ${DB_PATH}`);
    console.log(`Public dir: ${path.join(__dirname, 'public')}`);
    console.log(`index.html exists: ${fs.existsSync(path.join(__dirname, 'public', 'index.html'))}`);
    console.log('Admin login: admin / admin123');
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
