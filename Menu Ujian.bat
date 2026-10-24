@echo off
color 0B
title Menu Aplikasi Ujian Online
cd /d "%~dp0"

:menu
cls
echo ============================================================
echo               MENU APLIKASI UJIAN ONLINE
echo ============================================================
echo  1. Mulai Server (Buka di jendela baru)
echo  2. Hentikan Server (Mematikan paksa)
echo  3. Lihat Daftar Email Guru
echo  4. Ganti Sandi Guru
echo  5. Keluar dari Menu
echo ============================================================
set /p pilihan="Ketik nomor menu (1-5) lalu tekan Enter: "

if "%pilihan%"=="1" goto mulai
if "%pilihan%"=="2" goto hentikan
if "%pilihan%"=="3" goto daftar_guru
if "%pilihan%"=="4" goto ganti_sandi
if "%pilihan%"=="5" exit
echo.
echo Pilihan tidak valid. Silakan coba lagi.
timeout /t 2 >nul
goto menu

:mulai
cls
echo Membuka jendela server baru...
echo.
echo PENTING: Jendela server akan terbuka terpisah. 
echo Biarkan jendela server itu terbuka selama ujian.
echo Menu ini bisa Anda gunakan untuk keperluan lain.
echo.
start "SERVER UJIAN - JANGAN DITUTUP" cmd /k "npm start"
timeout /t 2 >nul
goto menu

:hentikan
cls
echo Menghentikan semua proses server (Node.js)...
taskkill /F /IM node.exe /T >nul 2>&1
echo.
echo Server telah dihentikan. Jendela server mungkin masih terbuka, silakan tutup manual.
pause
goto menu

:daftar_guru
cls
node reset-guru.js
echo.
pause
goto menu

:ganti_sandi
cls
echo ============================================================
echo GANTI SANDI GURU
echo ============================================================
echo.
set /p email="Masukkan Email Guru: "
if "%email%"=="" goto ganti_sandi
set /p sandi="Masukkan Sandi Baru (minimal 6 karakter): "
if "%sandi%"=="" goto ganti_sandi
echo.
node reset-guru.js "%email%" "%sandi%"
echo.
pause
goto menu