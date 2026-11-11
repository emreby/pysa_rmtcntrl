#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GMI mobil uygulama verisi üretici — app_data.json (şema gmi-app/1)

Telefon uygulaması (GitHub Pages) ve Claude paneli bu dosyayı okur. GitHub Actions
akışı (engine/pipeline.py) her çalışmada dosyayı yeniden üretir.

Kullanım:
  python3 build_app_data.py --out OUT.json
      [--prev PREV.json]                                  önceki dosya; verilmeyen bölümler korunur
      [--snapshots price_snapshots.csv --snap-session S]  fiyatlar ve gram altın (S seansının satırları)
      [--tech technical_summary.csv]                      teknik görünüm + senaryo eşikleri (tam seans)
      [--inputs <tarih>_<SEANS>_inputs.json]              sikke fiyatları ve primleri (Harem)
      [--forecast forecast_log.csv]                       değerlendirilmiş tahminler
      [--patch PATCH.json]                                status, alerts_add, agenda, gold_extra, ...

PATCH.json anahtarları:
  status      : dict — summary, session, updated_trt, next_session, note, report, tech_asof (birleştirilir)
  alerts_add  : list — yeni uyarılar (id, time, asset, title, detail, level, session); en başa eklenir
  agenda      : list — gündemin tamamı (id, kind, when, sort, title, detail, assets, impact, importance, source)
  <bölüm>     : list — o bölümü tümüyle değiştirir (prices, gold, tech, scenarios, perf)

Kurallar: veri uydurulmaz. Bulunamayan değer null kalır. Zamanlar TSİ'dir.
"""
import argparse
import csv
import json
import math
import re
import sys
from datetime import datetime, timedelta, timezone

TRT = timezone(timedelta(hours=3))
SCHEMA = "gmi-app/1"
OZ = 31.1034768
SECTIONS = ["status", "prices", "gold", "tech", "scenarios", "alerts", "agenda", "perf"]

# anahtar: (ad, grup, sıra, birim, ondalık, gecikme, seans (açılış, kapanış) TSİ ya da None)
ASSETS = {
    "GOLD_FUT": ("Ons altın (COMEX vadeli)", "Altın ve metaller", 10, "$", 1, "≈10 dk gecikmeli", None),
    "ONS_SPOT_HAREM": ("Ons altın (spot, Harem)", "Altın ve metaller", 11, "$", 2, "anlık", None),
    "GRAM_ALTIN_TEORIK": ("Gram altın (teorik)", "Altın ve metaller", 12, "TL", 2, "hesap", None),
    "GRAM_ALTIN_DOVIZ": ("Gram altın (doviz.com)", "Altın ve metaller", 13, "TL", 2, "anlık", None),
    "GRAM_ALTIN_HAREM": ("Gram altın perakende (Harem)", "Altın ve metaller", 14, "TL", 2, "anlık", None),
    "HAS_ALTIN_HAREM": ("HAS altın (Harem)", "Altın ve metaller", 15, "TL", 2, "anlık", None),
    "ONS_SPOT_YEREL": ("Ons altın (spot)", "Altın ve metaller", 11, "$", 2, "anlık", None),
    "GRAM_ALTIN_YEREL": ("Gram altın perakende", "Altın ve metaller", 13, "TL", 2, "anlık", None),
    "GRAM_ALTIN_YEREL2": ("Gram altın perakende (2. kaynak)", "Altın ve metaller", 14, "TL", 2, "anlık", None),
    "HAS_ALTIN_YEREL": ("HAS altın", "Altın ve metaller", 15, "TL", 2, "anlık", None),
    "SILVER_FUT": ("Gümüş (COMEX vadeli)", "Altın ve metaller", 16, "$", 3, "≈10 dk gecikmeli", None),
    "PLAT_FUT": ("Platin (vadeli)", "Altın ve metaller", 17, "$", 1, "≈10 dk gecikmeli", None),
    "PALL_FUT": ("Paladyum (vadeli)", "Altın ve metaller", 18, "$", 1, "≈10 dk gecikmeli", None),
    "USDTRY": ("USD/TRY", "Döviz", 20, "", 4, "anlık", None),
    "EURTRY": ("EUR/TRY", "Döviz", 21, "", 4, "anlık", None),
    "GBPTRY": ("GBP/TRY", "Döviz", 22, "", 4, "anlık", None),
    "EURUSD": ("EUR/USD", "Döviz", 23, "", 4, "anlık", None),
    "USDJPY": ("USD/JPY", "Döviz", 24, "", 3, "anlık", None),
    "DXY": ("Dolar endeksi (DXY)", "Döviz", 25, "", 2, "≈10 dk gecikmeli", None),
    "BRENT": ("Brent petrol", "Enerji ve emtia", 30, "$", 2, "≈10 dk gecikmeli", None),
    "WTI": ("WTI petrol", "Enerji ve emtia", 31, "$", 2, "≈10 dk gecikmeli", None),
    "NATGAS": ("Doğal gaz (Henry Hub)", "Enerji ve emtia", 32, "$", 3, "≈10 dk gecikmeli", None),
    "COPPER": ("Bakır ($/libre)", "Enerji ve emtia", 33, "$", 4, "≈10 dk gecikmeli", None),
    "XU100": ("BIST 100", "Borsalar", 40, "", 2, "≈15 dk gecikmeli", ("10:00", "18:00")),
    "ES_FUT": ("S&P 500 vadeli", "Borsalar", 41, "", 2, "≈10 dk gecikmeli", None),
    "SPX": ("S&P 500", "Borsalar", 42, "", 2, "seans içi", ("17:30", "24:00")),
    "NDX": ("Nasdaq 100", "Borsalar", 43, "", 2, "seans içi", ("17:30", "24:00")),
    "DJI": ("Dow Jones", "Borsalar", 44, "", 2, "seans içi", ("17:30", "24:00")),
    "DAX": ("DAX", "Borsalar", 45, "", 2, "≈15 dk gecikmeli", ("11:00", "19:30")),
    "NIKKEI": ("Nikkei 225", "Borsalar", 46, "", 2, "≈15–20 dk gecikmeli", ("03:00", "09:30")),
    "HSI": ("Hang Seng", "Borsalar", 47, "", 2, "≈15–20 dk gecikmeli", ("04:30", "11:00")),
    "SSE": ("Şanghay Bileşik", "Borsalar", 48, "", 2, "≈15–20 dk gecikmeli", ("04:30", "10:00")),
    "US10Y": ("ABD 10 yıllık faiz", "Faiz ve risk", 50, "%", 3, "≈15 dk gecikmeli", None),
    "VIX": ("VIX oynaklık endeksi", "Faiz ve risk", 51, "", 2, "≈15 dk gecikmeli", None),
    "BTC": ("Bitcoin", "Kripto", 60, "$", 0, "anlık", None),
}
COINS = [("CEYREK", "Çeyrek altın", "ceyrek"), ("YARIM", "Yarım altın", "yarim"),
         ("TAM", "Tam altın", "tam"), ("ATA", "Cumhuriyet (Ata) altını", "ata")]
SOURCE_NAMES = {"yahoo": "Yahoo Finance", "yahoo+nyclose_fix": "Yahoo Finance (NY kapanışına göre)",
                "haremaltin": "Harem Altın", "doviz.com": "doviz.com"}

REQUIRED = {
    "status": ["key", "updated_trt", "session", "summary"],
    "prices": ["key", "name", "group", "order", "unit", "dp", "kind", "time", "source"],
    "gold": ["metric", "label", "unit", "time", "source"],
    "tech": ["key", "name", "trend", "daily_score", "short_score", "asof", "dp"],
    "scenarios": ["key", "name", "up_level", "down_level", "asof", "dp"],
    "alerts": ["id", "time", "asset", "title", "level"],
    "agenda": ["id", "kind", "when", "sort", "title"],
    "perf": ["id", "issued", "key", "ref_price", "daily_bias", "actual_price", "direction_hit"],
}


def num(x):
    """'4012' -> 4012.0 ; '' / None / 'nan' -> None"""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return None if (isinstance(x, float) and not math.isfinite(x)) else float(x)
    s = str(x).strip()
    if not s or s.lower() in ("nan", "none", "null", "-", "—"):
        return None
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except ValueError:
        return None


def num_tr(s):
    """Türkçe biçimli sayı: '4.050,0' -> 4050.0 ; '11.607' -> 11607.0 ; '50,2500' -> 50.25
    build_tables biçiminde ondalık ayırıcı her zaman ",", nokta her zaman binlik ayırıcıdır."""
    s = s.strip().replace("−", "-").replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def minutes(hhmm):
    m = re.match(r"^(\d{1,2}):(\d{2})", hhmm or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def r(x, nd=4):
    return None if x is None else round(x, nd)


def parse_levels(text):
    """'4.050,0 (psikolojik, dip) | 3.993,8 (dip, pivot S1)' -> [(4050.0, 'psikolojik, dip'), ...]"""
    out = []
    for part in (text or "").split("|"):
        m = re.match(r"\s*([-−]?[\d.,]+)\s*(?:\((.*)\))?\s*$", part)
        if m:
            v = num_tr(m.group(1))
            if v is not None:
                out.append((v, (m.group(2) or "").strip()))
    return out


def build_prices(path, session):
    rows = []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["session"] != session:
                continue
            key = row["key"]
            if key not in ASSETS:
                continue
            name, group, order, unit, dp, lat, sess = ASSETS[key]
            ts = row["ts_trt"]
            ts_min = minutes(ts.split(" ")[1]) if " " in ts else None
            dt = row["data_time_trt"]
            dmin = minutes(dt)
            kind = lat
            if dmin is not None and ts_min is not None and dmin > ts_min + 5:
                kind = "önceki gün"
            elif sess and dmin is not None:
                o, c = minutes(sess[0]), minutes(sess[1])
                if not (o <= dmin < c):
                    kind = "kapanış"
            price = row["price"]
            bid = ask = value = None
            if "/" in price:
                a, b = price.split("/", 1)
                bid, ask = num(a), num(b)
            else:
                value = num(price)
            prev = num(row.get("prev_close"))
            chg = num(row.get("chg_pct"))
            chg_abs = r(value - prev, 6) if (value is not None and prev is not None) else None
            src = row["source"]
            rows.append({
                "key": key, "name": name, "group": group, "order": order, "unit": unit, "dp": dp,
                "value": value, "bid": bid, "ask": ask, "prev_close": prev,
                "chg_pct": chg, "chg_abs": chg_abs,
                "chg_bp": r(chg_abs * 100, 1) if (key == "US10Y" and chg_abs is not None) else None,
                "kind": kind, "time": dt, "source": SOURCE_NAMES.get(src, src),
                "session": session, "ts_trt": ts,
            })
    rows.sort(key=lambda x: x["order"])
    return rows


def build_gold(prices):
    """Gram altın satırları (teorik, HAS, perakende, doviz) — fiyat anlık görüntüsünden."""
    p = {x["key"]: x for x in prices}
    out = []
    theo = p.get("GRAM_ALTIN_TEORIK")
    tv = theo["value"] if theo else None
    if theo:
        out.append({"metric": "THEO", "label": "Teorik gram (ons × USD/TRY ÷ 31,1035)", "unit": "TL",
                    "value": tv, "bid": None, "ask": None, "theo": tv, "diff_bid_pct": None,
                    "diff_ask_pct": None, "spread_pct": None, "time": theo["time"],
                    "source": theo.get("source") if theo.get("source", "").startswith("hesap") else "hesap: ons × USD/TRY", "order": 1})
    for key, metric, label, order in [("HAS_ALTIN_HAREM", "HAS", "HAS altın (Harem)", 2),
                                      ("GRAM_ALTIN_HAREM", "RETAIL", "Gram altın – perakende (Harem)", 3),
                                      ("GRAM_ALTIN_DOVIZ", "DOVIZ", "Gram altın (doviz.com)", 4),
                                      ("HAS_ALTIN_YEREL", "HAS", "HAS altın", 2),
                                      ("GRAM_ALTIN_YEREL", "RETAIL", "Gram altın – perakende", 3),
                                      ("GRAM_ALTIN_YEREL2", "RETAIL2", "Gram altın – perakende", 4)]:
        x = p.get(key)
        if not x:
            continue
        if key.endswith("_YEREL") or key.endswith("_YEREL2"):
            label = f"{label} ({x['source']})"
        bid, ask, val = x["bid"], x["ask"], x["value"]
        out.append({
            "metric": metric, "label": label, "unit": "TL", "value": val, "bid": bid, "ask": ask, "theo": tv,
            "diff_bid_pct": r((bid / tv - 1) * 100, 2) if (bid and tv) else (r((val / tv - 1) * 100, 2) if (val and tv) else None),
            "diff_ask_pct": r((ask / tv - 1) * 100, 2) if (ask and tv) else None,
            "spread_pct": r((ask - bid) / bid * 100, 2) if (bid and ask) else None,
            "time": x["time"], "source": x["source"], "order": order,
        })
    return out


def build_coins(inputs_path):
    with open(inputs_path, encoding="utf-8") as f:
        inp = json.load(f)
    harem = inp.get("harem")
    if harem is None:
        harem = next((v for k, v in inp.items() if k.startswith("harem") and isinstance(v, dict)), None)
    if not harem:
        harem = next((v for v in (inp.get("yerel"), inp.get("yerel2")) if isinstance(v, dict) and v.get("yeni_ceyrek")), None)
    spec = inp.get("coin_specs_g") or {}
    usd = num(inp.get("usdtry_for_theo"))
    theo_gram = num(inp.get("theo_gram"))
    if theo_gram is None and harem and usd is not None and harem.get("ons_usd"):
        theo_gram = sum(harem["ons_usd"]) / 2 * usd / OZ
    if not harem or not spec or theo_gram is None:
        return []
    mil = spec.get("milyem", 0.9166)
    out = []
    for i, (metric, label, sk) in enumerate(COINS):
        pair = harem.get("yeni_" + sk)
        gross = spec.get(sk)
        if not pair or gross is None:
            continue
        bid, ask = num(pair[0]), num(pair[1])
        theo = theo_gram * gross * mil
        out.append({
            "metric": metric, "label": label, "unit": "TL", "value": None, "bid": bid, "ask": ask,
            "theo": r(theo, 2), "diff_bid_pct": r((bid / theo - 1) * 100, 2), "diff_ask_pct": r((ask / theo - 1) * 100, 2),
            "spread_pct": r((ask - bid) / bid * 100, 2), "time": harem.get("time", ""),
            "source": f"{harem.get('source', 'Harem Altın')}; teorik: has içerik (brüt × 0,9166) × teorik gram", "order": 10 + i,
            "has_g": r(gross * mil, 4),
        })
    return out


def build_tech(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = row["key"]
            dp = ASSETS.get(key, (None, None, None, None, 2))[4]
            sup = parse_levels(row.get("supports"))
            res = parse_levels(row.get("resistances"))
            d = {
                "key": key, "name": row["name"], "price": num(row.get("price_engine")), "trend": row.get("trend") or "",
                "daily_score": num(row.get("daily_score")), "short_score": num(row.get("short_score")),
                "rsi": num(row.get("rsi")), "adx": num(row.get("adx")), "atr": num(row.get("atr14")),
                "daily_bias": row.get("daily_bias") or "", "short_bias": row.get("short_bias") or "",
                "asof": f"{row.get('date', '')} {row.get('session', '')}".strip(), "dp": dp,
                "order": ASSETS.get(key, (None, None, 99))[2],
            }
            for i in range(3):
                d[f"s{i+1}"] = sup[i][0] if i < len(sup) else None
                d[f"s{i+1}_note"] = sup[i][1] if i < len(sup) else ""
                d[f"r{i+1}"] = res[i][0] if i < len(res) else None
                d[f"r{i+1}_note"] = res[i][1] if i < len(res) else ""
            rows.append(d)
    rows.sort(key=lambda x: x["order"])
    return rows


def build_scenarios(tech):
    """RUNBOOK kuralı: fiyattan en az 0,25×ATR uzaktaki ilk iki destek/direnç."""
    out = []
    for t in tech:
        p, atr = t["price"], t["atr"]
        if p is None or atr is None:
            continue
        gap = 0.25 * atr
        sup = [t[f"s{i}"] for i in (1, 2, 3) if t[f"s{i}"] is not None and p - t[f"s{i}"] >= gap]
        res = [t[f"r{i}"] for i in (1, 2, 3) if t[f"r{i}"] is not None and t[f"r{i}"] - p >= gap]
        if not sup and not res:
            continue
        out.append({
            "key": t["key"], "name": t["name"], "dp": t["dp"], "asof": t["asof"], "order": t["order"],
            "up_level": res[0] if res else None, "up_target": res[1] if len(res) > 1 else None,
            "down_level": sup[0] if sup else None, "down_target": sup[1] if len(sup) > 1 else None,
        })
    return out


def build_perf(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f)):
            act = num(row.get("actual_price"))
            if act is None:
                continue
            ref = num(row.get("ref_price"))
            rows.append({
                "id": f"{row.get('issued_trt', '')}|{row.get('session', '')}|{row.get('key', '')}",
                "issued": row.get("issued_trt", ""), "session": row.get("session", ""), "key": row.get("key", ""),
                "name": ASSETS.get(row.get("key", ""), (row.get("key", ""),))[0],
                "dp": ASSETS.get(row.get("key", ""), (None, None, None, None, 2))[4],
                "ref_price": ref, "actual_price": act,
                "chg_pct": r((act / ref - 1) * 100, 2) if ref else None,
                "daily_bias": row.get("daily_bias", ""), "short_bias": row.get("short_bias", ""),
                "direction_hit": (row.get("direction_hit") or "").strip(),
                "level_notes": row.get("level_notes", ""), "evaluate_at": row.get("evaluate_at", ""),
            })
    rows.sort(key=lambda x: x["issued"], reverse=True)
    return rows[:80]


def validate(data):
    errs = []
    for sec in SECTIONS:
        rows = data.get(sec)
        if not isinstance(rows, list):
            errs.append(f"{sec}: liste değil")
            continue
        keyf = REQUIRED[sec][0]
        seen = set()
        for i, row in enumerate(rows):
            for k in REQUIRED[sec]:
                if k not in row:
                    errs.append(f"{sec}[{i}]: '{k}' eksik")
            kv = row.get(keyf)
            if kv in seen:
                errs.append(f"{sec}: yinelenen anahtar {kv}")
            seen.add(kv)
            for k, v in row.items():
                if isinstance(v, float) and not math.isfinite(v):
                    errs.append(f"{sec}[{i}].{k}: sonlu değil")
    size = len(json.dumps(data, ensure_ascii=False).encode("utf-8"))
    if size > 240_000:
        errs.append(f"dosya çok büyük: {size} bayt")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--prev")
    ap.add_argument("--snapshots")
    ap.add_argument("--snap-session")
    ap.add_argument("--tech")
    ap.add_argument("--inputs")
    ap.add_argument("--forecast")
    ap.add_argument("--patch")
    a = ap.parse_args()

    data = {s: [] for s in SECTIONS}
    if a.prev:
        try:
            with open(a.prev, encoding="utf-8") as f:
                prev = json.load(f)
            for s in SECTIONS:
                if isinstance(prev.get(s), list):
                    data[s] = prev[s]
        except FileNotFoundError:
            print(f"uyarı: önceki dosya yok ({a.prev}); boş başlanıyor", file=sys.stderr)

    if a.snapshots:
        if not a.snap_session:
            sys.exit("--snapshots ile --snap-session gerekli")
        prices = build_prices(a.snapshots, a.snap_session)
        if not prices:
            sys.exit(f"{a.snap_session} seansına ait fiyat satırı bulunamadı")
        data["prices"] = prices
        coins = [g for g in data["gold"] if g.get("order", 0) >= 10]
        data["gold"] = build_gold(prices) + coins
    if a.inputs:
        coins = build_coins(a.inputs)
        if coins:
            data["gold"] = [g for g in data["gold"] if g.get("order", 0) < 10] + coins
    if a.tech:
        data["tech"] = build_tech(a.tech)
        data["scenarios"] = build_scenarios(data["tech"])
    if a.forecast:
        data["perf"] = build_perf(a.forecast)

    if a.patch:
        with open(a.patch, encoding="utf-8") as f:
            patch = json.load(f)
        for k, v in patch.items():
            if k == "status":
                cur = data["status"][0] if data["status"] else {"key": "now"}
                cur.update(v)
                cur["key"] = "now"
                data["status"] = [cur]
            elif k == "alerts_add":
                ids = {x["id"] for x in v}
                data["alerts"] = (v + [x for x in data["alerts"] if x["id"] not in ids])[:30]
            elif k in SECTIONS:
                data[k] = v
            else:
                sys.exit(f"bilinmeyen patch anahtarı: {k}")

    data["agenda"].sort(key=lambda x: (0 if x.get("kind") == "takvim" else 1, x.get("sort", "")))
    out = {"schema": SCHEMA, "generated_at": datetime.now(TRT).isoformat(timespec="seconds")}
    out.update(data)
    errs = validate(out)
    if errs:
        sys.exit("DOĞRULAMA HATASI:\n- " + "\n- ".join(errs))
    # satır başına bir kayıt: dosya küçük kalır ve satır satır okunabilir
    lines = ["{" + f'"schema":{json.dumps(out["schema"])},"generated_at":{json.dumps(out["generated_at"])},']
    for i, sec in enumerate(SECTIONS):
        rows = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in out[sec])
        lines.append(f'"{sec}":[\n{rows}\n]' + ("," if i < len(SECTIONS) - 1 else ""))
    lines.append("}")
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    json.load(open(a.out, encoding="utf-8"))  # biçim denetimi
    print(f"yazıldı: {a.out} · " + " · ".join(f"{s} {len(out[s])}" for s in SECTIONS))


if __name__ == "__main__":
    main()
