package tr.emreby.gmi;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/**
 * Kullanıcının fiyat alarmları. Alarm listesini arayüz yazar ("alarms"); çalan alarmların kaydını ("alarm_hits")
 * hem arka plan kontrolü hem de uygulama açıkken arayüz yazabildiği için kayıt tek kilitle yapılır:
 * böylece aynı alarm için iki kez bildirim gelmez. Alarmlar tek seferliktir; yeniden kurulan alarm yeni kimlik alır.
 */
final class Alarms {
    private static final Object LOCK = new Object();

    private Alarms() {
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE);
    }

    static String list(Context ctx) {
        return prefs(ctx).getString("alarms", "[]");
    }

    /** Listeyi kaydeder; artık listede olmayan alarmların çalma kayıtlarını siler. */
    static void setList(Context ctx, String json) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            Set<String> ids = new HashSet<>();
            try {
                JSONArray a = new JSONArray(json);
                for (int i = 0; i < a.length(); i++) {
                    JSONObject o = a.optJSONObject(i);
                    if (o != null) ids.add(o.optString("id", ""));
                }
            } catch (Exception e) {
                return;
            }
            JSONObject h = read(p);
            Iterator<String> it = h.keys();
            Set<String> drop = new HashSet<>();
            while (it.hasNext()) {
                String k = it.next();
                if (!ids.contains(k)) drop.add(k);
            }
            for (String k : drop) h.remove(k);
            p.edit().putString("alarms", json).putString("alarm_hits", h.toString()).commit();
        }
    }

    static JSONObject hits(Context ctx) {
        synchronized (LOCK) {
            return read(prefs(ctx));
        }
    }

    private static JSONObject read(SharedPreferences p) {
        try {
            return new JSONObject(p.getString("alarm_hits", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    /** Alarmı çalmış olarak kaydeder ve bildirim gösterir; daha önce çaldıysa hiçbir şey yapmaz. */
    static boolean fire(Context ctx, String id, double px, String src, String title, String text) {
        if (id == null || id.isEmpty()) return false;
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            JSONObject h = read(p);
            if (h.has(id)) return false;
            try {
                JSONObject o = new JSONObject().put("t", CheckWorker.fmt("yyyy-MM-dd HH:mm", System.currentTimeMillis())).put("src", src == null ? "" : src);
                if (!Double.isNaN(px) && !Double.isInfinite(px)) o.put("px", px);
                h.put(id, o);
            } catch (Exception ignored) {
            }
            p.edit().putString("alarm_hits", h.toString()).commit();
        }
        Notify.show(ctx, title, text, 20000 + (id.hashCode() & 0x7fff));
        return true;
    }
}
