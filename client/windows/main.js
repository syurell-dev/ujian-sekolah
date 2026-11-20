/**
 * Aplikasi Ujian - Klien Windows
 * ------------------------------------------------------------
 * Mode kiosk untuk ujian berbasis web di jaringan sekolah.
 * Catatan jujur: penguncian ini berjalan sebagai aplikasi biasa.
 * Siswa yang memegang hak admin tetap bisa menghentikan proses,
 * memakai VM, atau membuka perangkat lain. Server tetap mencatat
 * setiap pelanggaran dan melakukan autosubmit.
 */

'use strict';

const { app, BrowserWindow, Menu, session, screen, powerSaveBlocker, ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULTS = {
  serverUrl: 'http://localhost:3000',
  clientSecret: 'ujian-exam-client-v1',
  exitPin: '2468',
  allowExit: true,
  scanProcesses: true
};

const BLOCKLIST = [
  'obs.exe', 'obs32.exe', 'obs64.exe', 'obs-browser-page.exe',
  'bandicam.exe', 'bdcam.exe', 'camtasia.exe', 'camtasiastudio.exe',
  'teamviewer.exe', 'teamviewer_service.exe', 'anydesk.exe', 'vncviewer.exe',
  'mstsc.exe', 'rustdesk.exe', 'parsec.exe', 'sunloginclient.exe',
  'vmware-vmx.exe', 'vmware.exe', 'virtualbox.exe', 'vboxservice.exe', 'qemu-ga.exe',
  'wireshark.exe', 'fiddler.exe', 'charles.exe', 'mitmproxy.exe',
  'discord.exe', 'telegram.exe', 'whatsapp.exe', 'zoom.exe', 'skype.exe',
  'msedge.exe', 'chrome.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe',
  'taskmgr.exe', 'procexp.exe', 'procexp64.exe', 'processhacker.exe', 'systeminformer.exe',
  'regedit.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'wt.exe',
  'cheatengine.exe', 'cheatengine-x86_64.exe', 'artmoney.exe'
];

const VM_PROCESSES = ['vmtoolsd.exe', 'vboxservice.exe', 'vboxguest.exe', 'qemu-ga.exe', 'prl_tools.exe'];

// Proses yang sudah berjalan sebelum aplikasi dibuka dianggap latar belakang
// (mis. Edge startup boost, layanan VirtualBox). Hanya proses BARU yang
// dilaporkan, supaya tidak terjadi pelanggaran palsu saat ujian dimulai.
const baselinePid = new Set();
let baselineSelesai = false;

let config = Object.assign({}, DEFAULTS);
let mainWindow = null;
let quitting = false;
let powerBlockerId = null;
let clientId = null;
let suspicious = new Set();
let vmDetected = false;
let lastScan = 0;

function loadConfig() {
  const kandidat = [
    path.join(__dirname, 'config.json'),
    path.join(path.dirname(process.execPath), 'config.json'),
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'AplikasiUjian', 'config.json')
  ];
  for (const file of kandidat) {
    try {
      if (!fs.existsSync(file)) continue;
      const isi = JSON.parse(fs.readFileSync(file, 'utf8'));
      config = Object.assign({}, config, isi);
      console.log('[KONFIG] Memakai ' + file);
    } catch (e) {
      console.error('[KONFIG] Gagal membaca ' + file + ': ' + e.message);
    }
  }
  config.serverUrl = String(config.serverUrl || DEFAULTS.serverUrl).replace(/\/+$/, '');
}

function loadClientId() {
  const file = path.join(app.getPath('userData'), 'client.json');
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && data.clientId && /^[A-Za-z0-9_-]{8,128}$/.test(data.clientId)) return data.clientId;
    }
  } catch (_) {}
  const id = crypto.randomUUID().replace(/-/g, '');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ clientId: id, dibuat: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.error('[KLIEN] Gagal menyimpan ID: ' + e.message);
  }
  return id;
}

function sign(payload) {
  return crypto.createHmac('sha256', String(config.clientSecret || DEFAULTS.clientSecret))
    .update(String(payload)).digest('hex');
}

function scanProcesses() {
  if (!config.scanProcesses) return;
  if (Date.now() - lastScan < 8000) return;
  lastScan = Date.now();
  execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
    if (err || !stdout) return;
    const entries = [];
    let vm = false;
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (!m) continue;
      const nama = m[1].toLowerCase();
      const pid = m[2];
      const kunci = nama + '|' + pid;
      entries.push({ nama, kunci });
      if (VM_PROCESSES.includes(nama)) vm = true;
    }

    if (!baselineSelesai) {
      for (const e of entries) baselinePid.add(e.kunci);
      baselineSelesai = true;
      return;
    }

    const found = new Set();
    for (const e of entries) {
      if (!BLOCKLIST.includes(e.nama)) continue;
      if (baselinePid.has(e.kunci)) continue;
      found.add(e.nama);
    }
    suspicious = found;
    vmDetected = vm;
  });
}

function isRemoteSession() {
  const s = String(process.env.SESSIONNAME || '').toUpperCase();
  return s.startsWith('RDP-') || s.includes('RDP');
}

function clientState() {
  let fullscreen = false;
  let focused = false;
  let kiosk = false;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      fullscreen = mainWindow.isFullScreen();
      focused = mainWindow.isFocused();
      kiosk = mainWindow.isKiosk();
    }
  } catch (_) {}
  const displays = screen.getAllDisplays();
  return {
    platform: 'windows',
    version: app.getVersion(),
    fullscreen,
    focused,
    kiosk,
    screen_protected: true,
    multi_monitor: displays.length > 1,
    remote_session: isRemoteSession(),
    vm: vmDetected,
    devtools: false,
    suspicious: Array.from(suspicious),
    displays: displays.length
  };
}

function installSecurityGuards() {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => {
      event.preventDefault();
    });
  });

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
}

function blockShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '');
    const ctrl = input.control;
    const alt = input.alt;
    const shift = input.shift;
    const meta = input.meta;

    // PIN keluar untuk pengawas
    if (ctrl && alt && shift && key.toLowerCase() === 'q') {
      event.preventDefault();
      mintaPinKeluar();
      return;
    }

    const dilarang =
      key === 'F11' || key === 'F12' ||
      (ctrl && shift && ['I', 'J', 'C'].includes(key.toUpperCase())) ||
      (ctrl && ['R', 'W', 'T', 'N', 'P', 'S', 'U', 'O', 'F', 'G', 'H', 'J'].includes(key.toUpperCase())) ||
      (alt && ['Tab', 'F4', 'Esc'].includes(key)) ||
      (meta && ['r', 'w', 't', 'n'].includes(key.toLowerCase())) ||
      key === 'Escape' ||
      (ctrl && alt && key === 'Delete');

    if (dilarang) {
      event.preventDefault();
      if (key === 'Escape' && mainWindow && !mainWindow.isKiosk()) mainWindow.setKiosk(true);
    }
    if (ctrl && alt && key === 'Delete') {
      // Ctrl+Alt+Del tidak bisa dicegah oleh aplikasi; dicatat oleh server.
    }
  });
}

async function mintaPinKeluar() {
  if (!config.allowExit) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const jawab = await mainWindow.webContents.executeJavaScript(
      "window.prompt('PIN pengawas untuk keluar dari mode ujian:')", true
    );
    if (jawab && String(jawab) === String(config.exitPin || DEFAULTS.exitPin)) {
      quitting = true;
      app.quit();
    } else if (jawab) {
      dialog.showMessageBox(mainWindow, { type: 'error', message: 'PIN salah.', buttons: ['OK'] });
    }
  } catch (_) {}
}

function createWindow() {
  const target = config.serverUrl + (config.serverUrl.includes('?') ? '&' : '?') +
    'client=windows&v=' + encodeURIComponent(app.getVersion());

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    kiosk: true,
    fullscreen: true,
    autoHideMenuBar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      spellcheck: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false
    }
  });

  Menu.setApplicationMenu(null);
  try { mainWindow.setContentProtection(true); } catch (_) {}
  try { mainWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  try { mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}

  const primary = screen.getPrimaryDisplay().bounds;
  mainWindow.setBounds(primary);
  mainWindow.loadURL(target);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setKiosk(true);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setKiosk(true);
    mainWindow.focus();
  });

  mainWindow.webContents.on('render-process-gone', () => {
    setTimeout(() => { if (!quitting) mainWindow.reload(); }, 1500);
  });

  mainWindow.webContents.on('unresponsive', () => {
    setTimeout(() => { if (!quitting && mainWindow) mainWindow.reload(); }, 2000);
  });

  blockShortcuts(mainWindow.webContents);

  mainWindow.on('blur', () => {
    if (quitting) return;
    setTimeout(() => {
      if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.show();
      mainWindow.focus();
    }, 200);
  });

  mainWindow.on('minimize', (e) => { e.preventDefault(); mainWindow.restore(); mainWindow.focus(); });
  mainWindow.on('hide', () => { if (!quitting) { mainWindow.show(); mainWindow.focus(); } });
  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWindow.show();
    mainWindow.focus();
  });

  const cekLayar = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (screen.getAllDisplays().length > 1) {
      mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
    }
  };
  screen.on('display-added', cekLayar);
  screen.on('display-removed', cekLayar);
  screen.on('display-metrics-changed', cekLayar);

  setInterval(scanProcesses, 10000);
  scanProcesses();
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    loadConfig();
    clientId = loadClientId();
    installSecurityGuards();

    ipcMain.on('client:info', (event) => {
      event.returnValue = {
        platform: 'windows',
        version: app.getVersion(),
        clientId
      };
    });
    ipcMain.handle('client:sign', (_e, payload) => sign(payload));
    ipcMain.handle('client:state', () => clientState());
    ipcMain.handle('client:exit', () => { mintaPinKeluar(); return true; });

    try { powerBlockerId = powerSaveBlocker.start('prevent-display-sleep'); } catch (_) {}
    createWindow();
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* kiosk: jangan keluar otomatis */ });
  app.on('will-quit', () => {
    if (powerBlockerId != null) { try { powerSaveBlocker.stop(powerBlockerId); } catch (_) {} }
  });
}

main();
