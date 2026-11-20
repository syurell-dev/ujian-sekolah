'use strict';

/**
 * Menulis ulang alamat server pada capacitor.config.json.
 * Contoh: EXAM_SERVER_URL=http://10.10.10.5:3000 node scripts/set-server.js
 */

const fs = require('fs');
const path = require('path');

const url = (process.env.EXAM_SERVER_URL || process.argv[2] || '').trim().replace(/\/+$/, '');
if (!url) {
  console.error('Alamat server wajib. Contoh: node scripts/set-server.js http://192.168.1.10:3000');
  process.exit(1);
}
if (!/^https?:\/\//i.test(url)) {
  console.error('Alamat server harus dimulai dengan http:// atau https://');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'capacitor.config.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.server = Object.assign({}, cfg.server, { url, cleartext: url.startsWith('http://') });
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('[OK] server.url = ' + url);
