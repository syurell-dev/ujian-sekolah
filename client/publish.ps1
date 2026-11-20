# Menyalin hasil build klien ke folder downloads/ milik server.
# Jalankan dari mana saja:  .\client\publish.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'downloads'
New-Item -ItemType Directory -Force -Path $target | Out-Null

$pairs = @(
  @{ From = Join-Path $PSScriptRoot 'windows\dist\Aplikasi-Ujian-Setup-1.0.0.exe'; To = 'Aplikasi-Ujian-Setup-1.0.0.exe' },
  @{ From = Join-Path $PSScriptRoot 'windows\dist\Aplikasi-Ujian-1.0.0-x64.exe';      To = 'Aplikasi-Ujian-Setup-1.0.0.exe' },
  @{ From = Join-Path $PSScriptRoot 'windows\dist\Aplikasi-Ujian-Portable-1.0.0.exe'; To = 'Aplikasi-Ujian-Portable-1.0.0.exe' },
  @{ From = Join-Path $PSScriptRoot 'android\android\app\build\outputs\apk\debug\app-debug.apk'; To = 'Aplikasi-Ujian-1.0.0.apk' },
  @{ From = Join-Path $PSScriptRoot 'android\android\Aplikasi-Ujian-1.0.0.apk'; To = 'Aplikasi-Ujian-1.0.0.apk' }
)

$copied = 0
foreach ($p in $pairs) {
  if (-not (Test-Path $p.From)) { continue }
  $dest = Join-Path $target $p.To
  Copy-Item -Path $p.From -Destination $dest -Force
  $mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
  Write-Host "OK  $($p.To)  ($mb MB)"
  $copied++
}

if ($copied -eq 0) {
  Write-Host 'Tidak ada berkas build. Jalankan dulu:'
  Write-Host '  cd client/windows ; npm run dist'
  Write-Host '  cd client/android/android ; ./gradlew assembleDebug'
  exit 1
}

Write-Host ''
Write-Host "Selesai. Halaman unduhan: http://<server>:3000/aplikasi"
