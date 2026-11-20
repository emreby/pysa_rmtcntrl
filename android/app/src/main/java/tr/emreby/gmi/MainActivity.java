package tr.emreby.gmi;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Uygulama kabuğu: arayüz (HTML/JS) uygulamanın içinden yüklenir; veri istekleri Bridge üzerinden yapılır. */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final int REQ_NOTIFY = 1, REQ_LOCATION = 2, REQ_OPEN_FILE = 3, REQ_SAVE_FILE = 4;
    private WebView web;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSave;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        // İller sekmesindeki "yakınımdaki kuyumcular" için konum. Konum yalnız kullanıcı düğmeye basınca istenir.
        s.setGeolocationEnabled(true);
        // Uygulamanın kendi isteklerini tanıtan ek (tarayıcı kimliğinin sonuna).
        s.setUserAgentString(s.getUserAgentString() + " GMIPiyasa/" + BuildConfig.VERSION_NAME + " (+https://github.com/emreby/pysa_rmtcntrl)");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // Gömülü Google haritasının (iframe) kendi içindeki gezinmesi iframe'de kalır; yalnız sayfadan çıkan bağlantılar dışarıda açılır.
                if (!request.isForMainFrame()) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!HOST.equals(Uri.parse(origin).getHost())) {
                    callback.invoke(origin, false, false);
                    return;
                }
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                    return;
                }
                geoCallback = callback;
                geoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }

            @Override
            public void onGeolocationPermissionsHidePrompt() {
                geoCallback = null;
                geoOrigin = null;
            }

            // Yedek dosyasını geri yüklemek için dosya seçme (<input type="file">).
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(i, REQ_OPEN_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(this, web), "GMI_NATIVE");
        web.loadUrl("https://" + HOST + "/assets/www/index.html");

        askNotificationPermission();
        Scheduler.ensure(this);
    }

    void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
        }
    }

    boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocationPermission(), false);
            geoCallback = null;
            geoOrigin = null;
        }
    }

    /** Yedek dosyasını kaydetme: Android'in dosya kaydetme ekranını açar, içerik onActivityResult'ta yazılır. */
    void saveFile(String name, String content) {
        pendingSave = content;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(i, REQ_SAVE_FILE);
        } catch (Exception e) {
            pendingSave = null;
            savedResult(false, "Dosya kaydetme ekranı açılamadı.");
        }
    }

    private void savedResult(boolean ok, String msg) {
        if (web != null) web.evaluateJavascript("window.__gmiSaved&&window.__gmiSaved(" + ok + "," + JSONObject.quote(msg) + ")", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OPEN_FILE) {
            if (fileCallback != null) {
                Uri[] res = (resultCode == RESULT_OK && data != null && data.getData() != null) ? new Uri[]{data.getData()} : null;
                fileCallback.onReceiveValue(res);
                fileCallback = null;
            }
        } else if (requestCode == REQ_SAVE_FILE) {
            String content = pendingSave;
            pendingSave = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || content == null) {
                savedResult(false, "Kaydetme iptal edildi.");
                return;
            }
            try (OutputStream os = getContentResolver().openOutputStream(data.getData(), "wt")) {
                if (os == null) throw new Exception("dosya açılamadı");
                os.write(content.getBytes(StandardCharsets.UTF_8));
                savedResult(true, "Yedek kaydedildi.");
            } catch (Exception e) {
                savedResult(false, "Kaydedilemedi: " + e.getMessage());
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.gmiOnResume && window.gmiOnResume()", null);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Uygulamadan çıkınca yedek alarm yeniden kurulur: bir sonraki kontrol ≈15 dakika sonra
        Tetik.kur(this);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        // Önce arayüze sorulur: tam ekran grafik, açık grafik ya da ayarlar penceresi varsa onu kapatır, başka sekmedeyse ana sekmeye döner
        web.evaluateJavascript("(function(){try{return !!(window.__gmiGeri&&window.__gmiGeri());}catch(e){return false;}})()", v -> {
            if ("true".equals(v)) return;
            if (web.canGoBack()) web.goBack();
            else super.onBackPressed();
        });
    }
}
