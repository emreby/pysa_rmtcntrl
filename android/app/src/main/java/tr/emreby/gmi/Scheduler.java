package tr.emreby.gmi;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/** 15 dakikalık arka plan kontrolü (Android'in izin verdiği en kısa aralık). */
final class Scheduler {
    static final String NAME = "gmi-kontrol";

    private Scheduler() {
    }

    static void ensure(Context ctx) {
        if (!ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE).getBoolean("bg_on", true)) return;
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(CheckWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(c).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(NAME);
    }

    /** Elle başlatılan kontrol: sonucu her zaman bildirim olarak gösterir (bildirimlerin çalıştığını doğrulamak için). */
    static void runOnce(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(CheckWorker.class).setConstraints(c)
                .setInputData(new Data.Builder().putBoolean("manual", true).build()).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(NAME + "-simdi", ExistingWorkPolicy.REPLACE, req);
    }
}
