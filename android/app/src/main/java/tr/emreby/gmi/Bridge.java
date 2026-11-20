package tr.emreby.gmi;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.usage.UsageStatsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.location.Address;
import android.location.Geocoder;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.Locale;
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

    /** Veri tasarrufu: bu uygulamanın arka planda mobil veri kullanmasına izin verme ekranı. */
    @JavascriptInterface
    public void openDataSettings() {
        main.post(() -> {
            try {
                act.startActivity(new Intent(Settings.ACTION_IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS, Uri.parse("package:" + ctx.getPackageName())));
            } catch (Exception e) {
                try {
                    act.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName())));
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** Üreticinin "otomatik başlatma" / arka plan izni ekranı (Xiaomi, Huawei, Honor, Oppo, Realme, OnePlus, Vivo, Samsung, Asus);
     *  ekran adları sürüme göre değiştiği için sırayla denenir, hiçbiri açılmazsa uygulama bilgisi ekranı açılır. */
    @JavascriptInterface
    public void openAutostart() {
        final String m = (Build.MANUFACTURER == null ? "" : Build.MANUFACTURER).toLowerCase(Locale.ROOT);
        final String[][] aday;
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")) aday = new String[][]{
                {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"}};
        else if (m.contains("huawei") || m.contains("honor")) aday = new String[][]{
                {"com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"}};
        else if (m.contains("oppo") || m.contains("realme") || m.contains("oneplus")) aday = new String[][]{
                {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
                {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
                {"com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"},
                {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"}};
        else if (m.contains("vivo") || m.contains("iqoo")) aday = new String[][]{
                {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
                {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"}};
        else if (m.contains("samsung")) aday = new String[][]{
                {"com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"},
                {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"}};
        else if (m.contains("asus")) aday = new String[][]{
                {"com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"}};
        else aday = new String[0][];
        main.post(() -> {
            for (String[] c : aday) {
                try {
                    act.startActivity(new Intent().setComponent(new ComponentName(c[0], c[1])));
                    return;
                } catch (Exception ignored) {
                }
            }
            try {
                act.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName())));
            } catch (Exception ignored) {
            }
        });
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

    /** Konum izni "bir daha sorma" ile reddedildiyse izni yeniden açabilmek için uygulama ayarları. */
    @JavascriptInterface
    public void openAppSettings() {
        main.post(() -> {
            try {
                act.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName())));
            } catch (Exception ignored) {
            }
        });
    }

    /** Grafik tam ekranı: açıkken ekran yataya döner (iki yönde), durum ve gezinme çubukları gizlenir (kenardan kaydırınca geçici görünür). */
    @JavascriptInterface
    public void tamEkran(final boolean ac) {
        main.post(() -> {
            try {
                act.setRequestedOrientation(ac ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(act.getWindow(), act.getWindow().getDecorView());
                if (ac) {
                    c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    c.hide(WindowInsetsCompat.Type.systemBars());
                } else {
                    c.show(WindowInsetsCompat.Type.systemBars());
                }
            } catch (Exception ignored) {
            }
        });
    }

    /* ---------- bildirim kontrol listesi ---------- */

    /** Bildirimlerin gelmesi için gerekenlerin durumu (ayarlar ekranındaki kontrol listesi). */
    @JavascriptInterface
    public String notifStatus() {
        JSONObject o = new JSONObject();
        try {
            SharedPreferences p = prefs();
            o.put("izin", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
            o.put("kanal", Notify.channelImportance(ctx, Notify.CH));
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            o.put("pil", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
            o.put("arka", p.getBoolean("bg_on", true));
            o.put("son", p.getLong("bg_last_ms", 0));
            o.put("ozet", p.getBoolean("ozet_on", false));
            o.put("marka", Build.MANUFACTURER);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("simdi", System.currentTimeMillis());
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            o.put("kurulum", pi.firstInstallTime);
            o.put("guncelleme", pi.lastUpdateTime);
            o.put("tetik", p.getLong("tetik_sonraki", 0));
            try {
                o.put("calisma", new JSONArray(p.getString("bg_calisma", "[]")));
            } catch (Exception ignored) {
            }
            if (Build.VERSION.SDK_INT >= 28) {
                // Android'in sınıflaması: 5 muaf, 10 etkin, 20 sık, 30 ara sıra, 40 nadir, 45 kısıtlı (yüksek değer = daha çok erteleme)
                UsageStatsManager us = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
                if (us != null) o.put("kova", us.getAppStandbyBucket());
                ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) o.put("kisitli", am.isBackgroundRestricted());
            }
            // Veri tasarrufu: 1 kapalı, 2 bu uygulamaya izinli, 3 arka planda mobil veri engelli
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) o.put("veri", cm.getRestrictBackgroundStatus());
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    @JavascriptInterface
    public void openNotificationSettings() {
        main.post(() -> {
            try {
                act.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName()));
            } catch (Exception e) {
                try {
                    act.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName())));
                } catch (Exception ignored) {
                }
            }
        });
    }

    @JavascriptInterface
    public void setDailySummary(boolean on) {
        prefs().edit().putBoolean("ozet_on", on).apply();
    }

    /* ---------- fiyat alarmları ---------- */

    @JavascriptInterface
    public String alarmsGet() {
        return Alarms.list(ctx);
    }

    @JavascriptInterface
    public void alarmsSet(String json) {
        Alarms.setList(ctx, json);
    }

    @JavascriptInterface
    public String alarmHits() {
        return Alarms.hits(ctx).toString();
    }

    /** Uygulama açıkken arayüzün yakaladığı alarm: daha önce çalmadıysa kaydedip bildirim gösterir. */
    @JavascriptInterface
    public boolean alarmHit(String id, double px, String src, String title, String text) {
        return Alarms.fire(ctx, id, px, src, title, text);
    }

    /* ---------- yedek dosyası ---------- */

    /** Dosyayı kullanıcının seçtiği yere kaydeder (Android dosya kaydetme ekranı); sonuç window.__gmiSaved(ok, mesaj). */
    @JavascriptInterface
    public void saveFile(final String name, final String content) {
        main.post(() -> {
            if (act instanceof MainActivity) ((MainActivity) act).saveFile(name, content);
        });
    }

    /* ---------- konumdan il ve ilçe ---------- */

    /** Telefonun adres servisiyle (Android Geocoder; Google hizmetli telefonlarda Google) il ve ilçe; sonuç window.__gmiGeo(id, json). */
    @JavascriptInterface
    public void geocode(final String id, final double lat, final double lon) {
        pool.execute(() -> {
            JSONObject o = new JSONObject();
            try {
                if (!Geocoder.isPresent()) throw new Exception("bu telefonda adres servisi yok");
                @SuppressWarnings("deprecation")
                List<Address> l = new Geocoder(ctx, Locale.forLanguageTag("tr-TR")).getFromLocation(lat, lon, 1);
                if (l == null || l.isEmpty()) throw new Exception("adres bulunamadı");
                Address a = l.get(0);
                o.put("ok", true);
                if (a.getAdminArea() != null) o.put("il", a.getAdminArea());
                String ilce = a.getSubAdminArea() != null ? a.getSubAdminArea() : a.getLocality();
                if (ilce != null) o.put("ilce", ilce);
            } catch (Exception e) {
                try {
                    o.put("ok", false);
                    o.put("hata", String.valueOf(e.getMessage()));
                } catch (Exception ignored) {
                }
            }
            final String js = "window.__gmiGeo&&window.__gmiGeo(" + JSONObject.quote(id) + "," + o + ")";
            main.post(() -> web.evaluateJavascript(js, null));
        });
    }

    @JavascriptInterface
    public String version() {
        return BuildConfig.VERSION_NAME;
    }
}
