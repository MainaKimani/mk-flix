package com.w2a.um1c;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;

/**
 * In-app updates for the sideloaded APK.
 *
 * Every release publishes a manifest, releases.json, next to the downloads
 * (https://blendy.mainakimani.com/downloads/), with a detached ECDSA P-256
 * signature in releases.json.sig. A manifest is trusted only if that
 * signature checks out against MANIFEST_PUBLIC_KEY, whose private half never
 * leaves the release machine, so a hacked web server can't push a fake
 * update. For "android" it gives the latest version, the oldest version
 * still allowed to run (minimum_version) and the APK with its size and
 * SHA-256.
 *
 * The APK is downloaded to the app's cache, checked against that SHA-256,
 * against this app's package name and against this app's own signing
 * certificate, then handed to PackageInstaller. Android always asks the
 * user to confirm the install, and the first time also asks them to allow
 * Blendy Play to install apps.
 *
 * check() and download() block, so they run on a background thread.
 */
final class AppUpdater {
    static final String DEFAULT_MANIFEST_URL = "https://blendy.mainakimani.com/downloads/releases.json";
    private static final String MANIFEST_PUBLIC_KEY =
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGReuWJqg+LRrNCaBNKlzg1yascNT"
                    + "AW5xgCmrMAMb9cF8lTk2WzdSCyxXdF5JLoXw5u18PCE2AK/TxRPYUgssEw==";
    private static final String PREFS = "mkflix_update";
    // How long "Later" hides an optional update for.
    private static final long LATER_MS = 24L * 60 * 60 * 1000;
    static final String ACTION_INSTALL_STATUS = "com.mainakimani.blendyplay.INSTALL_STATUS";

    interface Progress {
        void onProgress(long received, long total);
    }

    /** Where install() ended up: the gate turns this into a message. */
    enum InstallStep { PROMPT, PERMISSION }

    private final Activity activity;
    private final String manifestUrl;
    private JSONObject latest;   // the "android" entry from the last check
    private String latestUrl;    // absolute URL of its APK

    AppUpdater(Activity activity, String manifestUrl) {
        this.activity = activity;
        this.manifestUrl = manifestUrl == null || manifestUrl.isEmpty() ? DEFAULT_MANIFEST_URL : manifestUrl;
    }

    String currentVersion() {
        try {
            return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    /** -1, 0 or 1, comparing dotted numeric versions ("1.10.0" > "1.9.2"). */
    static int compareVersions(String a, String b) {
        String[] pa = String.valueOf(a).split("[.-]");
        String[] pb = String.valueOf(b).split("[.-]");
        for (int i = 0; i < Math.max(Math.max(pa.length, pb.length), 3); i++) {
            int x = i < pa.length ? parseIntOrZero(pa[i]) : 0;
            int y = i < pb.length ? parseIntOrZero(pb[i]) : 0;
            if (x != y) {
                return x > y ? 1 : -1;
            }
        }
        return 0;
    }

    private static int parseIntOrZero(String s) {
        try {
            return Integer.parseInt(s.replaceAll("\\D.*", ""));
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * Ask the release server whether there's a newer version. Returns
     * {status: none | optional | required, ...} in the same shape as the
     * desktop app, or throws if the manifest can't be fetched or verified.
     */
    JSONObject check() throws Exception {
        byte[] body = get(manifestUrl, 8000);
        byte[] sig = Base64.decode(new String(get(manifestUrl + ".sig", 8000), "UTF-8").trim(), Base64.DEFAULT);
        PublicKey key = KeyFactory.getInstance("EC").generatePublic(
                new X509EncodedKeySpec(Base64.decode(MANIFEST_PUBLIC_KEY, Base64.DEFAULT)));
        java.security.Signature verifier = java.security.Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(key);
        verifier.update(body);
        if (!verifier.verify(sig)) {
            throw new SecurityException("The release manifest signature is not valid");
        }

        JSONObject data = new JSONObject(new String(body, "UTF-8"));
        JSONObject platforms = data.optJSONObject("platforms");
        JSONObject entry = platforms == null ? null : platforms.optJSONObject("android");
        String current = currentVersion();
        JSONObject state = new JSONObject().put("current", current).put("platform", "android");
        if (entry == null || entry.optString("file").isEmpty() || entry.optString("sha256").isEmpty()
                || compareVersions(entry.optString("version"), current) <= 0) {
            latest = null;
            return state.put("status", "none");
        }
        latest = entry;
        latestUrl = new URL(new URL(manifestUrl), entry.getString("file")).toString();
        String minimum = entry.isNull("minimum_version") ? "" : entry.optString("minimum_version", "");
        boolean required = !minimum.isEmpty() && compareVersions(current, minimum) < 0;
        String version = entry.getString("version");
        return state
                .put("status", required ? "required" : "optional")
                .put("version", version)
                .put("minimum", minimum.isEmpty() ? JSONObject.NULL : minimum)
                .put("notes", data.optJSONArray("notes") == null ? new JSONArray() : data.optJSONArray("notes"))
                .put("size", entry.optLong("size", 0))
                .put("install", "android")
                .put("dismissed", !required && isDismissed(version));
    }

    /** Download the update found by the last check() and verify it. */
    File download(Progress progress) throws Exception {
        if (latest == null) {
            throw new IllegalStateException("No update to download");
        }
        File dir = new File(activity.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new IllegalStateException("Can't save the update");
        }
        String name = Uri.parse(latestUrl).getLastPathSegment();
        File apk = new File(dir, name == null ? "update.apk" : name);
        String expected = latest.getString("sha256").toLowerCase();
        long size = latest.optLong("size", 0);
        // Already downloaded (e.g. the user went to allow installs and came back).
        if (apk.isFile() && expected.equals(sha256(apk))) {
            verifyApk(apk);
            return apk;
        }
        File part = new File(dir, apk.getName() + ".part");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        HttpURLConnection conn = open(latestUrl, 30000);
        long total = conn.getContentLength() > 0 ? conn.getContentLength() : size;
        long received = 0;
        try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            long lastReport = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                digest.update(buf, 0, n);
                received += n;
                long now = System.currentTimeMillis();
                if (progress != null && (now - lastReport > 150 || received == total)) {
                    lastReport = now;
                    progress.onProgress(received, total);
                }
            }
        } finally {
            conn.disconnect();
        }
        if (!expected.equals(hex(digest.digest())) || (size > 0 && received != size)) {
            part.delete();
            throw new SecurityException("The download is damaged or has been changed. Try again.");
        }
        if (!part.renameTo(apk)) {
            throw new IllegalStateException("Can't save the update");
        }
        verifyApk(apk);
        return apk;
    }

    /** The APK must be this app, newer, and signed with this app's own key. */
    @SuppressWarnings("deprecation")
    private void verifyApk(File apk) throws Exception {
        PackageManager pm = activity.getPackageManager();
        PackageInfo update = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNATURES);
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES);
        if (update == null || !activity.getPackageName().equals(update.packageName)) {
            throw new SecurityException("The download isn't a Blendy Play update");
        }
        if (update.versionCode <= installed.versionCode) {
            throw new SecurityException("The download isn't newer than this version");
        }
        if (!sameSigners(update.signatures, installed.signatures)) {
            throw new SecurityException("The update isn't signed by Blendy Play");
        }
    }

    private static boolean sameSigners(Signature[] a, Signature[] b) {
        if (a == null || b == null || a.length == 0 || a.length != b.length) {
            return false;
        }
        String[] x = new String[a.length];
        String[] y = new String[b.length];
        for (int i = 0; i < a.length; i++) {
            x[i] = a[i].toCharsString();
            y[i] = b[i].toCharsString();
        }
        Arrays.sort(x);
        Arrays.sort(y);
        return Arrays.equals(x, y);
    }

    /**
     * Hand the APK to Android's installer. Returns PERMISSION if Blendy Play
     * first needs to be allowed to install apps (the settings screen is
     * opened); otherwise the install confirmation follows via the
     * ACTION_INSTALL_STATUS broadcast (see installStatusReceiver).
     */
    InstallStep install(File apk) throws Exception {
        PackageManager pm = activity.getPackageManager();
        if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName()));
            try {
                activity.startActivity(settings);
            } catch (Exception e) {
                activity.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
            }
            return InstallStep.PERMISSION;
        }
        PackageInstaller installer = pm.getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(activity.getPackageName());
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(apk);
                 OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
                session.fsync(out);
            }
            Intent status = new Intent(ACTION_INSTALL_STATUS).setPackage(activity.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) {
                flags |= PendingIntent.FLAG_MUTABLE; // the installer adds the status extras
            }
            PendingIntent pending = PendingIntent.getBroadcast(activity, sessionId, status, flags);
            session.commit(pending.getIntentSender());
        }
        return InstallStep.PROMPT;
    }

    /**
     * Receives the installer's answers: shows Android's confirmation screen
     * when it asks for the user, and reports failures to `onFailure`. On
     * success Android replaces and restarts the app, so nothing more happens.
     */
    static BroadcastReceiver installStatusReceiver(final Activity activity, final java.util.function.Consumer<String> onFailure) {
        return new BroadcastReceiver() {
            @Override
            @SuppressWarnings("deprecation")
            public void onReceive(Context context, Intent intent) {
                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(confirm);
                    }
                } else if (status != PackageInstaller.STATUS_SUCCESS) {
                    String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                    onFailure.accept(status == PackageInstaller.STATUS_FAILURE_ABORTED
                            ? "The update was cancelled."
                            : "The update couldn't be installed" + (message == null ? "." : ": " + message));
                }
            }
        };
    }

    static IntentFilter installStatusFilter() {
        return new IntentFilter(ACTION_INSTALL_STATUS);
    }

    /** Hide the optional update to `version` for a day. */
    void dismiss(String version) {
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("dismissedVersion", version)
                .putLong("dismissedAt", System.currentTimeMillis())
                .apply();
    }

    private boolean isDismissed(String version) {
        SharedPreferences p = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return version.equals(p.getString("dismissedVersion", ""))
                && System.currentTimeMillis() - p.getLong("dismissedAt", 0) < LATER_MS;
    }

    /** The product page's downloads section, for when the app can't update itself. */
    String downloadsPage() {
        try {
            return new URL(new URL(manifestUrl), "/#download").toString();
        } catch (Exception e) {
            return "https://blendy.mainakimani.com/#download";
        }
    }

    // Plain http is accepted only for a local test server (adb reverse).
    private static HttpURLConnection open(String url, int timeoutMs) throws Exception {
        URL u = new URL(url);
        boolean local = "localhost".equals(u.getHost()) || "127.0.0.1".equals(u.getHost());
        if (!"https".equals(u.getProtocol()) && !("http".equals(u.getProtocol()) && local)) {
            throw new SecurityException("Refusing to download updates from " + u.getHost());
        }
        HttpURLConnection conn = (HttpURLConnection) u.openConnection();
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        conn.setUseCaches(false);
        conn.setRequestProperty("Cache-Control", "no-cache");
        if (conn.getResponseCode() != 200) {
            int code = conn.getResponseCode();
            conn.disconnect();
            throw new IllegalStateException("HTTP " + code + " for " + url);
        }
        return conn;
    }

    private static byte[] get(String url, int timeoutMs) throws Exception {
        HttpURLConnection conn = open(url, timeoutMs);
        try (InputStream in = conn.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } finally {
            conn.disconnect();
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                digest.update(buf, 0, n);
            }
        }
        return hex(digest.digest());
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
