package tr.emreby.gmi;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Arayüzün çağırdığı yerel işlevler (window.GMI_NATIVE). */
public class Bridge {
    private final Activity act;
    private final Context ctx;
    private final WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());

    Bridge(Activity act, WebView web) {
        this.act = act;
        this.ctx = act.getApplicationContext();
        this.web = web;
    }

    private SharedPreferences prefs() {
        return ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE);
    }

    /** Tarayıcı kısıtı (CORS) olmadan GET isteği; sonuç window.__gmiNative(id, durum, gövde) ile döner. */
    @JavascriptInterface
    public void fetch(final String id, final String url) {
        pool.execute(() -> {
            String js;
            try {
                Net.Resp r = Net.get(url);
                js = "window.__gmiNative&&window.__gmiNative(" + JSONObject.quote(id) + "," + r.code + "," + JSONObject.quote(r.body) + ")";
            } catch (Exception e) {
                js = "window.__gmiNative&&window.__gmiNative(" + JSONObject.quote(id) + ",0," + JSONObject.quote(String.valueOf(e.getMessage())) + ")";
            }
            final String f = js;
            main.post(() -> web.evaluateJavascript(f, null));
        });
    }

    @JavascriptInterface
    public void saveState(String json) {
        prefs().edit().putString("state", json).apply();
    }

    @JavascriptInterface
    public String backgroundLog() {
        return prefs().getString("bglog", "{}");
    }

    @JavascriptInterface
    public String backgroundAlerts() {
        return prefs().getString("bg_alerts", "[]");
    }

    @JavascriptInterface
    public boolean backgroundOn() {
        return prefs().getBoolean("bg_on", true);
    }

    @JavascriptInterface
    public void setBackground(boolean on) {
        prefs().edit().putBoolean("bg_on", on).apply();
        if (on) Scheduler.ensure(ctx);
        else Scheduler.cancel(ctx);
    }

    @JavascriptInterface
    public void checkNow() {
        Scheduler.runOnce(ctx);
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    @JavascriptInterface
    public void requestNotifications() {
        main.post(() -> {
            if (act instanceof MainActivity) ((MainActivity) act).askNotificationPermission();
            if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
                try {
                    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                    act.startActivity(i);
                } catch (Exception ignored) {
                }
            }
        });
    }

    @JavascriptInterface
    public void testNotification() {
        Notify.show(ctx, "GMI Piyasa", "Deneme bildirimi: arka plan uyarıları bu şekilde gelir.", 999);
    }

    @JavascriptInterface
    public void openBatterySettings() {
        main.post(() -> {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
                act.startActivity(i);
            } catch (Exception e) {
                try {
                    act.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName())));
                } catch (Exception ignored) {
                }
            }
        });
    }

    @JavascriptInterface
    public String version() {
        return BuildConfig.VERSION_NAME;
    }
}
