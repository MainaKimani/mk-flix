package com.blendystudio.mkflix;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.window.OnBackInvokedDispatcher;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.SslErrorHandler;
import android.webkit.WebBackForwardList;
import android.webkit.WebResourceError;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {

    private static final String HOME_URL = "https://cinejoy.pk/";
    // Shown instead of a failed page; see showErrorPage().
    private static final String ERROR_PAGE = "file:///android_asset/error.html";

    // Page currently being opened, to tell a page's own SSL failure from a
    // failing image or ad on it (onReceivedSslError doesn't say which).
    private String loadingUrl;
    // Page whose SSL failure is already on screen, so the follow-up generic
    // error for the same page doesn't replace the more specific message.
    private String sslFailedUrl;
    // Page the error screen is showing a failure for; Back skips over it.
    private String errorPageFailedUrl;

    private WebView webView;
    private FrameLayout fullscreenContainer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    // Kept here because WebView.getWebChromeClient() only exists from API 26.
    private WebChromeClient chromeClient;
    // Orientation to return to when fullscreen video ends.
    private int orientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    // Download waiting on the storage permission (Android 7–9 only).
    private DownloadManager.Request pendingDownload;
    private final Set<String> adHosts = new HashSet<>();
    // MK-Flix branding on cinejoy.pk, shared with the desktop app:
    // - logoJs adds assets/mkflix-logo.css, which draws the MK-Flix icon in
    //   place of the site's header logo. It runs as soon as a page is about to
    //   become visible, so the old logo doesn't show first.
    // - footerJs (assets/mkflix-footer.js) replaces the site's footer once
    //   the page has loaded.
    private String logoJs = "";
    private String footerJs = "";

    private static final int REQUEST_STORAGE_PERMISSION = 1;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        loadAdBlockList();

        // Back on Android 13+ (see onBackPressed for older versions).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        footerJs = readAsset("mkflix-footer.js");
        String logoCss = readAsset("mkflix-logo.css");
        if (!logoCss.isEmpty()) {
            // JSONObject.quote turns the CSS into a safe JavaScript string literal.
            logoJs = "(function(){if(document.getElementById('mkflix-logo-style'))return;"
                    + "var s=document.createElement('style');s.id='mkflix-logo-style';"
                    + "s.textContent=" + JSONObject.quote(logoCss) + ";"
                    + "(document.head||document.documentElement).appendChild(s);})()";
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        // A secure (https) page may not load insecure (http) content. The
        // manifest already blocks cleartext traffic, so this mostly makes the
        // rule explicit; ALWAYS_ALLOW is a red flag for app scanners.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (isAdHost(request.getUrl().toString())) {
                    return emptyResponse();
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                if (isAdHost(url)) {
                    return emptyResponse();
                }
                return super.shouldInterceptRequest(view, url);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (isWebUrl(url)) {
                    loadingUrl = url;
                }
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                if (isWebUrl(url)) {
                    sslFailedUrl = null; // this page made it, so any earlier SSL failure is stale
                }
                // Earliest point the new page can take a script, before it is drawn.
                if (!logoJs.isEmpty() && isCineJoyUrl(url)) {
                    view.evaluateJavascript(logoJs, null);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                String url = request.getUrl().toString();
                String desc = String.valueOf(error.getDescription());
                // Only whole-page failures, not a broken image or ad. ERR_ABORTED
                // isn't a failure (a redirect, or the user moved on). An SSL
                // failure already showed its own, more specific error screen.
                if (!request.isForMainFrame() || !isWebUrl(url)
                        || desc.contains("ERR_ABORTED") || sameUrl(url, sslFailedUrl)) {
                    return;
                }
                showErrorPage(url, error.getErrorCode(), desc);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Never load a page with a bad certificate (the default too).
                handler.cancel();
                // This callback doesn't say which frame failed. Treat it as a
                // page failure only when it's the page being opened, so one
                // blocked image or ad can't replace a working page. Networks
                // that intercept HTTPS (e.g. office firewalls) land here.
                if (sameUrl(error.getUrl(), loadingUrl)) {
                    sslFailedUrl = error.getUrl();
                    showErrorPage(error.getUrl(), -200, sslErrorName(error.getPrimaryError()));
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                try {
                    view.evaluateJavascript(adCleanupJs(), null);
                    if (isCineJoyUrl(url)) {
                        // Logo again in case commit-visible was skipped; it
                        // checks its own id, so running twice is harmless.
                        if (!logoJs.isEmpty()) {
                            view.evaluateJavascript(logoJs, null);
                        }
                        if (!footerJs.isEmpty()) {
                            view.evaluateJavascript(footerJs, null);
                        }
                    }
                } catch (Exception ignored) {
                }
            }
        });

        chromeClient = new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;

                fullscreenContainer = new FrameLayout(MainActivity.this);
                fullscreenContainer.setBackgroundColor(0xFF000000);
                fullscreenContainer.addView(view,
                        new FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT));

                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                decor.addView(fullscreenContainer,
                        new FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT));

                webView.setVisibility(View.GONE);
                hideSystemUi();
                orientationBeforeFullscreen = getRequestedOrientation();
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) {
                    return;
                }
                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                decor.removeView(fullscreenContainer);
                fullscreenContainer = null;
                customView = null;
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                }
                webView.setVisibility(View.VISIBLE);
                showSystemUi();
                setRequestedOrientation(orientationBeforeFullscreen);
            }
        };
        webView.setWebChromeClient(chromeClient);

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                                        String contentDisposition, String mimeType,
                                        long contentLength) {
                try {
                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setMimeType(mimeType);
                    request.addRequestHeader("User-Agent", userAgent);
                    // DownloadManager doesn't share the WebView's cookie jar, so
                    // pass the session cookies along or logged-in downloads fail.
                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) {
                        request.addRequestHeader("Cookie", cookies);
                    }
                    request.setTitle(fileName);
                    request.setDescription("Downloading file");
                    request.allowScanningByMediaScanner();
                    request.setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS, fileName);

                    if (needsStoragePermission()) {
                        pendingDownload = request;
                        requestPermissions(
                                new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                                REQUEST_STORAGE_PERMISSION);
                    } else {
                        enqueueDownload(request);
                    }
                } catch (Exception e) {
                    Toast.makeText(getApplicationContext(),
                            "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            loadingUrl = HOME_URL;
            webView.loadUrl(HOME_URL);
        }
    }

    /**
     * Writing to the public Downloads folder needs a runtime permission on
     * Android 7–9. From Android 10 DownloadManager can write there without it.
     */
    private boolean needsStoragePermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED;
    }

    private void enqueueDownload(DownloadManager.Request request) {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(request);
                Toast.makeText(getApplicationContext(),
                        "Download started", Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Toast.makeText(getApplicationContext(),
                    "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_STORAGE_PERMISSION || pendingDownload == null) {
            return;
        }
        DownloadManager.Request request = pendingDownload;
        pendingDownload = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            enqueueDownload(request);
        } else {
            Toast.makeText(getApplicationContext(),
                    "Storage permission is needed to download files", Toast.LENGTH_LONG).show();
        }
    }

    private static boolean isCineJoyUrl(String url) {
        String host = url == null ? null : Uri.parse(url).getHost();
        return host != null && (host.equals("cinejoy.pk") || host.endsWith(".cinejoy.pk"));
    }

    /** Read a text file shipped in assets, or "" if it can't be read. */
    private String readAsset(String name) {
        try (InputStream is = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    /** Load the ad/tracker host blocklist shipped in assets. */
    private void loadAdBlockList() {
        try (InputStream is = getAssets().open("adblock-hosts.txt");
             BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
            String line;
            while ((line = br.readLine()) != null) {
                line = line.trim().toLowerCase(Locale.ROOT);
                if (!line.isEmpty() && !line.startsWith("#")) {
                    adHosts.add(line);
                }
            }
        } catch (Exception ignored) {
        }
    }

    /** Fast subdomain-aware check: walks up the host labels doing HashSet lookups. */
    private boolean isAdHost(String url) {
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) {
                return false;
            }
            // Locale.ROOT: in e.g. Turkish, "I".toLowerCase() is a dotless ı.
            String domain = host.toLowerCase(Locale.ROOT);
            while (true) {
                if (adHosts.contains(domain)) {
                    return true;
                }
                int dot = domain.indexOf('.');
                if (dot < 0) {
                    return false;
                }
                domain = domain.substring(dot + 1);
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    /**
     * Blocked requests fail with 404 (like DNS-level blocking) instead of an
     * empty 200, so the page's scripts take their normal "resource failed"
     * path instead of choking on a bogus success.
     */
    private WebResourceResponse emptyResponse() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                Collections.<String, String>emptyMap(),
                new ByteArrayInputStream(new byte[0]));
    }

    /**
     * Cosmetic cleanup: remove ad iframes/embeds served from blocked hosts so
     * invisible ad containers can't sit over the page and swallow taps/swipes.
     */
    private String adCleanupJs() {
        StringBuilder sb = new StringBuilder();
        sb.append("(function(){var H=[");
        boolean first = true;
        for (String h : adHosts) {
            if (!first) {
                sb.append(',');
            }
            sb.append('\'').append(h).append('\'');
            first = false;
        }
        sb.append("];function bad(u){u=(u||'').toLowerCase();");
        sb.append("for(var i=0;i<H.length;i++){if(u.indexOf(H[i])>=0)return true;}return false;}");
        sb.append("function clean(){var q=document.querySelectorAll('iframe,frame,embed,object');");
        sb.append("for(var i=0;i<q.length;i++){try{if(bad(q[i].src))q[i].remove();}catch(e){}}}");
        sb.append("clean();setTimeout(clean,2000);})()");
        return sb.toString();
    }

    /**
     * Route non-web URLs (intent://, market://, tel:, ...) to an external app
     * when one can handle them; otherwise swallow them so the WebView never
     * shows an ERR_UNKNOWN_URL_SCHEME page.
     *
     * Intents built from a web page are untrusted, so they are limited to
     * what a browser could open: BROWSABLE activities only, with any explicit
     * component or selector stripped. Without this a page could launch
     * arbitrary exported activities in other apps.
     */
    private boolean handleUrl(String url) {
        if (url == null) {
            return true;
        }
        if (isWebUrl(url)) {
            loadingUrl = url; // before onPageStarted, which a fast SSL failure can beat
            return false; // load in the WebView
        }
        Intent intent;
        try {
            if (url.startsWith("intent:")) {
                intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            }
        } catch (Exception e) {
            return true;
        }
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setComponent(null);
        intent.setSelector(null);

        // Attempt the launch instead of checking resolveActivity() first: on
        // Android 11+ package visibility rules make resolveActivity() return
        // null for most apps unless they are declared in <queries>.
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            // No app installed: honour the page's web fallback if it gave one.
            String fallback = intent.getStringExtra("browser_fallback_url");
            if (fallback != null
                    && (fallback.startsWith("https://") || fallback.startsWith("http://"))) {
                webView.loadUrl(fallback);
            }
        } catch (Exception ignored) {
        }
        return true; // consumed
    }

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        int flags = View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        decor.setSystemUiVisibility(flags);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }

    private void showSystemUi() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }

    /**
     * Back before Android 13. From 13 on, Back arrives through the
     * OnBackInvokedCallback registered in onCreate instead; apps targeting
     * Android 16 no longer get this call there at all.
     */
    // Lint's GestureBackNavigation flags any onBackPressed override. Here it
    // only runs below Android 13; 13+ uses the callback lint asks for.
    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (customView != null) {
            // Exit fullscreen video first
            chromeClient.onHideCustomView();
        } else if (webView != null && isErrorPage(webView.getUrl())) {
            backFromErrorPage();
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            leaveApp();
        }
    }

    /**
     * Nothing left to go back to. On Android 13+ our back callback has taken
     * over Back, so do what the system would: since Android 12, Back on an
     * app's root screen sends it to the background rather than closing it.
     */
    @SuppressWarnings("deprecation")
    private void leaveApp() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            moveTaskToBack(true);
        } else {
            super.onBackPressed();
        }
    }

    /**
     * Back from the error screen goes to the last page that worked. The
     * history behind it holds the failed page (going there would just fail
     * again) and possibly earlier error screens, so skip those; if nothing
     * else is left, leave the app.
     */
    private void backFromErrorPage() {
        WebBackForwardList history = webView.copyBackForwardList();
        int current = history.getCurrentIndex();
        for (int i = current - 1; i >= 0; i--) {
            String url = history.getItemAtIndex(i).getUrl();
            if (!isErrorPage(url) && !sameUrl(url, errorPageFailedUrl)) {
                webView.goBackOrForward(i - current);
                return;
            }
        }
        leaveApp();
    }

    /**
     * Replace a failed page with assets/error.html (shared with the desktop
     * app), which explains the likely cause and offers Retry. The error's
     * name (net::ERR_...) is what the page uses to tell causes apart;
     * Android's own error codes are coarser than Chromium's.
     */
    private void showErrorPage(String failedUrl, int code, String desc) {
        errorPageFailedUrl = failedUrl;
        String page = ERROR_PAGE + "?url=" + Uri.encode(failedUrl)
                + "&code=" + code + "&desc=" + Uri.encode(desc);
        // Posted so the WebView finishes handling the failure first.
        webView.post(() -> webView.loadUrl(page));
    }

    private static boolean isErrorPage(String url) {
        return url != null && url.startsWith(ERROR_PAGE);
    }

    private static boolean isWebUrl(String url) {
        return url != null && (url.startsWith("https://") || url.startsWith("http://"));
    }

    /** Same page, ignoring a #fragment and a trailing slash. */
    private static boolean sameUrl(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return normalise(a).equals(normalise(b));
    }

    private static String normalise(String url) {
        int hash = url.indexOf('#');
        String u = hash >= 0 ? url.substring(0, hash) : url;
        return u.endsWith("/") ? u.substring(0, u.length() - 1) : u;
    }

    /** Chromium's name for an SslError, so error.html can recognise it. */
    private static String sslErrorName(int primaryError) {
        switch (primaryError) {
            case SslError.SSL_UNTRUSTED:
                return "ERR_CERT_AUTHORITY_INVALID";
            case SslError.SSL_IDMISMATCH:
                return "ERR_CERT_COMMON_NAME_INVALID";
            case SslError.SSL_EXPIRED:
            case SslError.SSL_NOTYETVALID:
            case SslError.SSL_DATE_INVALID:
                return "ERR_CERT_DATE_INVALID";
            default:
                return "ERR_CERT_INVALID";
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
