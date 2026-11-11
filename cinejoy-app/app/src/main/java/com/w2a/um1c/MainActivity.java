package com.w2a.um1c;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends Activity {

    private static final String HOME_URL = "https://cinejoy.pk/";

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

    private static final int REQUEST_STORAGE_PERMISSION = 1;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        loadAdBlockList();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

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
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                try {
                    view.evaluateJavascript(adCleanupJs(), null);
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

    /** Load the ad/tracker host blocklist shipped in assets. */
    private void loadAdBlockList() {
        try (InputStream is = getAssets().open("adblock-hosts.txt");
             BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
            String line;
            while ((line = br.readLine()) != null) {
                line = line.trim().toLowerCase();
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
            String domain = host.toLowerCase();
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
        if (url.startsWith("http://") || url.startsWith("https://")) {
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

    @Override
    public void onBackPressed() {
        if (customView != null) {
            // Exit fullscreen video first
            chromeClient.onHideCustomView();
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
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
