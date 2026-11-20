package tr.emreby.gmi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Telefon açılınca ve uygulama güncellenince arka plan kontrolünü yeniden kurar (alarmlar açılışta silinir). */
public class Acilis extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) Scheduler.ensure(ctx);
    }
}
