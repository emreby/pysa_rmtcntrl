package tr.emreby.gmi;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/** 15 dakikalık arka plan kontrolü (Android'in izin verdiği en kısa aralık). */
final class Scheduler {
    static final String NAME = "gmi-kontrol";

    private Scheduler() {
    }

    /** Periyodik iş (WorkManager) ve yedek alarm zinciri (Tetik). */
    static void ensure(Context ctx) {
        if (!ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE).getBoolean("bg_on", true)) return;
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(CheckWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(c).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req);
        Tetik.kur(ctx);
    }

    static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(NAME);
        WorkManager.getInstance(ctx).cancelUniqueWork(NAME + "-alarm");
        Tetik.iptal(ctx);
    }

    /** Alarmın başlattığı öncelikli kontrol; öncelik kotası bittiyse normal iş olarak çalışır. */
    static void hemen(Context ctx, String kaynak) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(CheckWorker.class).setConstraints(c)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setInputData(new Data.Builder().putString("kaynak", kaynak).build()).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(NAME + "-alarm", ExistingWorkPolicy.KEEP, req);
    }

    /** Elle başlatılan kontrol: sonucu her zaman bildirim olarak gösterir (bildirimlerin çalıştığını doğrulamak için). */
    static void runOnce(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(CheckWorker.class).setConstraints(c)
                .setInputData(new Data.Builder().putBoolean("manual", true).build()).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(NAME + "-simdi", ExistingWorkPolicy.REPLACE, req);
    }
}
