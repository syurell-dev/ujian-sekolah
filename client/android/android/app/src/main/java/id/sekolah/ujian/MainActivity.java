package id.sekolah.ujian;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Aplikasi Ujian - klien Android.
 *
 * Penguncian yang dipakai:
 *  - FLAG_SECURE: blokir screenshot & screen recording aplikasi ini.
 *  - Immersive mode: sembunyikan status bar & navigasi.
 *  - Screen pinning / lock task: mulai saat ujian dimulai.
 *  - Deteksi root, emulator, multi-window, USB debugging, screen recording.
 *
 * Batas jujur: tanpa Device Owner (perangkat milik sekolah), pengguna masih
 * bisa keluar dari screen pinning dengan gesture + PIN, atau mematikan paksa
 * aplikasi. Semua kondisi itu dilaporkan ke server lewat heartbeat.
 */
public class MainActivity extends BridgeActivity {

    private static final String PREFS = "ujian_client";
    private static final String KEY_ID = "client_id";
    private static final String SECRET_DEFAULT = "ujian-exam-client-v1";

    private boolean screenRecording = false;
    private boolean immersiveActive = false;
    private long lastScreenshotAttempt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        hideSystemUI();
        pasangDeteksiPerekaman();

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setAllowFileAccess(false);
            webView.getSettings().setAllowContentAccess(false);
            webView.getSettings().setMediaPlaybackRequiresUserGesture(true);
            webView.setLongClickable(false);
            webView.setOnLongClickListener(v -> true);
            webView.addJavascriptInterface(new ExamBridge(), "ExamNative");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemUI();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    @Override
    public void onPause() {
        super.onPause();
        // Tetap di layar penuh; jangan biarkan aplikasi "terlihat" keluar.
    }

    @Override
    public void onBackPressed() {
        // Tombol kembali diblokir selama aplikasi ujian berjalan.
        hideSystemUI();
    }

    @Override
    public void onUserLeaveHint() {
        // Tombol Home ditekan. Tidak bisa dicegah, tetapi layar tetap aman.
        super.onUserLeaveHint();
    }

    private void hideSystemUI() {
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            immersiveActive = true;
        } catch (Throwable t) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            immersiveActive = true;
        }
    }

    private void pasangDeteksiPerekaman() {
        if (Build.VERSION.SDK_INT >= 35) {
            try {
                getWindowManager().addScreenRecordingCallback(getMainExecutor(), state -> {
                    screenRecording = (state == WindowManager.SCREEN_RECORDING_STATE_VISIBLE);
                });
            } catch (Throwable ignored) {
            }
        }
    }

    private void mulaiKiosk() {
        runOnUiThread(() -> {
            try {
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null && am.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_NONE) {
                    startLockTask();
                }
            } catch (Throwable ignored) {
            }
            hideSystemUI();
        });
    }

    private boolean kioskAktif() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            return am != null && am.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_LOCKED;
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean usbDebuggingAktif() {
        try {
            return Settings.Global.getInt(getContentResolver(), Settings.Global.ADB_ENABLED, 0) == 1;
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean terdeteksiRoot() {
        String[] paths = {
                "/system/app/Superuser.apk", "/system/xbin/su", "/system/bin/su",
                "/sbin/su", "/data/local/su", "/data/local/xbin/su", "/data/local/bin/su",
                "/system/sd/xbin/su", "/system/bin/failsafe/su", "/su/bin/su"
        };
        for (String p : paths) {
            try {
                if (new File(p).exists()) return true;
            } catch (Throwable ignored) {
            }
        }
        try {
            String tags = Build.TAGS;
            if (tags != null && tags.contains("test-keys")) return true;
        } catch (Throwable ignored) {
        }
        return false;
    }

    private boolean terdeteksiEmulator() {
        try {
            String fp = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT.toLowerCase();
            String model = Build.MODEL == null ? "" : Build.MODEL.toLowerCase();
            String hardware = Build.HARDWARE == null ? "" : Build.HARDWARE.toLowerCase();
            String product = Build.PRODUCT == null ? "" : Build.PRODUCT.toLowerCase();
            return fp.startsWith("generic")
                    || fp.contains("emulator")
                    || fp.contains("vbox")
                    || model.contains("google_sdk")
                    || model.contains("emulator")
                    || model.contains("android sdk built for")
                    || hardware.contains("goldfish")
                    || hardware.contains("ranchu")
                    || hardware.contains("vbox")
                    || product.contains("sdk")
                    || product.contains("emulator");
        } catch (Throwable t) {
            return false;
        }
    }

    private String clientId() {
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = sp.getString(KEY_ID, null);
        if (id != null && id.matches("[A-Za-z0-9_-]{8,128}")) return id;
        id = UUID.randomUUID().toString().replace("-", "");
        sp.edit().putString(KEY_ID, id).apply();
        return id;
    }

    private String secret() {
        try {
            String s = getString(R.string.exam_client_secret);
            if (s != null && !s.trim().isEmpty()) return s.trim();
        } catch (Throwable ignored) {
        }
        return SECRET_DEFAULT;
    }

    private String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret().getBytes("UTF-8"), "HmacSHA256"));
            byte[] hasil = mac.doFinal(payload.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(hasil.length * 2);
            for (byte b : hasil) {
                String h = Integer.toHexString(b & 0xff);
                if (h.length() == 1) sb.append('0');
                sb.append(h);
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    private String stateJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("platform", "android");
            o.put("version", BuildConfig.VERSION_NAME);
            o.put("fullscreen", immersiveActive);
            o.put("focused", hasWindowFocus());
            o.put("lock_task", kioskAktif());
            o.put("screen_protected", true);
            o.put("multi_window", isInMultiWindowMode());
            o.put("pip", isInPictureInPictureMode());
            o.put("usb_debugging", usbDebuggingAktif());
            o.put("screen_recording", screenRecording);
            o.put("rooted", terdeteksiRoot());
            o.put("emulator", terdeteksiEmulator());
            o.put("screenshot_attempt", (System.currentTimeMillis() - lastScreenshotAttempt) < 15000);
            o.put("suspicious", new JSONArray());
        } catch (Throwable ignored) {
        }
        return o.toString();
    }

    /** Jembatan JavaScript yang tersedia di halaman ujian sebagai window.ExamNative. */
    private class ExamBridge {
        @JavascriptInterface
        public String getPlatform() {
            return "android";
        }

        @JavascriptInterface
        public String getVersion() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public String getId() {
            return clientId();
        }

        @JavascriptInterface
        public String sign(String payload) {
            return MainActivity.this.sign(payload == null ? "" : payload);
        }

        @JavascriptInterface
        public String getState() {
            return stateJson();
        }

        @JavascriptInterface
        public void startKiosk() {
            mulaiKiosk();
        }

        @JavascriptInterface
        public void requestFullscreen() {
            runOnUiThread(() -> hideSystemUI());
        }

        @JavascriptInterface
        public void notifyScreenshotAttempt() {
            lastScreenshotAttempt = System.currentTimeMillis();
        }
    }
}
