/**
 * Aplikasi Ujian Online - Server
 * Node.js 24 LTS, Express 4, better-sqlite3 (WAL), bcryptjs, jsonwebtoken,
 * multer, sanitize-html, katex.
 */

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(__dirname, 'backups');
const DB_PATH = path.join(DATA_DIR, 'ujian.db');
const SECRET_PATH = path.join(DATA_DIR, 'secret.txt');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

for (const dir of [DATA_DIR, BACKUP_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let JWT_SECRET;
if (fs.existsSync(SECRET_PATH)) {
  JWT_SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  if (!JWT_SECRET) {
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_PATH, JWT_SECRET, { mode: 0o600 });
  }
} else {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_PATH, JWT_SECRET, { mode: 0o600 });
  console.log('[INFO] Rahasia JWT dibuat di ' + SECRET_PATH);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nis TEXT UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  kelas TEXT,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judul TEXT NOT NULL,
  mapel TEXT,
  durasi_menit INTEGER NOT NULL,
  mulai TEXT NOT NULL,
  selesai TEXT NOT NULL,
  aktif INTEGER DEFAULT 1,
  acak INTEGER DEFAULT 1,
  batas_pelanggaran INTEGER DEFAULT 5,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  pertanyaan TEXT NOT NULL,
  opsi_a TEXT NOT NULL,
  opsi_b TEXT NOT NULL,
  opsi_c TEXT NOT NULL,
  opsi_d TEXT NOT NULL,
  kunci TEXT NOT NULL,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','submitted','timeout','terminated')),
  cheat_count INTEGER DEFAULT 0,
  warn_count INTEGER DEFAULT 0,
  last_seen TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(exam_id, student_id),
  FOREIGN KEY (exam_id) REFERENCES exams(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  jawaban TEXT,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(session_id, question_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS cheat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  jenis TEXT NOT NULL,
  berat INTEGER DEFAULT 0,
  detail TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL UNIQUE,
  nilai_awal REAL NOT NULL,
  pengurangan REAL NOT NULL,
  nilai_akhir REAL NOT NULL,
  benar INTEGER NOT NULL,
  total_soal INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS session_marks (
  session_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  PRIMARY KEY (session_id, question_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_exam ON sessions(exam_id);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_cheat_logs_session ON cheat_logs(session_id);
`);

(function migrateQuestions() {
  const cols = db.prepare('PRAGMA table_info(questions)').all().map(c => c.name);
  if (!cols.includes('tipe')) db.exec("ALTER TABLE questions ADD COLUMN tipe TEXT DEFAULT 'pg4'");
  if (!cols.includes('stimulus')) db.exec("ALTER TABLE questions ADD COLUMN stimulus TEXT DEFAULT ''");
  if (!cols.includes('opsi_ekstra')) db.exec("ALTER TABLE questions ADD COLUMN opsi_ekstra TEXT DEFAULT ''");
})();

(function migrateQuestionsKunci() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='questions'").get();
  if (!row || !row.sql || !row.sql.includes('CHECK(kunci IN')) return;
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE questions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_id INTEGER NOT NULL,
        pertanyaan TEXT NOT NULL,
        opsi_a TEXT NOT NULL,
        opsi_b TEXT NOT NULL,
        opsi_c TEXT NOT NULL,
        opsi_d TEXT NOT NULL,
        kunci TEXT NOT NULL,
        tipe TEXT DEFAULT 'pg4',
        stimulus TEXT DEFAULT '',
        opsi_ekstra TEXT DEFAULT '',
        FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
      );
      INSERT INTO questions_new (id, exam_id, pertanyaan, opsi_a, opsi_b, opsi_c, opsi_d, kunci, tipe, stimulus, opsi_ekstra)
        SELECT id, exam_id, pertanyaan, opsi_a, opsi_b, opsi_c, opsi_d, kunci,
               COALESCE(tipe, 'pg4'), COALESCE(stimulus, ''), COALESCE(opsi_ekstra, '')
        FROM questions;
      DROP TABLE questions;
      ALTER TABLE questions_new RENAME TO questions;
      CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
    `);
    console.log('[MIGRASI] Tabel questions diperbarui (CHECK kunci dihapus).');
  } finally {
    db.pragma('foreign_keys = ON');
  }
})();

(function migrateAnswers() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='answers'").get();
  if (!row || !row.sql || !row.sql.includes('CHECK(jawaban IN')) return;
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE answers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        jawaban TEXT,
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(session_id, question_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (question_id) REFERENCES questions(id)
      );
      INSERT OR IGNORE INTO answers_new (id, session_id, question_id, jawaban, updated_at)
        SELECT id, session_id, question_id, jawaban, updated_at FROM answers;
      DROP TABLE answers;
      ALTER TABLE answers_new RENAME TO answers;
    `);
    console.log('[MIGRASI] Tabel answers diperbarui (CHECK dihapus).');
  } finally {
    db.pragma('foreign_keys = ON');
  }
})();

(function migrateDemoStudents() {
  const cols = db.prepare('PRAGMA table_info(students)').all().map(c => c.name);
  if (!cols.includes('is_demo')) {
    db.exec("ALTER TABLE students ADD COLUMN is_demo INTEGER DEFAULT 0");
    console.log('[MIGRASI] Kolom is_demo ditambahkan ke students.');
  }
})();

(function seedDemoStudent() {
  const nis = 'DEMO';
  const existing = db.prepare('SELECT id FROM students WHERE nis = ?').get(nis);
  if (existing) {
    db.prepare('UPDATE students SET is_demo = 1 WHERE id = ?').run(existing.id);
    return;
  }
  const hash = bcrypt.hashSync('demo', 10);
  db.prepare('INSERT INTO students (nis, nama, kelas, password_hash, is_demo) VALUES (?, ?, ?, ?, 1)')
    .run(nis, 'Akun Demo', 'DEMO', hash);
  console.log('[INFO] Akun demo dibuat: NIS=DEMO  Sandi=demo');
})();

(function seedTeacher() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM teachers').get().c;
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL || 'guru@sekolah.id';
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    generated = true;
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO teachers (email, password_hash) VALUES (?, ?)').run(email, hash);
  console.log('============================================================');
  console.log(' Akun guru pertama dibuat:');
  console.log('   Email : ' + email);
  if (generated) {
    console.log('   Sandi : ' + password);
    console.log(' CATAT SANDI INI. Hanya dicetak sekali di terminal.');
  } else {
    console.log('   Sandi : (diambil dari variabel lingkungan ADMIN_PASSWORD)');
  }
  console.log('============================================================');
})();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '16mb' }));
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  }
}));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/katex', express.static(path.join(__dirname, 'node_modules', 'katex', 'dist')));

const userReqMap = new Map();
const loginFailMap = new Map();

app.use('/api', (req, res, next) => {
  const auth = req.headers.authorization || '';
  const key = auth ? 'jwt:' + auth.slice(0, 96) : 'ip:' + (req.ip || '');
  const now = Date.now();
  let entry = userReqMap.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 1000 };
    userReqMap.set(key, entry);
  }
  entry.count++;
  if (entry.count > 30) return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
  next();
});

function checkLoginLimit(ip) {
  const now = Date.now();
  let entry = loginFailMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 15 * 60 * 1000 };
    loginFailMap.set(ip, entry);
  }
  return entry;
}
function recordLoginFail(ip) { checkLoginLimit(ip).count++; }
function clearLoginFail(ip) { loginFailMap.delete(ip); }

function tokenFrom(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function authStudent(req, res, next) {
  const token = tokenFrom(req);
  if (!token) return res.status(401).json({ error: 'Token wajib.' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role !== 'student') return res.status(403).json({ error: 'Akses ditolak.' });
    req.user = p;
    next();
  } catch {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa.' });
  }
}
function authTeacher(req, res, next) {
  const token = tokenFrom(req);
  if (!token) return res.status(401).json({ error: 'Token wajib.' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role !== 'teacher') return res.status(403).json({ error: 'Akses ditolak.' });
    req.user = p;
    next();
  } catch {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa.' });
  }
}

function nowISO() { return new Date().toISOString(); }

function logAccess(actor, action, target) {
  try {
    db.prepare('INSERT INTO access_log (actor_type, actor_id, action, target) VALUES (?, ?, ?, ?)')
      .run(actor ? actor.role : 'system', actor ? actor.id : null, action, target || '');
  } catch (_) {}
}

const sanitizeOptions = {
  allowedTags: ['b','i','u','s','strong','em','br','p','div','span','ul','ol','li',
                'sub','sup','img','a','code','pre','blockquote','h1','h2','h3','h4','h5','h6',
                'table','thead','tbody','tr','th','td','hr'],
  allowedAttributes: {
    'a': ['href','target','rel'],
    'img': ['src','alt','width','height'],
    'span': ['class'], 'div': ['class'],
    'td': ['colspan','rowspan'], 'th': ['colspan','rowspan']
  },
  allowedSchemes: ['http','https','data'],
  allowedSchemesAppliedToAttributes: ['href','src'],
  transformTags: {
    'a': sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
  }
};
function cleanHtml(s) { return sanitizeHtml(String(s == null ? '' : s), sanitizeOptions).trim(); }

function normalizeIsian(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?'"]+$/g, '').trim();
}
function scoreAnswer(q, ans) {
  if (ans == null || ans === '') return 0;
  const tipe = q.tipe || 'pg4';
  const kunci = String(q.kunci || '').trim();
  const a = String(ans).trim();
  if (tipe === 'isian') {
    const accepts = kunci.split('|').map(normalizeIsian);
    return accepts.includes(normalizeIsian(a)) ? 1 : 0;
  }
  if (tipe === 'pgk') {
    const correct = new Set(kunci.toUpperCase().replace(/[^A-E]/g, '').split('').filter(Boolean));
    if (correct.size === 0) return 0;
    const chosen = new Set(a.toUpperCase().replace(/[^A-E]/g, '').split('').filter(Boolean));
    let benar = 0, salah = 0;
    chosen.forEach(c => { if (correct.has(c)) benar++; else salah++; });
    return Math.max(0, Math.min(1, (benar - salah) / correct.size));
  }
  return a.toUpperCase() === kunci.toUpperCase() ? 1 : 0;
}

function getOrder(sessionId, examId) {
  const exam = db.prepare('SELECT acak FROM exams WHERE id = ?').get(examId);
  const qs = db.prepare('SELECT id FROM questions WHERE exam_id = ? ORDER BY id').all(examId);
  if (!exam || !exam.acak) return qs.map(q => q.id);
  const arr = qs.map(q => ({ id: q.id, key: crypto.createHash('sha256').update(sessionId + ':' + q.id).digest() }));
  arr.sort((a, b) => Buffer.compare(a.key, b.key));
  return arr.map(x => x.id);
}

function finalizeSession(sessionId, status) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session || session.status !== 'active') return;
  const questions = db.prepare('SELECT id, kunci, tipe FROM questions WHERE exam_id = ?').all(session.exam_id);
  const total = questions.length;
  const answers = db.prepare('SELECT question_id, jawaban FROM answers WHERE session_id = ?').all(sessionId);
  const ansMap = new Map(answers.map(a => [a.question_id, a.jawaban]));
  let skor = 0, benar = 0;
  for (const q of questions) {
    const s = scoreAnswer(q, ansMap.get(q.id));
    skor += s;
    if (s >= 0.999) benar++;
  }
  const nilaiAwal = total > 0 ? (skor / total) * 100 : 0;
  const pengurangan = status === 'terminated' ? 100 : Math.min(100, 10 * session.cheat_count);
  const nilaiAkhir = status === 'terminated' ? 0 : nilaiAwal * (1 - pengurangan / 100);
  db.prepare(`
    INSERT INTO results (session_id, nilai_awal, pengurangan, nilai_akhir, benar, total_soal)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      nilai_awal = excluded.nilai_awal, pengurangan = excluded.pengurangan,
      nilai_akhir = excluded.nilai_akhir, benar = excluded.benar, total_soal = excluded.total_soal
  `).run(sessionId, nilaiAwal, pengurangan, nilaiAkhir, benar, total);
  db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, sessionId);
}

// ============================================================
// API MURID
// ============================================================
app.post('/api/login', (req, res) => {
  const ip = req.ip || '';
  const failEntry = checkLoginLimit(ip);
  if (failEntry.count >= 20) return res.status(429).json({ error: 'Terlalu banyak percobaan masuk gagal.' });
  const { nis, password, device_id } = req.body || {};
  if (!nis || !password) return res.status(400).json({ error: 'NIS dan sandi wajib diisi.' });
  const student = db.prepare('SELECT * FROM students WHERE nis = ?').get(String(nis).trim());
  if (!student || !bcrypt.compareSync(String(password), student.password_hash)) {
    recordLoginFail(ip);
    return res.status(401).json({ error: 'NIS atau sandi salah.' });
  }
  clearLoginFail(ip);
  const token = jwt.sign({ role: 'student', id: student.id, nis: student.nis }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, student: { id: student.id, nis: student.nis, nama: student.nama, kelas: student.kelas }, device_id_client: device_id || null });
});

app.get('/api/exams', authStudent, (req, res) => {
  const now = nowISO();
  const rows = db.prepare(`SELECT id, judul, mapel, durasi_menit, mulai, selesai, acak, batas_pelanggaran FROM exams WHERE aktif = 1 AND mulai <= ? AND selesai >= ? ORDER BY mulai ASC`).all(now, now);
  const stu = db.prepare('SELECT is_demo FROM students WHERE id = ?').get(req.user.id);
  if (stu && stu.is_demo === 1) {
    return res.json(rows.map(r => Object.assign({}, r, { session_id: null, session_status: null })));
  }
  const ses = db.prepare('SELECT exam_id, id, status FROM sessions WHERE student_id = ?').all(req.user.id);
  const map = new Map(ses.map(s => [s.exam_id, s]));
  res.json(rows.map(r => {
    const s = map.get(r.id);
    return Object.assign({}, r, { session_id: s ? s.id : null, session_status: s ? s.status : null });
  }));
});

app.post('/api/exams/:id/start', authStudent, (req, res) => {
  const examId = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
  if (!exam || !exam.aktif) return res.status(404).json({ error: 'Ujian tidak ditemukan atau tidak aktif.' });
  const now = Date.now();
  if (now < new Date(exam.mulai).getTime()) return res.status(403).json({ error: 'Ujian belum dimulai.' });
  if (now > new Date(exam.selesai).getTime()) return res.status(403).json({ error: 'Ujian sudah berakhir.' });

  const { device_id } = req.body || {};
  if (!device_id) return res.status(400).json({ error: 'device_id wajib.' });

  const stuDemo = db.prepare('SELECT is_demo FROM students WHERE id = ?').get(req.user.id);
  if (stuDemo && stuDemo.is_demo === 1) {
    const oldSessions = db.prepare('SELECT id FROM sessions WHERE exam_id = ? AND student_id = ?').all(examId, req.user.id);
    const txDemo = db.transaction(() => {
      for (const s of oldSessions) {
        db.prepare('DELETE FROM cheat_logs WHERE session_id = ?').run(s.id);
        db.prepare('DELETE FROM answers WHERE session_id = ?').run(s.id);
        db.prepare('DELETE FROM session_marks WHERE session_id = ?').run(s.id);
        db.prepare('DELETE FROM results WHERE session_id = ?').run(s.id);
        db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
      }
    });
    txDemo();
  }

  const existing = db.prepare('SELECT * FROM sessions WHERE exam_id = ? AND student_id = ?').get(examId, req.user.id);
  if (existing) {
    if (existing.device_id !== device_id) return res.status(409).json({ error: 'Anda sudah memulai ujian dari perangkat lain.' });
    if (existing.status !== 'active') return res.status(409).json({ error: 'Sesi sudah tidak aktif: ' + existing.status });
    return res.json({ session_id: existing.id, resumed: true });
  }
  const info = db.prepare('INSERT INTO sessions (exam_id, student_id, device_id, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(examId, req.user.id, String(device_id).slice(0, 128), req.ip || '', (req.get('user-agent') || '').slice(0, 300));
  logAccess(req.user, 'start_exam', 'exam=' + examId + ' session=' + info.lastInsertRowid);
  res.json({ session_id: info.lastInsertRowid, resumed: false });
});

app.get('/api/sessions/:id/status', authStudent, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session || session.student_id !== req.user.id) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(session.exam_id);
  const total = db.prepare('SELECT COUNT(*) c FROM questions WHERE exam_id = ?').get(session.exam_id).c;
  const answered = db.prepare('SELECT COUNT(*) c FROM answers WHERE session_id = ?').get(session.id).c;
  const started = new Date(session.started_at).getTime();
  const examEnd = new Date(exam.selesai).getTime();
  const sessionEnd = Math.min(started + exam.durasi_menit * 60 * 1000, examEnd);
  const remaining = Math.max(0, Math.floor((sessionEnd - Date.now()) / 1000));
  db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(nowISO(), session.id);
  if (remaining === 0 && session.status === 'active') {
    finalizeSession(session.id, 'timeout');
    session.status = 'timeout';
  }
  res.json({
    status: session.status, sisa_detik: remaining, terjawab: answered, total,
    cheat_count: session.cheat_count, warn_count: session.warn_count,
    batas_pelanggaran: exam.batas_pelanggaran
  });
});

app.get('/api/sessions/:id/q/:n', authStudent, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session || session.student_id !== req.user.id) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  if (session.status !== 'active') return res.status(409).json({ error: 'Sesi tidak aktif.' });
  const order = getOrder(session.id, session.exam_id);
  const n = parseInt(req.params.n, 10);
  if (!Number.isFinite(n) || n < 1 || n > order.length) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
  const qid = order[n - 1];
  const q = db.prepare('SELECT id, pertanyaan, stimulus, tipe, opsi_a, opsi_b, opsi_c, opsi_d, opsi_ekstra FROM questions WHERE id = ?').get(qid);
  const saved = db.prepare('SELECT jawaban FROM answers WHERE session_id = ? AND question_id = ?').get(session.id, qid);
  res.json({ nomor: n, total: order.length, soal: q, jawaban_tersimpan: saved ? saved.jawaban : null });
});

app.post('/api/sessions/:id/answer', authStudent, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session || session.student_id !== req.user.id) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  if (session.status !== 'active') return res.status(409).json({ error: 'Sesi tidak aktif.' });
  const { question_id, jawaban } = req.body || {};
  const q = db.prepare('SELECT id, tipe FROM questions WHERE id = ? AND exam_id = ?').get(question_id, session.exam_id);
  if (!q) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
  const tipe = q.tipe || 'pg4';
  let opsi;
  if (tipe === 'isian') {
    opsi = String(jawaban == null ? '' : jawaban).slice(0, 500);
  } else if (tipe === 'pgk') {
    const set = new Set(String(jawaban || '').toUpperCase().replace(/[^A-E]/g, '').split('').filter(Boolean));
    opsi = Array.from(set).sort().join('');
  } else {
    opsi = String(jawaban || '').toUpperCase();
    if (opsi.length !== 1 || !['A','B','C','D','E','S'].includes(opsi)) {
      return res.status(400).json({ error: 'Jawaban tidak valid.' });
    }
  }
  db.prepare(`
    INSERT INTO answers (session_id, question_id, jawaban, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, question_id) DO UPDATE SET jawaban = excluded.jawaban, updated_at = excluded.updated_at
  `).run(session.id, question_id, opsi, nowISO());
  res.json({ ok: true });
});

app.post('/api/sessions/:id/cheat', authStudent, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session || session.student_id !== req.user.id) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  if (session.status !== 'active') return res.status(409).json({ error: 'Sesi tidak aktif.' });
  const { jenis, berat, detail } = req.body || {};
  const isBerat = (berat === 1 || berat === true) ? 1 : 0;
  db.prepare('INSERT INTO cheat_logs (session_id, jenis, berat, detail) VALUES (?, ?, ?, ?)')
    .run(session.id, String(jenis || 'unknown').slice(0, 60), isBerat, String(detail || '').slice(0, 200));
  if (isBerat) db.prepare('UPDATE sessions SET cheat_count = cheat_count + 1 WHERE id = ?').run(session.id);
  else db.prepare('UPDATE sessions SET warn_count = warn_count + 1 WHERE id = ?').run(session.id);
  const upd = db.prepare('SELECT cheat_count FROM sessions WHERE id = ?').get(session.id);
  const exam = db.prepare('SELECT batas_pelanggaran FROM exams WHERE id = ?').get(session.exam_id);
  let terminated = false;
  if (isBerat && upd.cheat_count >= exam.batas_pelanggaran) {
    finalizeSession(session.id, 'terminated');
    terminated = true;
  }
  res.json({ ok: true, cheat_count: upd.cheat_count, terminated });
});

app.post('/api/sessions/:id/submit', authStudent, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session || session.student_id !== req.user.id) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  if (session.status !== 'active') return res.status(409).json({ error: 'Sesi sudah dikirim atau tidak aktif.' });
  finalizeSession(session.id, 'submitted');
  const result = db.prepare('SELECT * FROM results WHERE session_id = ?').get(session.id);
  res.json({ ok: true, result });
});

app.get('/api/sessions/:id/map', authStudent, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session || session.student_id !== req.user.id) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  const order = getOrder(session.id, session.exam_id);
  const answers = db.prepare('SELECT question_id, jawaban FROM answers WHERE session_id = ?').all(session.id);
  const marks = db.prepare('SELECT question_id FROM session_marks WHERE session_id = ?').all(session.id);
  const ansMap = new Map(answers.map(a => [a.question_id, a.jawaban]));
  const markSet = new Set(marks.map(m => m.question_id));
  res.json(order.map((qid, i) => ({
    nomor: i + 1, question_id: qid,
    dijawab: ansMap.get(qid) || null, ditandai: markSet.has(qid)
  })));
});

app.post('/api/sessions/:id/mark', authStudent, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session || session.student_id !== req.user.id) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  if (session.status !== 'active') return res.status(409).json({ error: 'Sesi tidak aktif.' });
  const { question_id, ditandai } = req.body || {};
  const q = db.prepare('SELECT id FROM questions WHERE id = ? AND exam_id = ?').get(question_id, session.exam_id);
  if (!q) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
  if (ditandai) db.prepare('INSERT OR IGNORE INTO session_marks (session_id, question_id) VALUES (?, ?)').run(session.id, question_id);
  else db.prepare('DELETE FROM session_marks WHERE session_id = ? AND question_id = ?').run(session.id, question_id);
  res.json({ ok: true });
});

app.get('/api/sessions/:id/result', authStudent, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session || session.student_id !== req.user.id) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  const result = db.prepare('SELECT * FROM results WHERE session_id = ?').get(session.id);
  if (!result) return res.status(404).json({ error: 'Hasil belum tersedia.' });
  res.json(result);
});

// ============================================================
// API GURU
// ============================================================
app.post('/api/guru/login', (req, res) => {
  const ip = req.ip || '';
  const failEntry = checkLoginLimit(ip);
  if (failEntry.count >= 20) return res.status(429).json({ error: 'Terlalu banyak percobaan masuk gagal.' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email dan sandi wajib.' });
  const t = db.prepare('SELECT * FROM teachers WHERE email = ?').get(String(email).trim());
  if (!t || !bcrypt.compareSync(String(password), t.password_hash)) {
    recordLoginFail(ip);
    return res.status(401).json({ error: 'Email atau sandi salah.' });
  }
  clearLoginFail(ip);
  const token = jwt.sign({ role: 'teacher', id: t.id, email: t.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, teacher: { id: t.id, email: t.email } });
});

app.get('/api/guru/dashboard', authTeacher, (req, res) => {
  const now = nowISO();
  const today = new Date().toISOString().slice(0, 10);
  const oneMinAgo = new Date(Date.now() - 60000).toISOString();
  const examsAktif = db.prepare('SELECT COUNT(*) c FROM exams WHERE aktif=1 AND mulai<=? AND selesai>=?').get(now, now).c;
  const examsTotal = db.prepare('SELECT COUNT(*) c FROM exams').get().c;
  const sesiAktif = db.prepare("SELECT COUNT(*) c FROM sessions WHERE status='active'").get().c;
  const sesiTotal = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  const muridTotal = db.prepare('SELECT COUNT(*) c FROM students').get().c;
  const pelanggaranHariIni = db.prepare("SELECT COUNT(*) c FROM cheat_logs WHERE berat=1 AND substr(created_at,1,10)=?").get(today).c;
  const sesiSelesaiHariIni = db.prepare("SELECT COUNT(*) c FROM sessions WHERE status IN ('submitted','timeout','terminated') AND substr(started_at,1,10)=?").get(today).c;
  const online = db.prepare("SELECT COUNT(*) c FROM sessions WHERE status='active' AND last_seen >= ?").get(oneMinAgo).c;
  res.json({ examsAktif, examsTotal, sesiAktif, sesiTotal, muridTotal, pelanggaranHariIni, sesiSelesaiHariIni, online });
});

app.get('/api/guru/students', authTeacher, (req, res) => {
  const rows = db.prepare('SELECT id, nis, nama, kelas, is_demo FROM students ORDER BY kelas, nama').all();
  logAccess(req.user, 'list_students', '');
  res.json(rows);
});

app.post('/api/guru/students', authTeacher, (req, res) => {
  const { teks } = req.body || {};
  if (typeof teks !== 'string') return res.status(400).json({ error: 'Teks wajib.' });
  const lines = teks.split(/\r?\n/);
  const errors = [];
  let inserted = 0, updated = 0;
  const find = db.prepare('SELECT id FROM students WHERE nis = ?');
  const ins = db.prepare('INSERT INTO students (nis, nama, kelas, password_hash) VALUES (?, ?, ?, ?)');
  const upd = db.prepare('UPDATE students SET nama = ?, kelas = ?, password_hash = ? WHERE nis = ?');
  const tx = db.transaction(() => {
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;
      const parts = raw.split(/[;\t]/).map(s => s.trim());
      if (parts.length !== 4 || parts.some(p => !p)) { errors.push('Baris ' + (i + 1) + ': format harus NIS ; Nama ; Kelas ; Sandi'); continue; }
      const [nis, nama, kelas, sandi] = parts;
      const hash = bcrypt.hashSync(sandi, 10);
      const existing = find.get(nis);
      if (existing) { upd.run(nama, kelas, hash, nis); updated++; }
      else { ins.run(nis, nama, kelas, hash); inserted++; }
    }
  });
  tx();
  logAccess(req.user, 'import_students', 'baru=' + inserted + ' diperbarui=' + updated + ' error=' + errors.length);
  res.json({ inserted, updated, errors });
});

app.put('/api/guru/students/:id', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Murid tidak ditemukan.' });
  const b = req.body || {};
  const newNis = b.nis != null ? String(b.nis).trim() : s.nis;
  const newNama = b.nama != null ? String(b.nama).trim() : s.nama;
  const newKelas = b.kelas != null ? String(b.kelas).trim() : s.kelas;
  if (!newNis || !newNama) return res.status(400).json({ error: 'NIS dan Nama wajib.' });
  const dup = db.prepare('SELECT id FROM students WHERE nis = ? AND id != ?').get(newNis, id);
  if (dup) return res.status(409).json({ error: 'NIS sudah dipakai murid lain.' });
  db.prepare('UPDATE students SET nis = ?, nama = ?, kelas = ? WHERE id = ?').run(newNis, newNama, newKelas, id);
  logAccess(req.user, 'update_student', 'student=' + id);
  res.json({ ok: true });
});

app.post('/api/guru/students/:id/reset-password', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Murid tidak ditemukan.' });
  const b = req.body || {};
  const newSandi = (b.sandi && String(b.sandi).length >= 4) ? String(b.sandi) : Math.random().toString(36).slice(-8);
  const hash = bcrypt.hashSync(newSandi, 10);
  db.prepare('UPDATE students SET password_hash = ? WHERE id = ?').run(hash, id);
  logAccess(req.user, 'reset_student_password', 'student=' + id);
  res.json({ ok: true, sandi: newSandi });
});

app.get('/api/guru/students/:id/detail', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare('SELECT id, nis, nama, kelas, is_demo FROM students WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Murid tidak ditemukan.' });
  const sessions = db.prepare(`
    SELECT s.id, s.status, s.cheat_count, s.warn_count, s.started_at, s.last_seen,
           e.id AS exam_id, e.judul AS exam_judul, e.mapel AS exam_mapel, e.durasi_menit,
           r.nilai_awal, r.pengurangan, r.nilai_akhir, r.benar, r.total_soal,
           (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id) AS terjawab
    FROM sessions s
    JOIN exams e ON e.id = s.exam_id
    LEFT JOIN results r ON r.session_id = s.id
    WHERE s.student_id = ?
    ORDER BY s.started_at DESC
  `).all(id);
  const nilaiSelesai = sessions.filter(x => x.nilai_akhir != null).map(x => x.nilai_akhir);
  const totalPelanggaran = sessions.reduce((a, x) => a + (x.cheat_count || 0), 0);
  const totalPeringatan = sessions.reduce((a, x) => a + (x.warn_count || 0), 0);
  const rataRata = nilaiSelesai.length ? nilaiSelesai.reduce((a, b) => a + b, 0) / nilaiSelesai.length : null;
  logAccess(req.user, 'view_student_detail', 'student=' + id);
  res.json({
    student: s, sessions,
    ringkasan: {
      total_ujian: sessions.length,
      total_selesai: sessions.filter(x => x.status === 'submitted' || x.status === 'timeout').length,
      nilai_rata: rataRata,
      nilai_tertinggi: nilaiSelesai.length ? Math.max.apply(null, nilaiSelesai) : null,
      nilai_terendah: nilaiSelesai.length ? Math.min.apply(null, nilaiSelesai) : null,
      total_pelanggaran: totalPelanggaran,
      total_peringatan: totalPeringatan
    }
  });
});

app.delete('/api/guru/students/:id', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Murid tidak ditemukan.' });
  const sesCount = db.prepare('SELECT COUNT(*) c FROM sessions WHERE student_id = ?').get(id).c;
  if (sesCount > 0) return res.status(409).json({ error: 'Murid sudah memiliki ' + sesCount + ' sesi ujian.' });
  db.prepare('DELETE FROM students WHERE id = ?').run(id);
  logAccess(req.user, 'delete_student', 'student=' + id);
  res.json({ ok: true });
});

app.get('/api/guru/exams', authTeacher, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS jumlah_soal,
      (SELECT COUNT(*) FROM sessions s WHERE s.exam_id = e.id) AS jumlah_sesi
    FROM exams e ORDER BY e.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/guru/exams', authTeacher, (req, res) => {
  const b = req.body || {};
  const judul = String(b.judul || '').trim();
  const mapel = String(b.mapel || '').trim();
  const durasi = parseInt(b.durasi_menit, 10);
  const mulai = b.mulai ? new Date(b.mulai) : null;
  const selesai = b.selesai ? new Date(b.selesai) : null;
  if (!judul) return res.status(400).json({ error: 'Judul wajib.' });
  if (!Number.isFinite(durasi) || durasi <= 0) return res.status(400).json({ error: 'Durasi harus angka positif.' });
  if (!mulai || isNaN(mulai.getTime())) return res.status(400).json({ error: 'Waktu Mulai tidak valid.' });
  if (!selesai || isNaN(selesai.getTime())) return res.status(400).json({ error: 'Waktu Selesai tidak valid.' });
  if (selesai <= mulai) return res.status(400).json({ error: 'Jadwal Selesai harus lebih akhir daripada Mulai.' });
  const aktif = b.aktif ? 1 : 0;
  const acak = b.acak === false ? 0 : 1;
  const batas = parseInt(b.batas_pelanggaran, 10) || 5;
  const info = db.prepare(`INSERT INTO exams (judul, mapel, durasi_menit, mulai, selesai, aktif, acak, batas_pelanggaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(judul, mapel, durasi, mulai.toISOString(), selesai.toISOString(), aktif, acak, batas);
  logAccess(req.user, 'create_exam', 'exam=' + info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/guru/exams/:id', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  if (!exam) return res.status(404).json({ error: 'Ujian tidak ditemukan.' });
  const sesCount = db.prepare('SELECT COUNT(*) c FROM sessions WHERE exam_id = ?').get(id).c;
  if (sesCount > 0) return res.status(409).json({ error: 'Ujian tidak dapat diubah setelah ada murid yang memulai.' });
  const b = req.body || {};
  const judul = String(b.judul != null ? b.judul : exam.judul).trim();
  const mapel = String(b.mapel != null ? b.mapel : (exam.mapel || '')).trim();
  const durasi = parseInt(b.durasi_menit != null ? b.durasi_menit : exam.durasi_menit, 10);
  const mulai = b.mulai ? new Date(b.mulai) : new Date(exam.mulai);
  const selesai = b.selesai ? new Date(b.selesai) : new Date(exam.selesai);
  const aktif = (b.aktif != null) ? (b.aktif ? 1 : 0) : exam.aktif;
  const acak = (b.acak != null) ? (b.acak ? 1 : 0) : exam.acak;
  const batas = parseInt(b.batas_pelanggaran != null ? b.batas_pelanggaran : exam.batas_pelanggaran, 10);
  if (!judul) return res.status(400).json({ error: 'Judul wajib.' });
  if (!Number.isFinite(durasi) || durasi <= 0) return res.status(400).json({ error: 'Durasi tidak valid.' });
  if (selesai <= mulai) return res.status(400).json({ error: 'Jadwal Selesai harus lebih akhir daripada Mulai.' });
  db.prepare('UPDATE exams SET judul=?, mapel=?, durasi_menit=?, mulai=?, selesai=?, aktif=?, acak=?, batas_pelanggaran=? WHERE id=?')
    .run(judul, mapel, durasi, mulai.toISOString(), selesai.toISOString(), aktif, acak, batas, id);
  logAccess(req.user, 'update_exam', 'exam=' + id);
  res.json({ ok: true });
});

app.patch('/api/guru/exams/:id/toggle', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  if (!exam) return res.status(404).json({ error: 'Ujian tidak ditemukan.' });
  const newAktif = exam.aktif ? 0 : 1;
  db.prepare('UPDATE exams SET aktif = ? WHERE id = ?').run(newAktif, id);
  logAccess(req.user, 'toggle_exam', 'exam=' + id + ' aktif=' + newAktif);
  res.json({ ok: true, aktif: newAktif });
});

app.delete('/api/guru/exams/:id', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  if (!exam) return res.status(404).json({ error: 'Ujian tidak ditemukan.' });
  const sesCount = db.prepare('SELECT COUNT(*) c FROM sessions WHERE exam_id = ?').get(id).c;
  if (sesCount > 0) return res.status(409).json({ error: 'Ujian sudah memiliki ' + sesCount + ' sesi.' });
  db.prepare('DELETE FROM questions WHERE exam_id = ?').run(id);
  db.prepare('DELETE FROM exams WHERE id = ?').run(id);
  logAccess(req.user, 'delete_exam', 'exam=' + id);
  res.json({ ok: true });
});

app.post('/api/guru/exams/:id/duplicate', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  if (!exam) return res.status(404).json({ error: 'Ujian tidak ditemukan.' });
  const b = req.body || {};
  const judul = String(b.judul || (exam.judul + ' (Salinan)')).trim();
  const mulai = b.mulai ? new Date(b.mulai) : new Date(exam.mulai);
  const selesai = b.selesai ? new Date(b.selesai) : new Date(exam.selesai);
  if (selesai <= mulai) return res.status(400).json({ error: 'Jadwal Selesai harus lebih akhir.' });
  const info = db.prepare(`
    INSERT INTO exams (judul, mapel, durasi_menit, mulai, selesai, aktif, acak, batas_pelanggaran)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(judul, exam.mapel, exam.durasi_menit, mulai.toISOString(), selesai.toISOString(), exam.acak, exam.batas_pelanggaran);
  const newId = info.lastInsertRowid;
  const qs = db.prepare('SELECT * FROM questions WHERE exam_id = ?').all(id);
  const ins = db.prepare('INSERT INTO questions (exam_id, pertanyaan, stimulus, tipe, opsi_a, opsi_b, opsi_c, opsi_d, opsi_ekstra, kunci) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const q of qs) ins.run(newId, q.pertanyaan, q.stimulus || '', q.tipe || 'pg4', q.opsi_a, q.opsi_b, q.opsi_c, q.opsi_d, q.opsi_ekstra || '', q.kunci);
  logAccess(req.user, 'duplicate_exam', 'from=' + id + ' to=' + newId);
  res.json({ ok: true, id: newId, jumlah_soal: qs.length });
});

app.post('/api/guru/exams/:id/reset-all', authTeacher, (req, res) => {
  const examId = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
  if (!exam) return res.status(404).json({ error: 'Ujian tidak ditemukan.' });
  const sessions = db.prepare('SELECT id FROM sessions WHERE exam_id = ?').all(examId);
  const ids = sessions.map(s => s.id);
  if (ids.length === 0) return res.json({ ok: true, dihapus: 0 });
  const tx = db.transaction(() => {
    for (const sid of ids) {
      db.prepare('DELETE FROM cheat_logs WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM answers WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM session_marks WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM results WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    }
  });
  tx();
  logAccess(req.user, 'reset_all_sessions', 'exam=' + examId + ' count=' + ids.length);
  res.json({ ok: true, dihapus: ids.length });
});

app.post('/api/guru/exams/:id/questions', authTeacher, (req, res) => {
  const examId = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
  if (!exam) return res.status(404).json({ error: 'Ujian tidak ditemukan.' });
  const count = db.prepare('SELECT COUNT(*) c FROM sessions WHERE exam_id = ?').get(examId).c;
  if (count > 0) return res.status(409).json({ error: 'Soal tidak dapat diubah setelah ada murid yang memulai ujian.' });
  const { teks, replace } = req.body || {};
  if (typeof teks !== 'string') return res.status(400).json({ error: 'Teks wajib.' });
  const lines = teks.split(/\r?\n/);
  const errors = [];
  const valid = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const parts = raw.split(/[;\t]/).map(s => s.trim());
    if (parts.length !== 6) { errors.push('Baris ' + (i + 1) + ': harus 6 kolom'); continue; }
    const [p, a, bb, c, d, k] = parts;
    const kunci = k.toUpperCase();
    if (!['A','B','C','D'].includes(kunci)) { errors.push('Baris ' + (i + 1) + ': kunci harus A/B/C/D'); continue; }
    if (!p || !a || !bb || !c || !d) { errors.push('Baris ' + (i + 1) + ': kolom tidak boleh kosong'); continue; }
    valid.push({ p, a, b: bb, c, d, kunci });
  }
  if (errors.length > 0) return res.status(400).json({ errors, inserted: 0 });
  const tx = db.transaction(() => {
    if (replace) db.prepare('DELETE FROM questions WHERE exam_id = ?').run(examId);
    const ins = db.prepare(`INSERT INTO questions (exam_id, pertanyaan, stimulus, tipe, opsi_a, opsi_b, opsi_c, opsi_d, opsi_ekstra, kunci) VALUES (?, ?, '', 'pg4', ?, ?, ?, ?, '', ?)`);
    for (const q of valid) ins.run(examId, q.p, q.a, q.b, q.c, q.d, q.kunci);
  });
  tx();
  logAccess(req.user, 'import_questions', 'exam=' + examId + ' inserted=' + valid.length);
  res.json({ inserted: valid.length, errors });
});

app.get('/api/guru/exams/:id/questions', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = db.prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY id').all(id);
  logAccess(req.user, 'view_questions', 'exam=' + id);
  res.json(rows);
});

app.get('/api/guru/questions/:id', authTeacher, (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
  res.json(q);
});

function validateQuestionBody(b) {
  const tipe = ['pg4','pg5','bs','isian','pgk'].includes(b.tipe) ? b.tipe : 'pg4';
  const pertanyaan = cleanHtml(b.pertanyaan);
  const stimulus = cleanHtml(b.stimulus);
  if (!pertanyaan || pertanyaan.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() === '') {
    return { error: 'Teks pertanyaan wajib.' };
  }
  let opsiA = '', opsiB = '', opsiC = '', opsiD = '', opsiEkstra = '', kunci = '';
  if (tipe === 'pg4' || tipe === 'pg5' || tipe === 'pgk') {
    opsiA = cleanHtml(b.opsi_a); opsiB = cleanHtml(b.opsi_b);
    opsiC = cleanHtml(b.opsi_c); opsiD = cleanHtml(b.opsi_d);
    if (!opsiA || !opsiB || !opsiC || !opsiD) return { error: 'Opsi A-D wajib diisi.' };
    if (tipe === 'pg5') {
      opsiEkstra = cleanHtml(b.opsi_e);
      if (!opsiEkstra) return { error: 'Opsi E wajib untuk PG5.' };
      kunci = String(b.kunci || '').toUpperCase();
      if (!['A','B','C','D','E'].includes(kunci)) return { error: 'Kunci PG5 harus A-E.' };
    } else if (tipe === 'pg4') {
      kunci = String(b.kunci || '').toUpperCase();
      if (!['A','B','C','D'].includes(kunci)) return { error: 'Kunci PG4 harus A-D.' };
    } else {
      const set = new Set(String(b.kunci || '').toUpperCase().replace(/[^A-E]/g, '').split('').filter(Boolean));
      if (set.size < 2) return { error: 'PG Kompleks butuh minimal 2 kunci benar.' };
      kunci = Array.from(set).sort().join('');
    }
  } else if (tipe === 'bs') {
    opsiA = 'Benar'; opsiB = 'Salah';
    kunci = String(b.kunci || '').toUpperCase();
    if (!['A','B'].includes(kunci)) return { error: 'Kunci Benar/Salah harus A atau B.' };
  } else if (tipe === 'isian') {
    kunci = String(b.kunci || '').trim();
    if (!kunci) return { error: 'Jawaban benar wajib diisi.' };
    if (kunci.length > 500) return { error: 'Jawaban terlalu panjang (maks 500 karakter).' };
  }
  return { tipe, pertanyaan, stimulus, opsiA, opsiB, opsiC, opsiD, opsiEkstra, kunci };
}

app.post('/api/guru/exams/:id/questions/new', authTeacher, (req, res) => {
  const examId = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(examId);
  if (!exam) return res.status(404).json({ error: 'Ujian tidak ditemukan.' });
  const sesCount = db.prepare('SELECT COUNT(*) c FROM sessions WHERE exam_id = ?').get(examId).c;
  if (sesCount > 0) return res.status(409).json({ error: 'Soal tidak dapat ditambah setelah ada murid yang memulai ujian.' });
  const v = validateQuestionBody(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const info = db.prepare(`
    INSERT INTO questions (exam_id, pertanyaan, stimulus, tipe, opsi_a, opsi_b, opsi_c, opsi_d, opsi_ekstra, kunci)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(examId, v.pertanyaan, v.stimulus, v.tipe, v.opsiA, v.opsiB, v.opsiC, v.opsiD, v.opsiEkstra, v.kunci);
  logAccess(req.user, 'create_question', 'exam=' + examId + ' q=' + info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/guru/questions/:id', authTeacher, (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
  const sesCount = db.prepare('SELECT COUNT(*) c FROM sessions WHERE exam_id = ?').get(q.exam_id).c;
  if (sesCount > 0) return res.status(409).json({ error: 'Soal tidak dapat diubah setelah ada murid yang memulai ujian.' });
  const v = validateQuestionBody(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  db.prepare(`
    UPDATE questions SET pertanyaan=?, stimulus=?, tipe=?, opsi_a=?, opsi_b=?, opsi_c=?, opsi_d=?, opsi_ekstra=?, kunci=? WHERE id=?
  `).run(v.pertanyaan, v.stimulus, v.tipe, v.opsiA, v.opsiB, v.opsiC, v.opsiD, v.opsiEkstra, v.kunci, q.id);
  logAccess(req.user, 'update_question', 'q=' + q.id);
  res.json({ ok: true });
});

app.delete('/api/guru/questions/:id', authTeacher, (req, res) => {
  const qid = parseInt(req.params.id, 10);
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(qid);
  if (!q) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
  const sesCount = db.prepare('SELECT COUNT(*) c FROM sessions WHERE exam_id = ?').get(q.exam_id).c;
  if (sesCount > 0) return res.status(409).json({ error: 'Soal tidak dapat dihapus setelah ada murid yang memulai ujian.' });
  db.prepare('DELETE FROM questions WHERE id = ?').run(qid);
  logAccess(req.user, 'delete_question', 'q=' + qid);
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safe = ['.jpg','.jpeg','.png','.gif','.webp'].includes(ext) ? ext : '.jpg';
      cb(null, 'q_' + crypto.randomBytes(16).toString('hex') + safe);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)) {
      return cb(new Error('Format gambar harus JPG, PNG, GIF, atau WEBP.'));
    }
    cb(null, true);
  }
});

app.post('/api/guru/upload-image', authTeacher, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Tidak ada gambar.' });
    res.json({ url: '/uploads/' + req.file.filename, ukuran: req.file.size });
  });
});

app.get('/api/guru/exams/:id/monitor', authTeacher, (req, res) => {
  const examId = parseInt(req.params.id, 10);
  const rows = db.prepare(`
    SELECT s.id, s.status, s.cheat_count, s.warn_count, s.last_seen, s.started_at,
           st.nis, st.nama, st.kelas,
           (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id) AS terjawab,
           (SELECT COUNT(*) FROM questions q WHERE q.exam_id = s.exam_id) AS total
    FROM sessions s JOIN students st ON st.id = s.student_id
    WHERE s.exam_id = ? ORDER BY st.kelas, st.nama
  `).all(examId);
  res.json(rows);
});

app.get('/api/guru/sessions/:id/detail', authTeacher, (req, res) => {
  const s = db.prepare(`
    SELECT s.*, st.nis, st.nama, st.kelas, e.judul AS exam_judul
    FROM sessions s JOIN students st ON st.id = s.student_id JOIN exams e ON e.id = s.exam_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  const result = db.prepare('SELECT * FROM results WHERE session_id = ?').get(s.id);
  const logs = db.prepare('SELECT * FROM cheat_logs WHERE session_id = ? ORDER BY id DESC LIMIT 50').all(s.id);
  logAccess(req.user, 'view_session_detail', 'session=' + s.id);
  res.json({ session: s, result: result || null, logs });
});

app.post('/api/guru/sessions/:id/reset', authTeacher, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('active', session.id);
  logAccess(req.user, 'reset_session', 'session=' + session.id);
  res.json({ ok: true, catatan: 'Log pelanggaran tidak dihapus.' });
});

app.post('/api/guru/sessions/:id/terminate', authTeacher, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  if (session.status !== 'active') return res.status(409).json({ error: 'Sesi tidak aktif.' });
  finalizeSession(session.id, 'terminated');
  logAccess(req.user, 'terminate_session', 'session=' + session.id);
  res.json({ ok: true });
});

app.get('/api/guru/exams/:id/analysis', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  if (!exam) return res.status(404).json({ error: 'Ujian tidak ditemukan.' });
  const totalSoal = db.prepare('SELECT COUNT(*) c FROM questions WHERE exam_id = ?').get(id).c;
  const totalSesi = db.prepare('SELECT COUNT(*) c FROM sessions WHERE exam_id = ?').get(id).c;
  const totalSubmit = db.prepare("SELECT COUNT(*) c FROM sessions WHERE exam_id = ? AND status IN ('submitted','timeout')").get(id).c;
  const nilaiRows = db.prepare(`SELECT r.nilai_akhir FROM results r JOIN sessions s ON s.id = r.session_id WHERE s.exam_id = ?`).all(id).map(r => r.nilai_akhir);
  const rata = nilaiRows.length ? nilaiRows.reduce((a, b) => a + b, 0) / nilaiRows.length : 0;
  const tertinggi = nilaiRows.length ? Math.max.apply(null, nilaiRows) : 0;
  const terendah = nilaiRows.length ? Math.min.apply(null, nilaiRows) : 0;
  const perKelas = db.prepare(`
    SELECT st.kelas, COUNT(DISTINCT st.id) AS jumlah_murid, COUNT(r.id) AS jumlah_selesai,
           AVG(r.nilai_akhir) AS rata_rata, MAX(r.nilai_akhir) AS tertinggi, MIN(r.nilai_akhir) AS terendah
    FROM students st JOIN sessions s ON s.student_id = st.id AND s.exam_id = ?
    LEFT JOIN results r ON r.session_id = s.id
    GROUP BY st.kelas ORDER BY st.kelas
  `).all(id);
  const perSoal = db.prepare(`
    SELECT q.id, q.pertanyaan, q.kunci,
      SUM(CASE WHEN a.jawaban = q.kunci AND s.status IN ('submitted','timeout') THEN 1 ELSE 0 END) AS benar,
      SUM(CASE WHEN s.status IN ('submitted','timeout') THEN 1 ELSE 0 END) AS total_jawab
    FROM questions q LEFT JOIN answers a ON a.question_id = q.id LEFT JOIN sessions s ON s.id = a.session_id
    WHERE q.exam_id = ? GROUP BY q.id ORDER BY q.id
  `).all(id).map(r => ({
    id: r.id,
    pertanyaan: r.pertanyaan.length > 90 ? r.pertanyaan.slice(0, 90) + '...' : r.pertanyaan,
    kunci: r.kunci, benar: r.benar || 0, total_jawab: r.total_jawab || 0,
    total_murid: totalSubmit,
    persen_benar: totalSubmit > 0 ? Math.round((r.benar || 0) / totalSubmit * 100) : 0
  }));
  logAccess(req.user, 'view_analysis', 'exam=' + id);
  res.json({
    ringkasan: { total_soal: totalSoal, total_sesi: totalSesi, total_submit: totalSubmit, rata_rata: rata, tertinggi, terendah },
    perKelas, perSoal
  });
});

app.get('/api/guru/exams/:id/logs', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = db.prepare(`
    SELECT cl.*, st.nis, st.nama, st.kelas
    FROM cheat_logs cl JOIN sessions s ON s.id = cl.session_id JOIN students st ON st.id = s.student_id
    WHERE s.exam_id = ? ORDER BY cl.id DESC LIMIT 500
  `).all(id);
  logAccess(req.user, 'view_exam_logs', 'exam=' + id);
  res.json(rows);
});

app.get('/api/guru/sessions/:id/logs', authTeacher, (req, res) => {
  const rows = db.prepare('SELECT * FROM cheat_logs WHERE session_id = ? ORDER BY id DESC').all(req.params.id);
  logAccess(req.user, 'view_logs', 'session=' + req.params.id);
  res.json(rows);
});

app.get('/api/guru/exams/:id/export', authTeacher, (req, res) => {
  const examId = parseInt(req.params.id, 10);
  const exam = db.prepare('SELECT judul FROM exams WHERE id = ?').get(examId);
  const rows = db.prepare(`
    SELECT st.nis, st.nama, st.kelas, s.status, s.cheat_count, s.warn_count,
           r.nilai_awal, r.pengurangan, r.nilai_akhir, r.benar, r.total_soal
    FROM sessions s JOIN students st ON st.id = s.student_id
    LEFT JOIN results r ON r.session_id = s.id
    WHERE s.exam_id = ? ORDER BY st.kelas, st.nama
  `).all(examId);
  const header = ['NIS','Nama','Kelas','Status','Pelanggaran Berat','Peringatan','Nilai Awal','Pengurangan (%)','Nilai Akhir','Benar','Total Soal'];
  const lines = [header.join(';')];
  for (const r of rows) {
    const row = [r.nis, r.nama, r.kelas, r.status, r.cheat_count, r.warn_count,
      r.nilai_awal != null ? Number(r.nilai_awal).toFixed(2) : '',
      r.pengurangan != null ? Number(r.pengurangan).toFixed(2) : '',
      r.nilai_akhir != null ? Number(r.nilai_akhir).toFixed(2) : '',
      r.benar != null ? r.benar : '', r.total_soal != null ? r.total_soal : ''
    ].map(x => String(x).replace(/[;\r\n]/g, ' ')).join(';');
    lines.push(row);
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  const safeTitle = (exam ? exam.judul : 'exam').replace(/[^A-Za-z0-9_-]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="nilai_' + safeTitle + '_' + examId + '.csv"');
  logAccess(req.user, 'export_csv', 'exam=' + examId);
  res.send(csv);
});

app.post('/api/guru/change-password', authTeacher, (req, res) => {
  const b = req.body || {};
  const current = b.current, baru = b.new;
  if (!current || !baru) return res.status(400).json({ error: 'Sandi lama dan baru wajib.' });
  if (String(baru).length < 6) return res.status(400).json({ error: 'Sandi baru minimal 6 karakter.' });
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current), t.password_hash)) return res.status(401).json({ error: 'Sandi lama salah.' });
  const hash = bcrypt.hashSync(String(baru), 10);
  db.prepare('UPDATE teachers SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  logAccess(req.user, 'change_own_password', '');
  res.json({ ok: true });
});

app.get('/api/guru/teachers', authTeacher, (req, res) => {
  res.json(db.prepare('SELECT id, email FROM teachers ORDER BY id').all());
});

app.post('/api/guru/teachers', authTeacher, (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim();
  const password = String(b.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email dan sandi wajib.' });
  if (password.length < 6) return res.status(400).json({ error: 'Sandi minimal 6 karakter.' });
  const dup = db.prepare('SELECT id FROM teachers WHERE email = ?').get(email);
  if (dup) return res.status(409).json({ error: 'Email sudah terdaftar.' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO teachers (email, password_hash) VALUES (?, ?)').run(email, hash);
  logAccess(req.user, 'add_teacher', 'id=' + info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/guru/teachers/:id', authTeacher, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'Tidak dapat menghapus akun sendiri.' });
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Guru tidak ditemukan.' });
  const total = db.prepare('SELECT COUNT(*) c FROM teachers').get().c;
  if (total <= 1) return res.status(400).json({ error: 'Harus ada minimal satu guru.' });
  db.prepare('DELETE FROM teachers WHERE id = ?').run(id);
  logAccess(req.user, 'delete_teacher', 'id=' + id);
  res.json({ ok: true });
});

app.get('/api/guru/access-log', authTeacher, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const rows = db.prepare('SELECT * FROM access_log ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.post('/api/guru/backup', authTeacher, async (req, res) => {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = 'manual-' + stamp + '.db';
    const dest = path.join(BACKUP_DIR, filename);
    await db.backup(dest);
    logAccess(req.user, 'manual_backup', filename);
    res.json({ ok: true, filename, ukuran: fs.statSync(dest).size });
  } catch (e) { res.status(500).json({ error: 'Gagal membuat backup: ' + e.message }); }
});

app.get('/api/guru/backup/list', authTeacher, (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).map(f => {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    return { filename: f, ukuran: stat.size, dibuat: stat.mtime.toISOString() };
  }).sort((a, b) => b.dibuat.localeCompare(a.dibuat));
  res.json(files);
});

app.get('/api/guru/backup/download/:filename', authTeacher, (req, res) => {
  const filename = String(req.params.filename).replace(/[^A-Za-z0-9._-]/g, '');
  const full = path.join(BACKUP_DIR, filename);
  if (!full.startsWith(BACKUP_DIR) || !fs.existsSync(full)) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });
  logAccess(req.user, 'download_backup', filename);
  res.download(full);
});

async function backupDaily() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, 'ujian-' + stamp + '.db');
  try {
    await db.backup(dest);
    console.log('[BACKUP] Cadangan dibuat: ' + dest);
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('ujian-') && f.endsWith('.db')).sort();
    while (files.length > 30) {
      const f = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {}
    }
  } catch (e) { console.error('[BACKUP] Gagal: ' + e.message); }
}
(function scheduleBackup() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(async () => { await backupDaily(); scheduleBackup(); }, next - now);
})();
setTimeout(backupDaily, 8000);

app.use((err, req, res, next) => {
  console.error('[ERROR] ' + err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Kesalahan server internal.' });
});

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => {
  console.log('Server berjalan di http://localhost:' + PORT);
  console.log('Halaman murid  : /');
  console.log('Panel guru     : /guru.html');
});