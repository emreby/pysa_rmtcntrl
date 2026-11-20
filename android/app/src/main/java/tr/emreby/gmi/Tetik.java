package tr.emreby.gmi;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;

import java.util.Calendar;

/**
 * Yedek zamanlayıcı. WorkManager'ın 15 dakikalık işini telefon saatlerce erteleyebiliyor (az kullanılan uygulama sınıfı,
 * pil tasarrufu). Alarmlar çok daha az ertelenir: setAndAllowWhileIdle özel izin istemez ve Doze'da da çalar.
 * Alarm çalınca bir sonraki kurulur ve öncelikli (expedited) tek seferlik kontrol işi başlatılır; öncelikli işler
 * kota içinde Doze ve pil tasarrufu kısıtlarından muaftır ve internete erişebilir.
 * Gündüz (07–24 TSİ) 15, gece 60 dakikada bir. Az önce kontrol yapıldıysa iş kendini atlar (CheckWorker).
 */
public class Tetik extends BroadcastReceiver {
    static final String EYLEM = "tr.emreby.gmi.KONTROL";
    private static final int KOD = 7001;

    private static PendingIntent pi(Context ctx, int flags) {
        Intent i = new Intent(ctx, Tetik.class).setAction(EYLEM);
        return PendingIntent.getBroadcast(ctx, KOD, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    static void kur(Context ctx) {
        try {
            if (!ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE).getBoolean("bg_on", true)) {
                iptal(ctx);
                return;
            }
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            int saat = Calendar.getInstance(CheckWorker.TRT).get(Calendar.HOUR_OF_DAY);
            long dk = saat < 7 ? 60 : 15;
            long t = SystemClock.elapsedRealtime() + dk * 60_000L;
            PendingIntent p = pi(ctx, PendingIntent.FLAG_UPDATE_CURRENT);
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, t, p);
            else am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, t, p);
            ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE).edit()
                    .putLong("tetik_sonraki", System.currentTimeMillis() + dk * 60_000L).apply();
        } catch (Exception ignored) {
        }
    }

    static void iptal(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            PendingIntent p = pi(ctx, PendingIntent.FLAG_NO_CREATE);
            if (am != null && p != null) {
                am.cancel(p);
                p.cancel();
            }
            ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE).edit().remove("tetik_sonraki").apply();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !EYLEM.equals(intent.getAction())) return;
        kur(ctx);
        Scheduler.hemen(ctx, "alarm");
    }
}
