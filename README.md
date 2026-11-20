# Aplikasi Ujian Online Sekolah

Aplikasi ujian sumatif (nilai rapor) berbasis web yang ringan dan aman. Dibangun menggunakan Node.js, Express, dan SQLite, aplikasi ini dapat dijalankan secara lokal (jaringan sekolah) tanpa memerlukan instalasi rumit.

## Fitur Utama

### Panel Guru

- Dashboard Interaktif: Ringkasan ujian aktif, murid online, dan statistik pelanggaran.
- Manajemen Data: Impor massal akun murid dan ekspor nilai ke CSV.
- Editor Soal Lengkap: Mendukung 5 tipe soal (PG 4 Opsi, PG 5 Opsi, Benar/Salah, Isian Singkat, PG Kompleks).
- Dukungan Media: Sisipkan gambar langsung dan rumus matematika menggunakan KaTeX.
- Stimulus Bacaan: Dukungan teks pengantar panjang dengan kotak scroll.
- Monitor Ujian: Pantau aktivitas murid dan lihat log pelanggaran.
- Backup Otomatis: Database diamankan secara otomatis setiap hari.

### Halaman Murid

- Tampilan Responsif: Nyaman digunakan di HP maupun laptop.
- Navigasi Mudah: Panel navigasi soal, penanda soal, dan timer hitung mundur.
- Deteksi Kecurangan: Sistem mendeteksi pindah tab, keluar layar penuh, dan membatasi penggunaan perangkat ganda.

## Cara Menjalankan (Instalasi Cepat)

Anda tidak perlu menginstal Node.js. Aplikasi ini sudah dikemas menjadi file portable untuk Windows.

1. Buka tab Releases di halaman repositori ini.
2. Unduh file ujian-vX.X.X.zip versi terbaru.
3. Ekstrak (unzip) file tersebut di komputer.
4. Klik dua kali pada file start.bat.
5. Browser akan otomatis terbuka ke http://localhost:3000

Akun Uji Coba (Demo): Login Murid menggunakan NIS DEMO dengan sandi demo.

## Cara Menjalankan (Untuk Developer)

Jika Anda ingin mengubah kode atau mengembangkan aplikasi ini, pastikan komputer Anda sudah terinstal Node.js versi 24 LTS.

```bash
# 1. Clone repositori ini
git clone https://github.com/syurell-dev/ujian-v4.git
cd ujian-v4

# 2. Instal dependensi
npm install

# 3. Jalankan server
npm start
```

Buka http://localhost:3000 untuk Halaman Murid dan http://localhost:3000/guru.html untuk Panel Guru.

## Aplikasi Ujian (Windows & Android)

Tersedia klien resmi untuk siswa di folder `client/`:

- **Windows**: installer/portable EXE (Electron, mode kiosk).
- **Android**: APK (Capacitor, `FLAG_SECURE` + screen pinning).

Halaman unduhan: `/aplikasi`. Panduan build dan konfigurasi ada di
[`client/README.md`](client/README.md).

Keamanan tambahan yang dipakai:

- Verifikasi HMAC aplikasi saat memulai ujian.
- Sesi terikat ke `client_id` perangkat.
- Heartbeat 4 detik; server mencatat pelanggaran jika aplikasi ditutup,
  kehilangan fokus, keluar fullscreen, multi-monitor, RDP/VM, root/emulator,
  USB debugging, perekaman layar, atau jam diubah.
- Skor kepercayaan dan kolom **Perangkat** di Monitor Sesi.
- Opsi **Wajib Aplikasi Ujian** per ujian.

Aktifkan ujian wajib aplikasi di panel guru saat membuat/mengedit ujian.
Isi `EXAM_CLIENT_SECRET` di server dan samakan dengan konfigurasi klien.

## Catatan Keamanan dan Keterbatasan

Penting: Aplikasi ini adalah alat bantu. Pengawas manusia tetap wajib berada di ruangan saat ujian berlangsung.

- Deteksi Kecurangan: Fitur anti-kecurangan berjalan di browser dan hanya bersifat mendeteksi, tidak memblokir sepenuhnya. Penggunaan HP kedua atau screenshot tidak dapat dideteksi.
- Mode Kiosk: Sangat disarankan menggunakan Fully Kiosk Browser (Android) atau Guided Access (iPhone) untuk meminimalisir kecurangan.
- Data Pribadi (UU PDP): Database SQLite tersimpan secara lokal. Pastikan komputer server aman dan rutin melakukan backup pada folder data dan backups.

## Teknologi yang Digunakan

- Backend: Node.js dan Express.js
- Database: SQLite (better-sqlite3)
- Autentikasi: JWT (JSON Web Tokens) dan Bcrypt
- Frontend: HTML5, Vanilla JavaScript, dan CSS3
- Keamanan HTML: sanitize-html
- Rendering Rumus: KaTeX