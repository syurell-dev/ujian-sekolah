const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'ujian.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('Basis data belum ada. Jalankan aplikasi (npm start) terlebih dahulu.');
  process.exit(1);
}

const db = new Database(DB_PATH);
const [email, newPassword] = process.argv.slice(2);

if (!email && !newPassword) {
  const rows = db.prepare('SELECT id, email FROM teachers ORDER BY id').all();
  if (rows.length === 0) {
    console.log('Belum ada akun guru.');
  } else {
    console.log('Daftar akun guru:');
    for (const r of rows) console.log('  - ' + r.email);
  }
  process.exit(0);
}

if (email && newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  const info = db.prepare('UPDATE teachers SET password_hash = ? WHERE email = ?').run(hash, email);
  if (info.changes === 0) {
    console.error('Guru dengan email "' + email + '" tidak ditemukan.');
    process.exit(1);
  }
  console.log('Sandi guru "' + email + '" berhasil diubah.');
  process.exit(0);
}

console.error('Penggunaan:');
console.error('  node reset-guru.js                       # Tampilkan daftar email guru');
console.error('  node reset-guru.js EMAIL SANDIBARU       # Ganti sandi guru');
process.exit(1);