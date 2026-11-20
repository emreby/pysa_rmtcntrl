package tr.emreby.gmi;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

    /** Android 12 öncesinde öncelikli iş kısa süreli ön plan hizmeti olarak çalışır; o sırada görünen sessiz bildirim. */
    @NonNull
    @Override
    public ForegroundInfo getForegroundInfo() {
        Context ctx = getApplicationContext();
        Notify.ensureChannels(ctx);
        Notification n = new NotificationCompat.Builder(ctx, Notify.CH_ISLEM)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("GMI Piyasa")
                .setContentText("Piyasa kontrol ediliyor…")
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setOngoing(true)
                .build();
        return new ForegroundInfo(33000, n);
    }

    /** Bu çalışmada internetten veri alınabildi mi: 1 evet, 0 denendi ama alınamadı, -1 hiç denenmedi. */
    static int veriDurumu(Px px) {
        boolean denendi = px.tgDone || !px.yahoo.isEmpty() || !px.spot.isEmpty() || px.tcmbDone;
        if (!denendi) return -1;
        if (px.tg != null || px.tcmbBody != null) return 1;
        for (Double v : px.spot.values()) if (v != null && !Double.isNaN(v)) return 1;
        for (Q q : px.yahoo.values()) if (q != null && q.ok()) return 1;
        return 0;
    }

    /** Arka plan çalışma geçmişi: [zaman, kaynak (p periyodik, a alarm, e elle), veri (1/0/-1)], son 200. */
    static void gecmisEkle(SharedPreferences p, long ms, String kaynak, int veri) {
        try {
            JSONArray a;
            try {
                a = new JSONArray(p.getString("bg_calisma", "[]"));
            } catch (Exception e) {
                a = new JSONArray();
            }
            a.put(new JSONArray().put(ms).put(kaynak).put(veri));
            JSONArray b = new JSONArray();
            for (int i = Math.max(0, a.length() - 200); i < a.length(); i++) b.put(a.get(i));
            p.edit().putString("bg_calisma", b.toString()).apply();
        } catch (Exception ignored) {
        }
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

    /** Son analizin destek/direnç seviyesi kırıldı mı? Yükseliş/düşüş eğilimini bozan kırılımları ayrıca belirtir. */
    static void levelCheck(List<A> out, Set<String> seen, JSONObject l, String key, Q q, String today) {
        if (l == null || q == null || !fresh(q, today)) return;
        String asset = l.optString("name", key);
        int dp = l.optInt("dp", 2);
        String unit = l.optString("unit", "");
        String u = unit.isEmpty() ? "" : " " + unit;
        String code = l.optString("code", "");
        boolean al = code.equals("AL") || code.equals("GAL"), sat = code.equals("SAT") || code.equals("GSAT");
        double s1 = l.optDouble("s1", Double.NaN), r1 = l.optDouble("r1", Double.NaN);
        String when = l.optString("asof", "son analiz");
        if (!Double.isNaN(s1) && q.price < s1)
            add(out, seen, key + "-s1-" + s1, asset, (al ? "Yükseliş eğilimi bozuldu: destek " : "Destek ") + n(s1, dp) + u + " kırıldı",
                    asset + " " + n(q.price, dp) + u + " · seviye " + when + " analizinden (" + l.optString("s1_note", "") + ")");
        if (!Double.isNaN(r1) && q.price > r1)
            add(out, seen, key + "-r1-" + r1, asset, (sat ? "Düşüş eğilimi bozuldu: direnç " : "Direnç ") + n(r1, dp) + u + " aşıldı",
                    asset + " " + n(q.price, dp) + u + " · seviye " + when + " analizinden (" + l.optString("r1_note", "") + ")");
    }

    /* ---------------- fiyat alarmları ---------------- */

    /** Alarm için fiyat ve kaynağı. */
    static final class P {
        double v = Double.NaN;
        String src = "";
    }

    /** Alarmların ihtiyaç duyduğu kaynaklar; her biri bu çalışmada en çok bir kez çekilir. */
    static final class Px {
        JSONObject tg;
        boolean tgDone;
        final Map<String, Q> yahoo = new HashMap<>();
        final Map<String, Double> spot = new HashMap<>();
        String tcmbBody;
        boolean tcmbDone;

        JSONObject truncgil() {
            if (!tgDone) {
                tg = CheckWorker.truncgil();
                tgDone = true;
            }
            return tg;
        }

        Q yahoo(String sym, boolean isFx) {
            Q q = yahoo.get(sym);
            if (q == null) {
                q = isFx ? fx(sym) : daily(sym);
                yahoo.put(sym, q);
            }
            return q;
        }

        double spot(String metal) {
            Double v = spot.get(metal);
            if (v == null) {
                v = Double.NaN;
                try {
                    Net.Resp r = Net.get("https://api.gold-api.com/price/" + metal);
                    if (r.code == 200) v = new JSONObject(r.body).optDouble("price", Double.NaN);
                } catch (Exception ignored) {
                }
                spot.put(metal, v);
            }
            return v;
        }

        /** TCMB günlük gösterge kuru (döviz satış). */
        double tcmb(String code) {
            if (!tcmbDone) {
                tcmbDone = true;
                try {
                    Net.Resp r = Net.get("https://www.tcmb.gov.tr/kurlar/today.xml");
                    if (r.code == 200) tcmbBody = r.body;
                } catch (Exception ignored) {
                }
            }
            if (tcmbBody == null) return Double.NaN;
            Matcher m = Pattern.compile("CurrencyCode=\"" + code + "\"[\\s\\S]*?<ForexSelling>([0-9.]+)</ForexSelling>").matcher(tcmbBody);
            try {
                return m.find() ? Double.parseDouble(m.group(1)) : Double.NaN;
            } catch (Exception e) {
                return Double.NaN;
            }
        }
    }

    static boolean tgPrice(Px px, String key, String field, P r) {
        JSONObject tg = px.truncgil();
        JSONObject o = tg == null ? null : tg.optJSONObject(key);
        if (o == null) return false;
        boolean alis = "alis".equals(field);
        double v = o.optDouble(alis ? "Buying" : "Selling", Double.NaN);
        if (Double.isNaN(v) || v <= 0) return false;
        r.v = v;
        r.src = (alis ? "alış" : "satış") + " · Truncgil";
        return true;
    }

    static boolean yahooPrice(Px px, String sym, boolean isFx, P r) {
        Q q = px.yahoo(sym, isFx);
        if (q == null || Double.isNaN(q.price) || q.err != null) return false;
        r.v = q.price;
        r.src = "Yahoo Finance";
        return true;
    }

    static boolean spotPrice(Px px, String metal, P r) {
        double v = px.spot(metal);
        if (Double.isNaN(v) || v <= 0) return false;
        r.v = v;
        r.src = "spot · gold-api.com";
        return true;
    }

    static boolean tcmbPrice(Px px, String code, P r) {
        double v = px.tcmb(code);
        if (Double.isNaN(v) || v <= 0) return false;
        r.v = v;
        r.src = "TCMB gösterge kuru";
        return true;
    }

    /** Varlığın fiyatı; ana kaynak alınamazsa yedek kaynağa geçer. */
    static P alarmPrice(Px px, String asset, String field) {
        P r = new P();
        switch (asset) {
            case "GRAM": tgPrice(px, "GRA", field, r); break;
            case "CEYREK": tgPrice(px, "CEYREKALTIN", field, r); break;
            case "YARIM": tgPrice(px, "YARIMALTIN", field, r); break;
            case "TAM": tgPrice(px, "TAMALTIN", field, r); break;
            case "ATA": if (!tgPrice(px, "ATAALTIN", field, r)) tgPrice(px, "CUMHURIYETALTINI", field, r); break;
            case "GUMUS_TL": tgPrice(px, "GUMUS", field, r); break;
            case "ONS": if (!spotPrice(px, "XAU", r)) yahooPrice(px, "GC=F", false, r); break;
            case "GUMUS_ONS": if (!spotPrice(px, "XAG", r)) yahooPrice(px, "SI=F", false, r); break;
            case "USD":
                if (!yahooPrice(px, "TRY=X", true, r) && !tgPrice(px, "USD", "satis", r)) tcmbPrice(px, "USD", r);
                break;
            case "EUR":
                if (!yahooPrice(px, "EURTRY=X", true, r) && !tgPrice(px, "EUR", "satis", r)) tcmbPrice(px, "EUR", r);
                break;
            case "BIST": yahooPrice(px, "XU100.IS", false, r); break;
            case "BTC": yahooPrice(px, "BTC-USD", false, r); break;
            case "BRENT": yahooPrice(px, "BZ=F", false, r); break;
            default: break;
        }
        return r;
    }

    /** Kurulu alarmları kontrol eder; çalanlar için bildirim gösterir. Çalan alarm sayısını döndürür. */
    static int checkAlarms(Context ctx, SharedPreferences p, Px px, String hhmm, List<A> fired) {
        JSONArray al;
        try {
            al = new JSONArray(Alarms.list(ctx));
        } catch (Exception e) {
            return 0;
        }
        JSONObject hits = Alarms.hits(ctx);
        int n = 0;
        for (int i = 0; i < al.length() && i < 50; i++) {
            JSONObject a = al.optJSONObject(i);
            if (a == null || !a.optBoolean("on", true)) continue;
            String id = a.optString("id", "");
            double target = a.optDouble("price", Double.NaN);
            if (id.isEmpty() || hits.has(id) || Double.isNaN(target)) continue;
            P r = alarmPrice(px, a.optString("asset", ""), a.optString("field", "satis"));
            if (Double.isNaN(r.v)) continue;
            boolean up = "ust".equals(a.optString("dir", "alt"));
            if (up ? r.v >= target : r.v <= target) {
                int dp = a.optInt("dp", 2);
                String unit = a.optString("unit", "");
                String u = unit.isEmpty() ? "" : " " + unit;
                String name = a.optString("name", a.optString("asset", ""));
                String title = "Fiyat alarmı: " + n(target, dp) + u + (up ? " üstü" : " altı");
                String text = name + " " + n(r.v, dp) + u + " (" + r.src + ") · " + hhmm + (a.optString("note", "").isEmpty() ? "" : " · " + a.optString("note", ""));
                if (Alarms.fire(ctx, id, r.v, r.src, "GMI · " + name + ": " + title, text)) {
                    n++;
                    if (fired != null) fired.add(new A("alarm-" + id, name, title, text));
                }
            }
        }
        return n;
    }

    /** Gün sonu özeti (kullanıcı açtıysa): hafta içi 18:00'den sonraki ilk kontrolde, günde bir kez. */
    static void dailySummary(Context ctx, SharedPreferences p, String today, int hour, String body) {
        if (!p.getBoolean("ozet_on", false) || hour < 18 || today.equals(p.getString("ozet_gun", "")) || body.isEmpty()) return;
        if (Notify.show(ctx, Notify.CH_OZET, "GMI · Günün özeti", body, 31000)) p.edit().putString("ozet_gun", today).apply();
    }

    static String priceLine(JSONObject px) {
        StringBuilder sb = new StringBuilder();
        String[][] k = {{"gram", "Gram altın "}, {"ons", "Ons "}, {"usdtry", "USD/TRY "}, {"bist", "BIST 100 "}};
        for (String[] x : k) {
            String v = px.optString(x[0], "");
            if (v.isEmpty()) continue;
            if (sb.length() > 0) sb.append(" · ");
            sb.append(x[1]).append(v);
        }
        return sb.toString();
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = ctx.getSharedPreferences("gmi", Context.MODE_PRIVATE);
        boolean manual = getInputData().getBoolean("manual", false);
        String kaynak = manual ? "e" : ("alarm".equals(getInputData().getString("kaynak")) ? "a" : "p");
        if (!p.getBoolean("bg_on", true) && !manual) return Result.success();
        long nowMs = System.currentTimeMillis();
        // Son çalışma zamanı: ayarlar ekranı arka plan kontrolünün telefonda gerçekten çalışıp çalışmadığını buradan gösterir.
        // Periyodik iş ile yedek alarm art arda gelirse ikincisi atlanır (aynı bildirim iki kez gitmesin).
        synchronized (CheckWorker.class) {
            long son = p.getLong("bg_last_ms", 0);
            if (!manual && nowMs >= son && nowMs - son < 8 * 60_000L) return Result.success();
            p.edit().putLong("bg_last_ms", nowMs).apply();
        }
        // yedek alarm zinciri koptuysa (zorla durdurma, açılış) yeniden kur
        if (!manual && p.getLong("tetik_sonraki", 0) < nowMs - 5 * 60_000L) Tetik.kur(ctx);
        String today = fmt("yyyy-MM-dd", nowMs), hhmm = fmt("HH:mm", nowMs);
        JSONObject log = new JSONObject();
        JSONArray errs = new JSONArray();
        Px px = new Px();
        try {
            log.put("time", today + " " + hhmm);
            log.put("ms", nowMs);
            log.put("manual", manual);
            Calendar cal = Calendar.getInstance(TRT);
            int dow = cal.get(Calendar.DAY_OF_WEEK);
            if (dow == Calendar.SATURDAY || dow == Calendar.SUNDAY) {
                int fired = checkAlarms(ctx, p, px, hhmm, null);
                log.put("note", "Hafta sonu: piyasalar kapalı; yalnız fiyat alarmları kontrol edildi.");
                log.put("alarms", fired);
                p.edit().putString("bglog", log.toString()).apply();
                gecmisEkle(p, nowMs, kaynak, veriDurumu(px));
                if (manual)
                    Notify.show(ctx, Notify.CH_OZET, "GMI · Kontrol tamamlandı", "Hafta sonu: piyasalar kapalı; fiyat alarmları kontrol edildi"
                            + (fired > 0 ? ", " + fired + " alarm çaldı." : ", çalan alarm yok.") + " Bildirimler çalışıyor.", 32000);
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
            px.tg = tg;
            px.tgDone = true;
            px.yahoo.put("GC=F", gold);
            px.yahoo.put("TRY=X", usd);
            px.yahoo.put("BZ=F", brent);
            px.yahoo.put("XU100.IS", bist);

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
            } else {
                // Yedek: spot ons (gold-api.com) × USD/TRY (Yahoo yoksa TCMB gösterge kuru)
                P o = new P(), u = new P();
                if (spotPrice(px, "XAU", o) && (yahooPrice(px, "TRY=X", true, u) || tcmbPrice(px, "USD", u))) {
                    gramPx = o.v * u.v / 31.1034768;
                    gramSrc = "teorik, yedek kaynak";
                }
            }
            if (!Double.isNaN(gramChg) && Math.abs(gramChg) >= 1.5)
                add(alerts, seen, "gram-yuzde" + sgn(gramChg), "Gram altın", "Günlük " + pct(gramChg), "Gram altın " + n(gramPx, 2) + " TL (" + gramSrc + "); eşik ±%1,5");
            Map<String, Q> got = new HashMap<>();
            got.put("GOLD_FUT", gold);
            got.put("USDTRY", usd);
            got.put("BRENT", brent);
            got.put("XU100", bist);
            JSONArray lvKeys = lv != null ? lv.names() : null;
            if (lvKeys != null) {
                for (int i = 0; i < lvKeys.length() && i < 10; i++) {
                    String key = lvKeys.getString(i);
                    JSONObject l = lv.optJSONObject(key);
                    if (l == null) continue;
                    Q q = got.get(key);
                    if (q == null) {
                        String sym = l.optString("sym", "");
                        if (sym.isEmpty()) continue;
                        q = l.optBoolean("fx", false) ? fx(sym) : daily(sym);
                        got.put(key, q);
                        if (q.err != null) errs.put(q.err);
                    }
                    levelCheck(alerts, seen, l, key, q, today);
                }
            }
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
            for (A a : alerts) Notify.show(ctx, "GMI · " + a.asset + ": " + a.title, a.detail + " · " + hhmm, id++);
            List<A> firedList = new ArrayList<>();
            int fired = checkAlarms(ctx, p, px, hhmm, firedList);
            alerts.addAll(firedList);
            for (A a : alerts)
                saved.put(new JSONObject().put("id", today + "-" + hhmm.replace(":", "") + "-" + a.key).put("time", today + " " + hhmm)
                        .put("asset", a.asset).put("title", a.title).put("detail", a.detail).put("level", "uyarı").put("session", "Arka plan kontrolü"));
            JSONArray trimmed = new JSONArray();
            for (int i = Math.max(0, saved.length() - 40); i < saved.length(); i++) trimmed.put(saved.get(i));

            SharedPreferences.Editor ed = p.edit();
            ed.putStringSet("seen_" + today, seen);
            for (Map.Entry<String, ?> e : p.getAll().entrySet())
                if (e.getKey().startsWith("seen_") && !e.getKey().equals("seen_" + today)) ed.remove(e.getKey());
            ed.putString("bg_alerts", trimmed.toString());
            JSONObject pxs = new JSONObject();
            if (gold.ok()) pxs.put("ons", n(gold.price, 1) + " $ (" + pct(gold.chg) + ")");
            if (!Double.isNaN(gramPx)) pxs.put("gram", n(gramPx, 2) + " TL" + (Double.isNaN(gramChg) ? "" : " (" + pct(gramChg) + ")"));
            if (usd.ok()) pxs.put("usdtry", n(usd.price, 4) + " (" + pct(usd.chg) + ")");
            if (bist.ok()) pxs.put("bist", n(bist.price, 0) + " (" + pct(bist.chg) + ")");
            log.put("prices", pxs);
            log.put("new_alerts", alerts.size());
            log.put("alarms", fired);
            log.put("errors", errs);
            ed.putString("bglog", log.toString());
            ed.apply();
            gecmisEkle(p, nowMs, kaynak, veriDurumu(px));

            String line = priceLine(pxs);
            dailySummary(ctx, p, today, cal.get(Calendar.HOUR_OF_DAY), line);
            if (manual) {
                String t = alerts.isEmpty() ? "Kontrol tamamlandı: yeni uyarı yok" : "Kontrol tamamlandı: " + alerts.size() + " yeni uyarı";
                Notify.show(ctx, Notify.CH_OZET, "GMI · " + t, (line.isEmpty() ? "Fiyatlar alınamadı." : line)
                        + (errs.length() > 0 ? " · alınamayan veri: " + errs.length() : "") + " · Bildirimler çalışıyor.", 32000);
            }
        } catch (Exception e) {
            try {
                errs.put(String.valueOf(e.getMessage()));
                log.put("errors", errs);
            } catch (Exception ignored) {
            }
            p.edit().putString("bglog", log.toString()).apply();
            gecmisEkle(p, nowMs, kaynak, veriDurumu(px));
            if (manual) Notify.show(ctx, Notify.CH_OZET, "GMI · Kontrol tamamlanamadı", String.valueOf(e.getMessage()), 32000);
        }
        return Result.success();
    }
}
