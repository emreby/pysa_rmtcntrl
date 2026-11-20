package tr.emreby.gmi;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

final class Notify {
    /** Eşik uyarıları ve fiyat alarmları (sesli, üstte görünür). */
    static final String CH = "gmi_uyari";
    /** Günlük özet ve elle başlatılan kontrolün sonucu (normal önem). */
    static final String CH_OZET = "gmi_ozet";
    /** Eski Android sürümlerinde (12 öncesi) öncelikli kontrol sırasında birkaç saniye görünen sessiz bildirim. */
    static final String CH_ISLEM = "gmi_islem";

    private Notify() {
    }

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(CH) == null) {
            NotificationChannel ch = new NotificationChannel(CH, "Piyasa uyarıları", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Eşik aşıldığında ve fiyat alarmların çaldığında gelen uyarılar");
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_OZET) == null) {
            NotificationChannel ch = new NotificationChannel(CH_OZET, "Özet ve kontrol sonucu", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Günlük kapanış özeti ve elle başlatılan kontrolün sonucu");
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_ISLEM) == null) {
            NotificationChannel ch = new NotificationChannel(CH_ISLEM, "Arka plan kontrolü sürüyor", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Eski Android sürümlerinde kontrol sırasında birkaç saniye görünür");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    static void show(Context ctx, String title, String text, int id) {
        show(ctx, CH, title, text, id);
    }

    /** Bildirimi gösterir; izin yoksa false döner. */
    static boolean show(Context ctx, String channel, String title, String text, int id) {
        ensureChannels(ctx);
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(CH.equals(channel) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pi);
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
            return true;
        } catch (SecurityException e) {
            // Bildirim izni verilmemiş.
            return false;
        }
    }

    /** Kanalın önem düzeyi: kullanıcı kanalı kapattıysa 0. Android 8 öncesinde kanal olmadığı için -1. */
    static int channelImportance(Context ctx, String channel) {
        if (Build.VERSION.SDK_INT < 26) return -1;
        ensureChannels(ctx);
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel ch = nm == null ? null : nm.getNotificationChannel(channel);
        return ch == null ? -1 : ch.getImportance();
    }
}
