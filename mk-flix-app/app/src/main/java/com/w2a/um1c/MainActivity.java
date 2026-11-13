package com.w2a.um1c;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.app.UiModeManager;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
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
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends Activity {

    private static final String HOME_URL = "https://cinejoy.pk/";
    // Shown instead of a failed page; see showErrorPage().
    private static final String ERROR_PAGE = "file:///android_asset/error.html";
    // The account gate, loaded at startup. It checks the MK-Flix backend for an
    // active subscription and sends the WebView to HOME_URL itself once the user
    // is signed in and subscribed; otherwise it handles sign-in and payment.
    private static final String ACCOUNT_PAGE = "file:///android_asset/mkflix-account.html";

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
    // Playback gate on cinejoy.pk (assets/mkflix-enforcer.js): blocks /watch/
    // pages while there is no active subscription and opens the paywall. It
    // reads the subscription through the MKFlixNative bridge below.
    private String enforcerJs = "";
    // "My Subscription" item added to cinejoy.pk's settings menu (assets/mkflix-menu.js).
    private String menuJs = "";
    // Golden padlock on each poster while unsubscribed (assets/mkflix-lock.js).
    private String lockJs = "";
    private final Subscription subscription = new Subscription();
    // Backend URL the gate uses, from assets/mkflix-config.json (apiBase). Set
    // by the operator without editing the gate; handed over via getApiBase().
    private String apiBaseConfig = "";

    // Android TV / Google TV. The same APK runs on phones and TVs; on a TV
    // the app adds remote-control support (assets/mkflix-tv.js: desktop
    // layout, arrow-key navigation, video keys) and a pointer mode for
    // anything the arrows can't reach. Phones are unaffected.
    private boolean isTv;
    private String tvJs = "";
    private TvPointer pointer;

    private static final int REQUEST_STORAGE_PERMISSION = 1;

    // Startup splash, shown when the app is opened (not when Android
    // restores it after a rotation or a trip to the background). See
    // showSplash().
    private FrameLayout splash;
    private long splashShownAt;
    private ObjectAnimator splashPulse;
    private final Runnable splashTimeout = this::dismissSplash;
    // Shown at least this long, so it reads as an intro rather than a flicker.
    private static final long SPLASH_MIN_MS = 3000;
    // Taken down after this long even if the page is still loading, so a
    // slow network shows the site's own progress instead of a stuck splash.
    private static final long SPLASH_MAX_MS = 15000;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        // The WebView paints white until a page draws, whatever the layout's
        // background says; that was the white flash at startup.
        webView.setBackgroundColor(Color.BLACK);
        if (savedInstanceState == null) {
            showSplash();
        }
        loadAdBlockList();
        footerJs = readAsset("mkflix-footer.js");
        enforcerJs = readAsset("mkflix-enforcer.js");
        menuJs = readAsset("mkflix-menu.js");
        lockJs = readAsset("mkflix-lock.js");
        apiBaseConfig = readApiBaseConfig();
        subscription.load();
        // The gate and the enforcer talk to the app through this. It is exposed
        // to cinejoy.pk too, but exposes nothing that lets a page there grant
        // itself a subscription: the app checks the backend for that.
        webView.addJavascriptInterface(new MkFlixBridge(), "MKFlixNative");
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        // The account gate (mkflix-account.html) is a local asset that calls the
        // MK-Flix backend with fetch(). Allowing cross-origin requests from the
        // file:// origin keeps that from being blocked by CORS. It affects only
        // our own trusted asset page; once the gate hands off to cinejoy.pk the
        // origin is https and this no longer applies.
        settings.setAllowUniversalAccessFromFileURLs(true);

        UiModeManager uiMode = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        isTv = uiMode != null && uiMode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        if (isTv) {
            tvJs = readAsset("mkflix-tv.js");
            // mkflix-tv.js asks for a 1280px-wide page; these let the WebView
            // honour that and scale it to fill the screen.
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            pointer = new TvPointer(this);
            ((ViewGroup) webView.getParent()).addView(pointer, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            webView.setFocusable(true);
            webView.requestFocus();
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString(),
                        request.isForMainFrame(), request.hasGesture());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Only called before Android 7 (API 24), below our minSdk.
                return handleUrl(url, true, false);
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
                if (!tvJs.isEmpty() && isCineJoyUrl(url)) {
                    view.evaluateJavascript(tvJs, null);
                }
                if (!enforcerJs.isEmpty() && isCineJoyUrl(url)) {
                    view.evaluateJavascript(enforcerJs, null);
                }
                if (!menuJs.isEmpty() && isCineJoyUrl(url)) {
                    view.evaluateJavascript(menuJs, null);
                }
                if (!lockJs.isEmpty() && isCineJoyUrl(url)) {
                    view.evaluateJavascript(lockJs, null);
                }
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                // Also called for the site's in-page navigation (history.pushState).
                boolean watching = isWatchUrl(url);
                // Playback gate: a /watch/ page reached without an active
                // subscription is sent to the paywall. The enforcer script
                // normally catches this first; this backs it up for full page
                // loads and anything it misses.
                if (watching && !subscription.isActive()) {
                    openPaywall();
                    return;
                }
                // On a TV, keep the screen on while on a video page, so the
                // screensaver doesn't start mid-film.
                if (isTv) {
                    if (watching) {
                        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
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
                // First page is in: hand over from the splash. Not for a page
                // that failed, which is about to be replaced by the error screen.
                if (isErrorPage(url) || !sameUrl(url, errorPageFailedUrl)) {
                    dismissSplash();
                }
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
                        // TV script again in case commit-visible was skipped;
                        // it guards against running twice.
                        if (!tvJs.isEmpty()) {
                            view.evaluateJavascript(tvJs, null);
                        }
                        // Playback gate again in case commit-visible was
                        // skipped; it guards against running twice.
                        if (!enforcerJs.isEmpty()) {
                            view.evaluateJavascript(enforcerJs, null);
                        }
                        if (!menuJs.isEmpty()) {
                            view.evaluateJavascript(menuJs, null);
                        }
                        if (!lockJs.isEmpty()) {
                            view.evaluateJavascript(lockJs, null);
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
            webView.loadUrl(ACCOUNT_PAGE);
        }
    }

    /**
     * Startup splash: the MK-Flix mark, gently pulsing, with the wordmark and
     * a loading bar under it, until the first page has loaded.
     *
     * The window background (res/drawable/splash_window.xml) already shows
     * the mark from the moment the app opens, while the WebView starts up,
     * and on Android 12+ the system splash shows the icon in the same spot.
     * This view takes over from them without the mark moving, then fades
     * out to reveal the page.
     */
    private void showSplash() {
        float dp = getResources().getDisplayMetrics().density;
        splash = new FrameLayout(this);
        splash.setBackgroundColor(Color.BLACK);
        // Swallows touches meant for the page underneath while it shows.
        splash.setClickable(true);

        FrameLayout group = new FrameLayout(this);
        splash.addView(group, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash_logo);
        int logoSize = Math.round(240 * dp);
        group.addView(logo, new FrameLayout.LayoutParams(logoSize, logoSize, Gravity.CENTER));

        LinearLayout below = new LinearLayout(this);
        below.setOrientation(LinearLayout.VERTICAL);
        below.setGravity(Gravity.CENTER_HORIZONTAL);
        ImageView word = new ImageView(this);
        word.setImageResource(R.drawable.splash_wordmark);
        word.setAlpha(0f);
        word.setTranslationY(12 * dp);
        below.addView(word, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, Math.round(32 * dp)));
        LoadingBar bar = new LoadingBar(this);
        bar.setAlpha(0f);
        LinearLayout.LayoutParams barParams = new LinearLayout.LayoutParams(
                Math.round(140 * dp), Math.round(3 * dp));
        barParams.topMargin = Math.round(18 * dp);
        below.addView(bar, barParams);
        // Placed under the mark once the size is known (splashAligner).
        group.addView(below, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER_HORIZONTAL | Gravity.TOP));

        ((ViewGroup) webView.getParent()).addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splash.getViewTreeObserver().addOnPreDrawListener(splashAligner);

        word.animate().alpha(1f).translationY(0f)
                .setStartDelay(250).setDuration(500)
                .setInterpolator(new AccelerateDecelerateInterpolator());
        bar.animate().alpha(1f).setStartDelay(550).setDuration(400);
        // Same pulse as the site's loading screen (mkflix-pulse in
        // mkflix-logo.css), so the two read as one.
        splashPulse = ObjectAnimator.ofPropertyValuesHolder(logo,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 0.94f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 0.94f),
                PropertyValuesHolder.ofFloat(View.ALPHA, 1f, 0.7f));
        splashPulse.setDuration(800);
        splashPulse.setStartDelay(300);
        splashPulse.setRepeatCount(ValueAnimator.INFINITE);
        splashPulse.setRepeatMode(ValueAnimator.REVERSE);
        splashPulse.setInterpolator(new AccelerateDecelerateInterpolator());
        splashPulse.start();

        splashShownAt = SystemClock.uptimeMillis();
        webView.postDelayed(splashTimeout, SPLASH_MAX_MS);
    }

    /**
     * Runs once, just before the splash is first drawn. The window background
     * centres the mark in the whole window, but the splash sits below the
     * status bar (phones), so shift its contents to line up with that centre,
     * and put the wordmark and bar under the mark (about 52 dp below centre).
     */
    private final ViewTreeObserver.OnPreDrawListener splashAligner =
            new ViewTreeObserver.OnPreDrawListener() {
        @Override
        public boolean onPreDraw() {
            if (splash == null) {
                return true;
            }
            splash.getViewTreeObserver().removeOnPreDrawListener(this);
            float dp = getResources().getDisplayMetrics().density;
            View group = splash.getChildAt(0);
            View below = ((ViewGroup) group).getChildAt(1);
            View decor = getWindow().getDecorView();
            int[] at = new int[2];
            splash.getLocationInWindow(at);
            group.setTranslationX(decor.getWidth() / 2f - (at[0] + splash.getWidth() / 2f));
            group.setTranslationY(decor.getHeight() / 2f - (at[1] + splash.getHeight() / 2f));
            below.setY(splash.getHeight() / 2f + 76 * dp);
            return true;
        }
    };

    /** Fade the splash out, once it has been up for SPLASH_MIN_MS. */
    private void dismissSplash() {
        if (splash == null) {
            return;
        }
        final FrameLayout leaving = splash;
        splash = null;
        webView.removeCallbacks(splashTimeout);
        long wait = Math.max(0, SPLASH_MIN_MS - (SystemClock.uptimeMillis() - splashShownAt));
        leaving.animate().alpha(0f).setStartDelay(wait).setDuration(450)
                .withEndAction(() -> {
                    if (splashPulse != null) {
                        splashPulse.cancel();
                        splashPulse = null;
                    }
                    ViewGroup parent = (ViewGroup) leaving.getParent();
                    if (parent != null) {
                        parent.removeView(leaving);
                    }
                });
    }

    /**
     * The splash's loading bar: a faint track with a neon segment (the
     * mark's cyan, magenta and red) sweeping across it.
     */
    static final class LoadingBar extends View {
        private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint segment = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Matrix shift = new Matrix();
        private final RectF rect = new RectF();
        private LinearGradient gradient;
        private ValueAnimator sweep;
        private float phase;

        LoadingBar(Context context) {
            super(context);
            track.setColor(0x26FFFFFF);
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            gradient = new LinearGradient(0, 0, w * 0.4f, 0,
                    new int[]{0xFF00E5FF, 0xFFE040FB, 0xFFFF3D57}, null, Shader.TileMode.CLAMP);
            segment.setShader(gradient);
        }

        @Override
        protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            sweep = ValueAnimator.ofFloat(0f, 1f);
            sweep.setDuration(1300);
            sweep.setRepeatCount(ValueAnimator.INFINITE);
            sweep.setInterpolator(new AccelerateDecelerateInterpolator());
            sweep.addUpdateListener(a -> {
                phase = (float) a.getAnimatedValue();
                invalidate();
            });
            sweep.start();
        }

        @Override
        protected void onDetachedFromWindow() {
            if (sweep != null) {
                sweep.cancel();
                sweep = null;
            }
            super.onDetachedFromWindow();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float w = getWidth(), h = getHeight(), r = h / 2f;
            rect.set(0, 0, w, h);
            canvas.drawRoundRect(rect, r, r, track);
            if (gradient == null) {
                return;
            }
            float len = w * 0.4f;
            float left = -len + (w + len) * phase;
            rect.set(Math.max(0, left), 0, Math.min(w, left + len), h);
            if (rect.width() <= 0) {
                return;
            }
            shift.setTranslate(left, 0);
            gradient.setLocalMatrix(shift);
            canvas.drawRoundRect(rect, r, r, segment);
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

    /** A cinejoy.pk player page (where playback happens). */
    private static boolean isWatchUrl(String url) {
        if (!isCineJoyUrl(url)) {
            return false;
        }
        String path = Uri.parse(url).getPath();
        return path != null && path.startsWith("/watch/");
    }

    /** Send the WebView back to the account gate, which shows the paywall. */
    private void openPaywall() {
        loadOnUiThread(ACCOUNT_PAGE);
    }

    /**
     * The "My Subscription" menu entry: the account gate opened on its
     * subscription page (a subscriber would otherwise go straight back to the
     * site).
     */
    private void openSubscription() {
        loadOnUiThread(ACCOUNT_PAGE + "#subscription");
    }

    private void loadOnUiThread(String url) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.loadUrl(url);
            }
        });
    }

    /** The backend URL from assets/mkflix-config.json (apiBase), or "". */
    private String readApiBaseConfig() {
        try {
            return new JSONObject(readAsset("mkflix-config.json")).optString("apiBase", "").trim();
        } catch (Exception e) {
            return "";
        }
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
     * Ad-network "click-catchers": a transparent div covering the whole
     * screen at the top z-index (2147483647), added a few seconds after the
     * page loads. While it's there every swipe hits it instead of the page,
     * and a tap on it fires the ad's redirect. This rule lets touches pass
     * through it. Its inline style isn't !important, so this wins.
     */
    private static final String CLICK_CATCHER_CSS =
            "html>div[style*=\"2147483647\"],body>div[style*=\"2147483647\"]"
            + "{pointer-events:none!important}";

    /**
     * Cosmetic cleanup: remove ad iframes/embeds served from blocked hosts so
     * invisible ad containers can't sit over the page and swallow taps/swipes,
     * and neutralise click-catcher overlays (see CLICK_CATCHER_CSS).
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
        sb.append("if(!document.getElementById('mkflix-adguard')){var s=document.createElement('style');");
        sb.append("s.id='mkflix-adguard';s.textContent='").append(CLICK_CATCHER_CSS).append("';");
        sb.append("(document.head||document.documentElement).appendChild(s);}");
        sb.append("clean();setTimeout(clean,2000);})()");
        return sb.toString();
    }

    // Sites that may open in their own app or the browser when the user taps
    // a link to them (e.g. a trailer). Same list as the desktop app.
    private static final String[] EXTERNAL_ALLOW = {"youtube.com", "youtu.be", "vimeo.com"};

    /**
     * Navigation policy, matching the desktop app. Ad scripts on the site
     * try to escape the app: they redirect the page to an ad, or hand an
     * intent:// link to Chrome, often from a tap on an invisible overlay or
     * with no tap at all.
     *
     * - Pages: only cinejoy.pk loads in the app. A tapped link to YouTube or
     *   Vimeo opens in its app or the browser; anything else is dropped.
     *   Embedded players (sub-frames) are not affected.
     * - Other apps (tel:, Play Store, intent:, ...): only for a link the user
     *   tapped, and never for intents that just open a web page in a browser,
     *   which is how ads escape to Chrome. If nothing can handle the link it
     *   is swallowed, so the WebView never shows ERR_UNKNOWN_URL_SCHEME.
     *
     * Intents built from a web page are untrusted, so they are limited to
     * what a browser could open: BROWSABLE activities only, with any explicit
     * component or selector stripped. Without this a page could launch
     * arbitrary exported activities in other apps.
     */
    private boolean handleUrl(String url, boolean mainFrame, boolean userTapped) {
        if (url == null) {
            return true;
        }
        if (isWebUrl(url)) {
            if (!mainFrame) {
                return false; // embedded player or other sub-frame
            }
            if (isCineJoyUrl(url)) {
                loadingUrl = url; // before onPageStarted, which a fast SSL failure can beat
                return false; // load in the WebView
            }
            if (userTapped && isExternalAllowed(url)) {
                openExternally(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            }
            return true; // off-site: never loads in the app
        }
        if (!userTapped) {
            return true; // other apps open only from a real tap
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
        // An intent whose data is a web address just opens a page in some app,
        // normally Chrome (e.g. intent://ad.example#Intent;scheme=https;
        // package=com.android.chrome;end). That's the ad escape route; real
        // app links (tel:, market:, an app's own scheme) aren't http(s).
        String dataScheme = intent.getScheme();
        if ("http".equalsIgnoreCase(dataScheme) || "https".equalsIgnoreCase(dataScheme)) {
            return true;
        }

        if (!openExternally(intent)) {
            // No app installed: honour the page's web fallback, if it's on cinejoy.pk.
            String fallback = intent.getStringExtra("browser_fallback_url");
            if (isCineJoyUrl(fallback)) {
                loadingUrl = fallback;
                webView.loadUrl(fallback);
            }
        }
        return true; // consumed
    }

    /**
     * Launch an intent from a web page in another app, limited to BROWSABLE
     * activities with any explicit component or selector stripped. Returns
     * false if no app can handle it.
     */
    private boolean openExternally(Intent intent) {
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setComponent(null);
        intent.setSelector(null);
        // Attempt the launch instead of checking resolveActivity() first: on
        // Android 11+ package visibility rules make resolveActivity() return
        // null for most apps unless they are declared in <queries>.
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        } catch (Exception e) {
            return true; // couldn't launch for another reason; don't fall back
        }
    }

    private static boolean isExternalAllowed(String url) {
        String host = Uri.parse(url).getHost();
        if (host == null) {
            return false;
        }
        host = host.toLowerCase(java.util.Locale.ROOT);
        for (String d : EXTERNAL_ALLOW) {
            if (host.equals(d) || host.endsWith("." + d)) {
                return true;
            }
        }
        return false;
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
        } else if (webView != null && isErrorPage(webView.getUrl())) {
            backFromErrorPage();
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
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
        super.onBackPressed();
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

    // --- TV remote ---------------------------------------------------------

    // Holding OK for Android's long-press time switches pointer mode on or off.
    private long okDownAt;
    private boolean okLongPressHandled;

    /**
     * TV remote handling that has to happen before keys reach the page:
     * - OK is decided on release, so a long press can toggle pointer mode
     *   without the page also seeing an OK. A short press is then passed to
     *   the page as a whole press.
     * - In pointer mode the arrows move the pointer, OK taps where it
     *   points, and Back leaves pointer mode.
     * Everything else (and everything on phones, or in fullscreen video)
     * goes the normal way: arrows and media keys reach mkflix-tv.js.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (!isTv || pointer == null || customView != null) {
            return super.dispatchKeyEvent(event);
        }
        int code = event.getKeyCode();
        int action = event.getAction();

        if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            if (action == KeyEvent.ACTION_DOWN) {
                if (event.getRepeatCount() == 0) {
                    okDownAt = event.getDownTime();
                    okLongPressHandled = false;
                } else if (!okLongPressHandled && (event.isLongPress()
                        || event.getEventTime() - okDownAt >= ViewConfiguration.getLongPressTimeout())) {
                    okLongPressHandled = true;
                    togglePointer();
                }
                return true;
            }
            if (action == KeyEvent.ACTION_UP) {
                if (okLongPressHandled) {
                    okLongPressHandled = false;
                    return true;
                }
                if (pointer.isOn()) {
                    pointer.tap(webView);
                    return true;
                }
                super.dispatchKeyEvent(new KeyEvent(event.getDownTime(), event.getEventTime(),
                        KeyEvent.ACTION_DOWN, code, 0, event.getMetaState(), event.getDeviceId(),
                        event.getScanCode(), event.getFlags(), event.getSource()));
                return super.dispatchKeyEvent(event);
            }
        }

        if (pointer.isOn()) {
            switch (code) {
                case KeyEvent.KEYCODE_DPAD_UP:
                case KeyEvent.KEYCODE_DPAD_DOWN:
                case KeyEvent.KEYCODE_DPAD_LEFT:
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    if (action == KeyEvent.ACTION_DOWN) {
                        pointer.move(code, event.getRepeatCount(), webView);
                    }
                    return true;
                case KeyEvent.KEYCODE_BACK:
                    if (action == KeyEvent.ACTION_UP) {
                        togglePointer();
                    }
                    return true;
                default:
                    break;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void togglePointer() {
        pointer.setOn(!pointer.isOn());
        Toast.makeText(this, pointer.isOn()
                ? "Pointer on: arrows move it, OK taps. Hold OK or press Back to turn it off."
                : "Pointer off", Toast.LENGTH_SHORT).show();
    }

    /**
     * TV pointer mode: a cursor drawn over the page, moved with the remote's
     * arrows, for anything arrow-key navigation can't reach. OK sends a tap
     * at the pointer; pushing past a screen edge swipes the page (or a row
     * of posters) under the pointer, so it scrolls.
     */
    static final class TvPointer extends View {
        private final float density;
        private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float x = -1, y = -1;
        private boolean on;

        TvPointer(Context context) {
            super(context);
            density = context.getResources().getDisplayMetrics().density;
            setVisibility(GONE);
            setFocusable(false);
            setClickable(false);
            glow.setColor(0x6600E5FF);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(3 * density);
            ring.setColor(0xFFE040FB);
            dot.setColor(0xFFFFFFFF);
        }

        boolean isOn() {
            return on;
        }

        void setOn(boolean value) {
            on = value;
            if (on && x < 0) {
                // Start in the middle. Measure the parent: while this view
                // is hidden (GONE) it isn't laid out, so its own size is 0.
                View parent = (View) getParent();
                x = parent.getWidth() / 2f;
                y = parent.getHeight() / 2f;
            }
            setVisibility(on ? VISIBLE : GONE);
            invalidate();
        }

        void move(int keyCode, int repeat, WebView web) {
            // Starts fine-grained, speeds up while the arrow is held.
            float step = density * Math.min(6 + repeat * 3, 40);
            float dx = 0, dy = 0;
            if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) dx = -step;
            if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) dx = step;
            if (keyCode == KeyEvent.KEYCODE_DPAD_UP) dy = -step;
            if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) dy = step;
            View parent = (View) getParent();
            int w = parent.getWidth(), h = parent.getHeight();
            float nx = Math.max(0, Math.min(w - 1, x + dx));
            float ny = Math.max(0, Math.min(h - 1, y + dy));
            if (nx != x + dx || ny != y + dy) {
                // At an edge: swipe the content under the pointer the other
                // way, so more of it comes into view in the pointer's direction.
                float dist = (dx != 0 ? w : h) / 3f;
                swipe(web, x, y, x - Math.signum(dx) * dist, y - Math.signum(dy) * dist);
            }
            x = nx;
            y = ny;
            invalidate();
        }

        void tap(WebView web) {
            long t = SystemClock.uptimeMillis();
            touch(web, MotionEvent.ACTION_DOWN, t, t, x, y);
            touch(web, MotionEvent.ACTION_UP, t, t + 60, x, y);
        }

        /**
         * A drag from (x0,y0) to (x1,y1). It moves over ~250 ms and then holds
         * still before lifting, so the page scrolls by the drag distance and
         * stops, instead of treating it as a fling and racing to the end.
         */
        private static void swipe(WebView web, float x0, float y0, float x1, float y1) {
            final long start = SystemClock.uptimeMillis();
            final int steps = 15;
            touch(web, MotionEvent.ACTION_DOWN, start, start, x0, y0);
            for (int i = 1; i <= steps; i++) {
                final float f = i / (float) steps;
                web.postDelayed(() -> touch(web, MotionEvent.ACTION_MOVE, start, SystemClock.uptimeMillis(),
                        x0 + (x1 - x0) * f, y0 + (y1 - y0) * f), i * 16L);
            }
            web.postDelayed(() -> touch(web, MotionEvent.ACTION_MOVE, start, SystemClock.uptimeMillis(), x1, y1),
                    steps * 16L + 150);
            web.postDelayed(() -> touch(web, MotionEvent.ACTION_UP, start, SystemClock.uptimeMillis(), x1, y1),
                    steps * 16L + 300);
        }

        private static void touch(WebView web, int action, long downTime, long time, float x, float y) {
            MotionEvent e = MotionEvent.obtain(downTime, time, action, x, y, 0);
            e.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
            web.dispatchTouchEvent(e);
            e.recycle();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            if (!on) return;
            canvas.drawCircle(x, y, 18 * density, glow);
            canvas.drawCircle(x, y, 12 * density, ring);
            canvas.drawCircle(x, y, 3 * density, dot);
        }
    }

    // --- Subscription --------------------------------------------------------

    /**
     * The MK-Flix subscription as the app sees it. The gate hands the app the
     * session (saveSession) and the app checks the backend itself
     * (/me/subscription), so a cinejoy.pk page can't grant itself a
     * subscription. The answer is cached and persisted, read synchronously by
     * the enforcer, and refreshed in the background.
     */
    private final class Subscription {
        private static final String PREFS = "mkflix";
        // Re-check in the background if the cached answer is older than this.
        private static final long STALE_MS = 10 * 60 * 1000;

        private volatile boolean active;
        private volatile long checkedAt;
        private String apiBase = "";
        private String access = "";
        private String refresh = "";

        void load() {
            SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
            apiBase = p.getString("apiBase", "");
            access = p.getString("access", "");
            refresh = p.getString("refresh", "");
            active = p.getBoolean("active", false);
        }

        private void persist() {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString("apiBase", apiBase)
                    .putString("access", access)
                    .putString("refresh", refresh)
                    .putBoolean("active", active)
                    .apply();
        }

        void setSession(String apiBase, String access, String refresh) {
            this.apiBase = apiBase == null ? "" : apiBase;
            this.access = access == null ? "" : access;
            this.refresh = refresh == null ? "" : refresh;
            persist();
            refreshAsync();
        }

        void clear() {
            apiBase = "";
            access = "";
            refresh = "";
            active = false;
            checkedAt = 0;
            persist();
        }

        boolean isActive() {
            if (!apiBase.isEmpty() && !access.isEmpty()
                    && System.currentTimeMillis() - checkedAt > STALE_MS) {
                refreshAsync(); // non-blocking; the cached value is returned now
            }
            return active;
        }

        void refreshAsync() {
            final String base = apiBase;
            final String token = access;
            if (base.isEmpty() || token.isEmpty()) {
                return;
            }
            new Thread(() -> {
                Boolean result = fetchActive(base, token);
                if (result != null) {
                    active = result;
                    checkedAt = System.currentTimeMillis();
                    persist();
                }
            }).start();
        }

        /** GET {base}/me/subscription; the `active` flag, or null on any error. */
        private Boolean fetchActive(String base, String token) {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(base + "/me/subscription").openConnection();
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                if (conn.getResponseCode() != 200) {
                    // 401/5xx/offline: don't turn a previously-good answer to
                    // false on a transient blip or an expired access token; the
                    // gate re-checks and re-sends the session each time it runs.
                    return null;
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream is = conn.getInputStream()) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = is.read(buf)) > 0) {
                        out.write(buf, 0, n);
                    }
                }
                return new JSONObject(out.toString("UTF-8")).optBoolean("active", false);
            } catch (Exception e) {
                return null;
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }
    }

    /** JavaScript bridge (window.MKFlixNative), used by the gate and enforcer. */
    private final class MkFlixBridge {
        @JavascriptInterface
        public String getApiBase() {
            return apiBaseConfig;
        }

        @JavascriptInterface
        public void saveSession(String apiBase, String access, String refresh) {
            subscription.setSession(apiBase, access, refresh);
        }

        @JavascriptInterface
        public void clearSession() {
            subscription.clear();
        }

        @JavascriptInterface
        public void refreshSubscription() {
            subscription.refreshAsync();
        }

        @JavascriptInterface
        public boolean isSubscribed() {
            return subscription.isActive();
        }

        @JavascriptInterface
        public void openPaywall() {
            MainActivity.this.openPaywall();
        }

        @JavascriptInterface
        public void openSubscription() {
            MainActivity.this.openSubscription();
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
        if (splashPulse != null) {
            splashPulse.cancel();
            splashPulse = null;
        }
        if (webView != null) {
            webView.removeCallbacks(splashTimeout);
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
