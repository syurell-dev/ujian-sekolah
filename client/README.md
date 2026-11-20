# Aplikasi Ujian (Klien Windows & Android)

Klien resmi untuk halaman ujian murid. Tujuannya menaikkan keamanan di
perangkat **BYOD** (milik siswa) sejauh yang mungkin tanpa hak admin/Device
Owner.

## Jujur soal batasnya

Aplikasi ini **bukan kiosk sejati**. Di perangkat pribadi:

- Windows: siswa yang memegang hak admin tetap bisa menutup paksa proses,
  memakai VM/RDP, atau mengubah sistem.
- Android: tanpa **Device Owner**, screen pinning masih bisa keluar dengan
  gesture + PIN, dan aplikasi bisa dimatikan paksa.
- HP kedua, kamera eksternal, dan pengawas yang lengah tidak bisa dicegah
  oleh perangkat lunak apa pun.

Karena itu aplikasi ini menggabungkan tiga lapis:

1. **Pencegahan** — kiosk/fullscreen, blokir pintasan, `FLAG_SECURE`,
   screen pinning, blokir tombol kembali.
2. **Deteksi** — pindah fokus, keluar fullscreen, multi-monitor, RDP, VM,
   proses mencurigakan, root, emulator, multi-window, USB debugging,
   perekaman layar, jam tidak sinkron.
3. **Konsekuensi di server** — server yang memutuskan pelanggaran,
   menjatuhkan skor kepercayaan, dan menghentikan ujian saat batas tercapai.
   Heartbeat yang berhenti > 45 detik juga dicatat sebagai pelanggaran berat.

Server tetap menjadi otoritas. Klien tidak bisa “menyembunyikan” pelanggaran
karena server punya aturan sendiri dan watchdog heartbeat.

## Isi folder

```
client/
  windows/    Electron (EXE installer + portable)
  android/    Capacitor (APK)
```

## 1. Menyiapkan server

Di `server.js` (atau environment):

- `EXAM_CLIENT_SECRET` — kunci HMAC bersama klien. Default
  `ujian-exam-client-v1`. **Ganti di produksi** dan samakan di:
  - `client/windows/config.json` → `clientSecret`
  - `client/android/android/app/src/main/res/values/strings.xml` →
    `exam_client_secret`

Di panel guru, saat membuat/mengedit ujian, pilih
**Wajib Aplikasi Ujian = Ya** bila ujian hanya boleh lewat aplikasi.

## 2. Windows (EXE)

Prasyarat: Node.js 24.

```powershell
cd client/windows
npm install
# ubah config.json: serverUrl, clientSecret, exitPin
npm run dist
```

Hasil di `client/windows/dist/`:

- `Aplikasi-Ujian-Setup-1.0.0.exe` — installer (NSIS, per-machine)
- `Aplikasi-Ujian-Portable-1.0.0.exe` — versi portable

Untuk mencoba tanpa build:

```powershell
npm start
```

### Yang dilakukan aplikasi Windows

- Fullscreen kiosk, tanpa menu, tanpa DevTools.
- `setContentProtection(true)` untuk menolak screen capture window.
- Blokir Alt+Tab, Alt+F4, Win, F11/F12, Ctrl+R/W/T/N/P/S/U, Ctrl+Shift+I/J/C,
  Escape, dan klik kanan.
- Menolak navigasi keluar, jendela baru, unduhan, dan semua izin browser.
- Selalu di atas; fokus dipaksa kembali saat jendela kehilangan fokus.
- Single instance, layar tidak tidur.
- Memindai proses mencurigakan (OBS, TeamViewer, AnyDesk, browser lain,
  Task Manager, VM, dll.) tiap 10 detik.
- PIN pengawas untuk keluar: **Ctrl+Alt+Shift+Q** lalu masukkan `exitPin`.

Konfigurasi bisa ditimpa lewat `config.json` di folder yang sama dengan EXE,
atau di `%PROGRAMDATA%\AplikasiUjian\config.json`.

## 3. Android (APK)

Prasyarat build: JDK 21 + Android SDK (disarankan lewat Android Studio atau
CI GitHub Actions).

```bash
cd client/android
npm install
node scripts/set-server.js http://192.168.1.10:3000
npx cap sync android

# dengan Android Studio:
npx cap open android

# atau CLI:
cd android
./gradlew assembleDebug
```

APK: `client/android/android/app/build/outputs/apk/debug/app-debug.apk`.

Untuk APK rilis bertanda tangan, buat keystore lalu konfigurasikan
`signingConfigs` di `client/android/android/app/build.gradle` (jangan commit
keystore). Untuk uji coba, APK debug sudah bisa dipasang (sideload).

### Yang dilakukan aplikasi Android

- `FLAG_SECURE` — blokir screenshot dan rekaman layar aplikasi.
- Immersive mode — status bar dan navigasi disembunyikan.
- `startLockTask()` — screen pinning dimulai saat ujian dimulai.
- Tombol kembali diblokir; layar selalu menyala.
- Deteksi root, emulator, multi-window, picture-in-picture, USB debugging,
  dan screen recording (Android 15+).
- `window.ExamNative` dipakai halaman untuk menandatangani heartbeat.

Bila perangkat adalah **milik sekolah**, jadikan aplikasi **Device Owner**
lewat `adb`/MDM agar `startLockTask()` benar-benar terkunci dan tidak bisa
keluar. Ini meningkatkan keamanan secara signifikan.

## 4. Build otomatis (GitHub Actions)

Workflow `.github/workflows/build-clients.yml` membangun EXE dan APK.
Jalankan manual dari tab Actions, isi `server_url`, lalu unduh artifact.

## 5. Menaruh berkas unduhan di server

Halaman `/aplikasi` mengambil berkas dari folder `downloads/` di root proyek.
Setelah build, jalankan:

```powershell
.\client\publish.ps1
```

Skrip menyalin EXE installer, portable, dan APK dengan nama yang sudah
dirujuk halaman unduhan (`Aplikasi-Ujian-Setup-1.0.0.exe`,
`Aplikasi-Ujian-Portable-1.0.0.exe`, `Aplikasi-Ujian-1.0.0.apk`).
Folder `downloads/` tidak ikut git.

## 6. Alur ujian

1. Siswa membuka aplikasi, bukan browser.
2. Login seperti biasa.
3. Saat menekan **Mulai Ujian**, aplikasi mengirim bukti HMAC ke server.
4. Server memeriksa tanda tangan, mengikat sesi ke `client_id`, dan menandai
   sesi sebagai `client_secure`.
5. Selama ujian, aplikasi mengirim heartbeat tiap 4 detik berisi kondisi
   perangkat. Server mencatat pelanggaran dan menghentikan ujian bila perlu.
6. Guru melihat kolom **Perangkat** dan **Skor Kepercayaan** di Monitor Sesi.

## 6. Yang perlu disiapkan sekolah

- Ganti `EXAM_CLIENT_SECRET` dan `exitPin` dari nilai default.
- Pasang aplikasi sebelum hari ujian; uji di 2–3 perangkat.
- Pastikan server bisa diakses dari jaringan sekolah.
- Tetap sediakan pengawasan manusia dan desain soal yang tidak mudah dicari.
