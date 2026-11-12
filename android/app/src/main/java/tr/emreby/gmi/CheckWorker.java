package tr.emreby.gmi;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Arka plan kontrolü (yaklaşık 15 dakikada bir, telefon izin verdikçe).
 * Fiyatları telefondan çeker, eşikleri ve son analizin destek/direnç seviyelerini kontrol eder,
 * eşik aşılırsa bildirim gösterir. Aynı olay için günde bir kez uyarır.
 */
public class CheckWorker extends Worker {
    static final TimeZone TRT = TimeZone.getTimeZone("Europe/Istanbul");
    static final Locale TR = Locale.forLanguageTag("tr-TR");

    public CheckWorker(@NonNull Context c, @NonNull WorkerParameters p) {
        super(c, p);
    }

    static final class Q {
        double price = Double.NaN, prev = Double.NaN, chg = Double.NaN;
        long time = 0;
        String err = null;

        boolean ok() {
            return err == null && !Double.isNaN(price) && !Double.isNaN(chg);
        }
    }

    static final class A {
        final String key, asset, title, detail;

        A(String key, String asset, String title, String detail) {
            this.key = key;
            this.asset = asset;
            this.title = title;
            this.detail = detail;
        }
    }

    static String fmt(String p, long ms) {
        SimpleDateFormat f = new SimpleDateFormat(p, Locale.US);
        f.setTimeZone(TRT);
        return f.format(new Date(ms));
    }

    static String n(double v, int dp) {
        return String.format(TR, "%,." + dp + "f", v);
    }

    static String pct(double v) {
        return (v > 0 ? "+" : (v < 0 ? "−" : "")) + "%" + n(Math.abs(v), 2);
    }

    static String sgn(double v) {
        return v >= 0 ? "+" : "-";
    }

    static JSONObject chart(String sym, String range, String interval) throws Exception {
        String url = "https://query1.finance.yahoo.com/v8/finance/chart/" + URLEncoder.encode(sym, "UTF-8")
                + "?range=" + range + "&interval=" + interval + "&includePrePost=false";
        Net.Resp r = Net.get(url);
        if (r.code == 429) {
            Thread.sleep(1500);
            r = Net.get(url.replace("query1", "query2"));
        }
        if (r.code != 200) throw new Exception("HTTP " + r.code);
        JSONArray res = new JSONObject(r.body).getJSONObject("chart").optJSONArray("result");
        if (res == null || res.length() == 0) throw new Exception("veri yok");
        return res.getJSONObject(0);
    }

    /** Günlük değişim: güncel fiyat ve bir önceki günlük kapanış. */
    static Q daily(String sym) {
        Q q = new Q();
        try {
            JSONObject res = chart(sym, "5d", "1d");
            JSONObject meta = res.getJSONObject("meta");
            JSONArray cl = res.getJSONObject("indicators").getJSONArray("quote").getJSONObject(0).getJSONArray("close");
            List<Double> c = new ArrayList<>();
            for (int i = 0; i < cl.length(); i++) if (!cl.isNull(i)) c.add(cl.getDouble(i));
            if (c.size() < 2) throw new Exception("az veri");
            q.price = meta.has("regularMarketPrice") ? meta.getDouble("regularMarketPrice") : c.get(c.size() - 1);
            q.prev = c.get(c.size() - 2);
            q.time = meta.optLong("regularMarketTime", 0);
            q.chg = 100 * (q.price / q.prev - 1);
        } catch (Exception e) {
            q.err = sym + ": " + e.getMessage();
        }
        return q;
    }

    /** Döviz: değişim New York kapanışına (17:00 NY) göre; Yahoo'nun günlük döviz mumları bir gün kayık geldiği için saatlik veriden. */
    static Q fx(String sym) {
        Q q = new Q();
        try {
            JSONObject res = chart(sym, "5d", "60m");
            JSONObject meta = res.getJSONObject("meta");
            JSONArray ts = res.getJSONArray("timestamp");
            JSONArray cl = res.getJSONObject("indicators").getJSONArray("quote").getJSONObject(0).getJSONArray("close");
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("America/New_York"));
            String cur = null;
            double curLast = Double.NaN, prevLast = Double.NaN;
            for (int i = 0; i < ts.length(); i++) {
                if (cl.isNull(i)) continue;
                String k = f.format(new Date((ts.getLong(i) + 7 * 3600) * 1000L));
                if (!k.equals(cur)) {
                    if (cur != null) prevLast = curLast;
                    cur = k;
                }
                curLast = cl.getDouble(i);
            }
            if (Double.isNaN(prevLast)) throw new Exception("tek seans");
            q.price = meta.has("regularMarketPrice") ? meta.getDouble("regularMarketPrice") : curLast;
            q.prev = prevLast;
            q.time = meta.optLong("regularMarketTime", 0);
            q.chg = 100 * (q.price / q.prev - 1);
        } catch (Exception e) {
            q.err = sym + ": " + e.getMessage();
        }
        return q;
    }

    static JSONObject truncgil() {
        try {
            Net.Resp r = Net.get("https://finans.truncgil.com/v4/today.json");
            if (r.code != 200) return null;
            return new JSONObject(r.body);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean fresh(Q q, String today) {
        return q.ok() && q.time > 0 && fmt("yyyy-MM-dd", q.time * 1000L).equals(today);
    }

    static void add(List<A> out, Set<String> seen, String key, String asset, String title, String detail) {
        if (seen.contains(key)) return;
        seen.add(key);
        out.add(new A(key, asset, title, detail));
    }

    static void levelCheck(List<A> out, Set<String> seen, JSONObject lv, String key, String asset, Q q, String today, int dp, String unit) {
        if (lv == null || !fresh(q, today)) return;
        JSONObject l = lv.optJSONObject(key);
        if (l == null) return;
        double s1 = l.optDouble("s1", Double.NaN), r1 = l.optDouble("r1", Double.NaN);
        String when = l.optString("asof", "son analiz");
        if (!Double.isNaN(s1) && q.price < s1)
            add(out, seen, key + "-s1-" + s1, asset, "Destek " + n(s1, dp) + unit + " kırıldı",
                    asset + " " + n(q.price, dp) + unit + " · seviye " + when + " analizinden (" + l.optString("s1_note", "") + ")");
        if (!Double.isNaN(r1) && q.price > r1)
            add(out, seen, key + "-r1-" + r1, asset, "Direnç " + n(r1, dp) + unit + " aşıldı",
                    asset + " " + n(q.price, dp) + unit + " · seviye " + when + " analizinden (" + l.optString("r1_note", "") + ")");
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE);
        if (!p.getBoolean("bg_on", true)) return Result.success();
        long nowMs = System.currentTimeMillis();
        String today = fmt("yyyy-MM-dd", nowMs), hhmm = fmt("HH:mm", nowMs);
        JSONObject log = new JSONObject();
        JSONArray errs = new JSONArray();
        try {
            log.put("time", today + " " + hhmm);
            Calendar cal = Calendar.getInstance(TRT);
            int dow = cal.get(Calendar.DAY_OF_WEEK);
            if (dow == Calendar.SATURDAY || dow == Calendar.SUNDAY) {
                log.put("note", "Hafta sonu: piyasalar kapalı, kontrol yapılmadı.");
                p.edit().putString("bglog", log.toString()).apply();
                return Result.success();
            }
            JSONObject st = new JSONObject(p.getString("state", "{}"));
            JSONObject lv = st.optJSONObject("levels");
            Set<String> seen = new HashSet<>(p.getStringSet("seen_" + today, new HashSet<>()));
            List<A> alerts = new ArrayList<>();

            Q gold = daily("GC=F"), usd = fx("TRY=X"), brent = daily("BZ=F"), bist = daily("XU100.IS"), vix = daily("^VIX"), tnx = daily("^TNX");
            for (Q q : new Q[]{gold, usd, brent, bist, vix, tnx}) if (q.err != null) errs.put(q.err);
            JSONObject tg = truncgil();
            if (tg == null) errs.put("Truncgil alınamadı");

            if (fresh(gold, today) && Math.abs(gold.chg) >= 1.5)
                add(alerts, seen, "ons-yuzde" + sgn(gold.chg), "Ons altın", "Günlük " + pct(gold.chg), "COMEX vadeli " + n(gold.price, 1) + " $; eşik ±%1,5");
            double gramChg = Double.NaN, gramPx = Double.NaN;
            String gramSrc = "";
            if (tg != null && tg.optJSONObject("GRA") != null) {
                JSONObject g = tg.getJSONObject("GRA");
                gramChg = g.optDouble("Change", Double.NaN);
                gramPx = g.optDouble("Selling", Double.NaN);
                gramSrc = "Truncgil";
            } else if (gold.ok() && usd.ok()) {
                gramChg = ((1 + gold.chg / 100) * (1 + usd.chg / 100) - 1) * 100;
                gramPx = gold.price * usd.price / 31.1034768;
                gramSrc = "teorik";
            }
            if (!Double.isNaN(gramChg) && Math.abs(gramChg) >= 1.5)
                add(alerts, seen, "gram-yuzde" + sgn(gramChg), "Gram altın", "Günlük " + pct(gramChg), "Gram altın " + n(gramPx, 2) + " TL (" + gramSrc + "); eşik ±%1,5");
            levelCheck(alerts, seen, lv, "GOLD_FUT", "Ons altın", gold, today, 1, " $");
            levelCheck(alerts, seen, lv, "USDTRY", "USD/TRY", usd, today, 4, "");
            if (usd.ok() && Math.abs(usd.chg) >= 0.5)
                add(alerts, seen, "usdtry-yuzde" + sgn(usd.chg), "USD/TRY", "Günlük " + pct(usd.chg), "USD/TRY " + n(usd.price, 4) + " (NY kapanışına göre); eşik ±%0,5");
            if (fresh(brent, today) && Math.abs(brent.chg) >= 3)
                add(alerts, seen, "brent-yuzde" + sgn(brent.chg), "Brent", "Günlük " + pct(brent.chg), "Brent " + n(brent.price, 2) + " $; eşik ±%3");
            if (fresh(bist, today) && Math.abs(bist.chg) >= 2)
                add(alerts, seen, "bist-yuzde" + sgn(bist.chg), "BIST 100", "Günlük " + pct(bist.chg), "BIST 100 " + n(bist.price, 0) + " (≈15 dk gecikmeli); eşik ±%2");
            if (fresh(vix, today) && vix.price >= 25)
                add(alerts, seen, "vix-25", "VIX", "VIX " + n(vix.price, 2) + " (25 üstü)", "Piyasada oynaklık beklentisi yüksek.");
            if (fresh(vix, today) && vix.chg >= 15)
                add(alerts, seen, "vix-sicrama", "VIX", "Günlük " + pct(vix.chg), "VIX " + n(vix.price, 2) + "; eşik +%15");
            if (fresh(tnx, today)) {
                double bp = (tnx.price - tnx.prev) * 100;
                if (Math.abs(bp) >= 10)
                    add(alerts, seen, "us10y-bp" + sgn(bp), "ABD 10Y faiz", (bp > 0 ? "+" : "−") + n(Math.abs(bp), 1) + " bp", "10 yıllık faiz %" + n(tnx.price, 3) + "; eşik ±10 bp");
            }

            JSONArray saved;
            try {
                saved = new JSONArray(p.getString("bg_alerts", "[]"));
            } catch (Exception e) {
                saved = new JSONArray();
            }
            int id = (int) (nowMs / 1000 % 100000);
            for (A a : alerts) {
                Notify.show(ctx, "GMI · " + a.asset + ": " + a.title, a.detail + " · " + hhmm, id++);
                saved.put(new JSONObject().put("id", today + "-" + hhmm.replace(":", "") + "-" + a.key).put("time", today + " " + hhmm)
                        .put("asset", a.asset).put("title", a.title).put("detail", a.detail).put("level", "uyarı").put("session", "Arka plan kontrolü"));
            }
            JSONArray trimmed = new JSONArray();
            for (int i = Math.max(0, saved.length() - 40); i < saved.length(); i++) trimmed.put(saved.get(i));

            SharedPreferences.Editor ed = p.edit();
            ed.putStringSet("seen_" + today, seen);
            for (Map.Entry<String, ?> e : p.getAll().entrySet())
                if (e.getKey().startsWith("seen_") && !e.getKey().equals("seen_" + today)) ed.remove(e.getKey());
            ed.putString("bg_alerts", trimmed.toString());
            JSONObject px = new JSONObject();
            if (gold.ok()) px.put("ons", n(gold.price, 1) + " $ (" + pct(gold.chg) + ")");
            if (!Double.isNaN(gramPx)) px.put("gram", n(gramPx, 2) + " TL (" + pct(gramChg) + ")");
            if (usd.ok()) px.put("usdtry", n(usd.price, 4) + " (" + pct(usd.chg) + ")");
            log.put("prices", px);
            log.put("new_alerts", alerts.size());
            log.put("errors", errs);
            ed.putString("bglog", log.toString());
            ed.apply();
        } catch (Exception e) {
            try {
                errs.put(String.valueOf(e.getMessage()));
                log.put("errors", errs);
            } catch (Exception ignored) {
            }
            p.edit().putString("bglog", log.toString()).apply();
        }
        return Result.success();
    }
}
