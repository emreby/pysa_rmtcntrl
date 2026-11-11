#!/usr/bin/env python3
"""GMI tablo üretici v2.0 (otomatik sürüm) — GitHub Actions'ta çalışır.
Girdi : ta_engine.js ham CSV + seans girdileri (inputs.json: yahoo_fresh, yahoo_fx, yerel, yerel2, tcmb, labels)
Çıktı : WORK/_tables/*.md (rapor tabloları), WORK/technical_summary.csv, tahmin satırları (FORECAST dosyasına eklenir)
Kullanım: python3 build_tables.py RAW.csv INPUTS.json WORK FORECAST.csv
Tüm kararlar şeffaf kurallara dayanır (skor ve etiket fonksiyonları); sayısal olasılık üretilmez.
"""
import csv, json, os, sys, math

RAW, INP, WORK, FORECAST = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
inp = json.load(open(INP, encoding='utf-8'))
SESSION, DATE, RT = inp['session'], inp['date'], inp['report_time_trt']
TBL = os.path.join(WORK, '_tables'); os.makedirs(TBL, exist_ok=True)
H = inp.get('yerel') or {}; DV = inp.get('yerel2') or {}
YF = inp.get('yahoo_fresh') or {}; YX = inp.get('yahoo_fx') or {}
T_YX = YX.get('time', '')
USD_THEO = inp.get('usdtry_for_theo'); USD_SRC = inp.get('usdtry_for_theo_src', ''); EVAL_AT = inp.get('evaluate_at', '')
LB = inp.get('labels', {})
NOW_MIN = int(RT[11:13]) * 60 + int(RT[14:16])

# ---------- ham CSV'yi oku
sec, heads, cur = {'D': [], 'W': [], 'I': []}, {}, None
for line in open(RAW, encoding='utf-8'):
    line = line.rstrip('\n')
    if not line or line.startswith('#'): continue
    if line.startswith('tf,'):
        cols = line.split(','); cur = 'D' if 'sym' in cols else ('W' if 'week_of' in cols else 'I'); heads[cur] = cols; continue
    sec[cur].append(dict(zip(heads[cur], line.split(','))))
D = {r['key']: r for r in sec['D']}; W = {r['key']: r for r in sec['W']}; I = {(r['tf'], r['key']): r for r in sec['I']}

def f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError): return None
def gt(a, b):
    return None if (a is None or b is None) else a > b

NAME = {'GOLD_FUT': 'Ons altın (COMEX vadeli)', 'SILVER_FUT': 'Ons gümüş (COMEX vadeli)', 'PLAT_FUT': 'Platin (NYMEX vadeli)', 'PALL_FUT': 'Paladyum (NYMEX vadeli)',
        'USDTRY': 'USD/TRY', 'EURTRY': 'EUR/TRY', 'EURUSD': 'EUR/USD', 'GBPTRY': 'GBP/TRY', 'USDJPY': 'USD/JPY', 'DXY': 'Dolar endeksi (DXY)',
        'BRENT': 'Brent petrol (vadeli)', 'WTI': 'WTI petrol (vadeli)', 'NATGAS': 'Doğal gaz (Henry Hub vadeli)', 'COPPER': 'Bakır (COMEX, $/lb)',
        'XU100': 'BIST 100', 'SPX': 'S&P 500', 'ES_FUT': 'S&P 500 vadeli (ES)', 'NDX': 'Nasdaq 100', 'DJI': 'Dow Jones', 'DAX': 'DAX',
        'NIKKEI': 'Nikkei 225', 'HSI': 'Hang Seng', 'SSE': 'Şanghay Bileşik', 'US10Y': 'ABD 10Y faiz (%)', 'US2Y': 'ABD 2Y faiz (%)', 'VIX': 'VIX', 'BTC': 'Bitcoin (BTC/USD)'}
DEC = {'GOLD_FUT': 1, 'SILVER_FUT': 3, 'PLAT_FUT': 1, 'PALL_FUT': 1, 'USDTRY': 4, 'EURTRY': 4, 'EURUSD': 4, 'GBPTRY': 4, 'USDJPY': 2, 'DXY': 2, 'BRENT': 2, 'WTI': 2,
       'NATGAS': 3, 'COPPER': 3, 'XU100': 0, 'SPX': 0, 'ES_FUT': 0, 'NDX': 0, 'DJI': 0, 'DAX': 0, 'NIKKEI': 0, 'HSI': 0, 'SSE': 1, 'US10Y': 3, 'US2Y': 3, 'VIX': 2, 'BTC': 0}
STEP = {'GOLD_FUT': 50, 'SILVER_FUT': 1, 'PLAT_FUT': 50, 'PALL_FUT': 50, 'USDTRY': 0.25, 'EURTRY': 0.5, 'EURUSD': 0.005, 'GBPTRY': 0.5, 'USDJPY': 1, 'DXY': 0.5,
        'BRENT': 5, 'WTI': 5, 'NATGAS': 0.25, 'COPPER': 0.25, 'XU100': 250, 'SPX': 100, 'ES_FUT': 100, 'NDX': 500, 'DJI': 500, 'DAX': 250, 'US10Y': 0.25, 'VIX': 5, 'BTC': 2500}
VOL_OK = {'GOLD_FUT', 'SILVER_FUT', 'BRENT', 'WTI', 'NATGAS', 'COPPER', 'XU100', 'SPX', 'ES_FUT', 'NDX', 'DJI', 'DAX', 'BTC'}

def tr(x, d=2):
    if x is None: return '—'
    s = f"{x:,.{d}f}"; return s.replace(',', '§').replace('.', ',').replace('§', '.')
def pct(x, d=2):
    return '—' if x is None else (('+' if x > 0 else '') + tr(x, d) + '%')

# ---------- seans girdilerini uygula (güncel fiyat + döviz düzeltmesi)
for k, r in D.items():
    r['price_engine'] = r['price']; r['time_disp'] = r['time_trt'][11:]
for k, v in YF.items():
    if k in D and isinstance(v, list) and f(v[0]) and f(v[2]):
        p, t, prev = v
        D[k]['price'] = str(p); D[k]['prev_close'] = str(prev); D[k]['chg_pct'] = f"{100 * (p / prev - 1):.2f}"; D[k]['time_disp'] = t
for k, v in YX.items():
    if k not in D or not isinstance(v, dict): continue
    r = D[k]; r['price'] = str(v['live']); r['prev_close'] = str(v['prev_c']); r['chg_pct'] = str(v['chg']); r['time_disp'] = v.get('time', T_YX)[-5:]
    for name, val in zip(['piv_p', 'piv_r1', 'piv_r2', 'piv_r3', 'piv_s1', 'piv_s2', 'piv_s3'], v['piv']): r[name] = str(val)
    r['piv_date'] = f"{v.get('piv_date', '')} (NY seansı, düzeltilmiş)"; r['fx_fixed'] = '1'

# ---------- kurallar (v1.0 ile aynı)
def dscore(r):
    p = f(r['price_engine']); v = []
    def add(c, n):
        if c is not None: v.append((n, 1 if c else -1))
    g = lambda a: f(r[a])
    add(gt(p, g('sma50')), 'F>SMA50'); add(gt(p, g('sma200')), 'F>SMA200')
    add(gt(g('ema9'), g('ema21')), 'EMA9>EMA21'); add(gt(g('macd'), g('macd_sig')), 'MACD>sinyal'); add(gt(g('rsi'), 50), 'RSI>50')
    add((r['psar_up'] == 'true') if r['psar_up'] in ('true', 'false') else None, 'PSAR↑'); add(gt(g('pdi'), g('mdi')), '+DI>-DI')
    return sum(x for _, x in v), len(v)
def stscore(k):
    s = n = 0
    for tf in ('H4', 'H1'):
        r = I.get((tf, k))
        if not r: continue
        for c in (gt(f(r['ema9']), f(r['ema21'])), gt(f(r['macd_hist']), 0), gt(f(r['rsi']), 50)):
            if c is None: continue
            s += 1 if c else -1; n += 1
    return (s, n) if n else (None, 0)
def trend(r):
    try:
        p, s50, s200, adx, pdi, mdi = (f(r[x]) for x in ('price_engine', 'sma50', 'sma200', 'adx', 'pdi', 'mdi'))
        strong = adx is not None and adx >= 25
        if p > s50 and p > s200: return ('Güçlü yükseliş' if strong and pdi > mdi else 'Yükseliş') if s50 > s200 else 'Yükselişe dönüş (SMA50<SMA200)'
        if p < s50 and p < s200: return ('Güçlü düşüş' if strong and mdi > pdi else 'Düşüş') if s50 < s200 else 'Düşüşe dönüş (SMA50>SMA200)'
        if p > s200: return 'Uzun vade yukarı, kısa vade düzeltme'
        return 'Uzun vade aşağı, kısa vade tepki'
    except TypeError:
        return 'veri yetersiz'
def rsi_state(x):
    if x is None: return '—'
    return 'aşırı alım' if x >= 70 else 'aşırı satım' if x <= 30 else 'güçlü' if x >= 60 else 'zayıf' if x <= 40 else 'nötr'
def macd_state(r):
    try:
        m, s, h, hp = (f(r[x]) for x in ('macd', 'macd_sig', 'macd_hist', 'macd_hist_prev'))
        return ('al (MACD>sinyal)' if m > s else 'sat (MACD<sinyal)') + (', hist. ↑' if h > hp else ', hist. ↓') + (', sıfır üstü' if m > 0 else ', sıfır altı')
    except TypeError:
        return '—'
def ma_order(r):
    try:
        e9, e21, e50 = (f(r[x]) for x in ('ema9', 'ema21', 'ema50'))
        if e9 > e21 > e50: return 'yukarı dizilim (EMA9>21>50)'
        if e9 < e21 < e50: return 'aşağı dizilim (EMA9<21<50)'
        return 'karışık dizilim'
    except TypeError:
        return '—'
def vol_conf(k, r):
    if k not in VOL_OK or r['obv_up'] == '': return 'hacim verisi yok/güvenilmez (OTC, endeks veya eksik veri)'
    roc, sl = f(r['roc12']), f(r['obv_slope20'])
    if roc is None or sl is None: return '—'
    same = (roc >= 0) == (sl >= 0)
    return ('teyit ediyor' if same else 'uyumsuz') + f" (ROC12 {pct(roc,1)}, OBV 20g {'↑' if sl >= 0 else '↓'})"
def reversal(r, t):
    try:
        h, hp, rsi_, rsip, up, p, e9 = f(r['macd_hist']), f(r['macd_hist_prev']), f(r['rsi']), f(r['rsi_prev']), r['psar_up'] == 'true', f(r['price_engine']), f(r['ema9'])
        if 'düşüş' in t.lower() or 'aşağı' in t.lower():
            n = sum([h > 0, h > hp, up, rsi_ > rsip and rsi_ > 40, p > e9])
            return f"dönüş sinyalleri {n}/5" + (' (erken toparlanma işaretleri)' if n >= 3 else ' (zayıf)')
        if 'yükseliş' in t.lower() or 'yukarı' in t.lower():
            n = sum([h < 0, h < hp, not up, rsi_ < rsip and rsi_ > 65, p < e9])
            return f"zayıflama sinyalleri {n}/5" + (' (dikkat)' if n >= 3 else ' (zayıf)')
        return 'kırılım bekleniyor'
    except TypeError:
        return '—'
def levels(k, r):
    p, atr_ = f(r['price_engine']), f(r['atr14']) or 0
    c = []
    def add(lbl, x):
        x = f(x) if not isinstance(x, (int, float)) else x
        if x: c.append((x, lbl))
    if not (r['piv_r1'] == r['piv_s1']):
        for n in ('s1', 's2', 'r1', 'r2'): add('pivot ' + n.upper(), r['piv_' + n])
    for n in ('sma20', 'sma50', 'sma100', 'sma200'): add(n.upper(), r[n])
    add('BB alt', r['bb_l']); add('BB üst', r['bb_u'])
    for n, lbl in (('fib_236', 'Fib %23,6'), ('fib_382', 'Fib %38,2'), ('fib_500', 'Fib %50'), ('fib_618', 'Fib %61,8'), ('fib_786', 'Fib %78,6')): add(lbl, r[n])
    for n in ('sup1', 'sup2', 'sup3'): add('dip', r[n])
    for n in ('res1', 'res2', 'res3'): add('tepe', r[n])
    w = W.get(k)
    if w:
        for n in ('wpiv_s1', 'wpiv_r1'): add('haftalık ' + n[-2:].upper(), w[n])
    st = STEP.get(k)
    if st and p: add('psikolojik', math.floor(p / st) * st); add('psikolojik', math.ceil(p / st) * st)
    tol = max(0.15 * atr_, (p or 0) * 0.0005)
    def cluster(xs):
        out = []
        for x, l in xs:
            if out and abs(out[-1][0] - x) <= tol: out[-1][1].append(l)
            else: out.append([x, [l]])
        return out
    sup_all = cluster(sorted([z for z in c if z[0] < p - 1e-12], key=lambda z: -z[0]))
    res_all = cluster(sorted([z for z in c if z[0] > p + 1e-12], key=lambda z: z[0]))
    sup, res = sup_all[:3], res_all[:3]
    msup = [x[0] for x in sup_all if p - x[0] >= 0.25 * atr_][:2]
    mres = [x[0] for x in res_all if x[0] - p >= 0.25 * atr_][:2]
    r['_all'] = (sup_all, res_all)
    fmt = lambda x: tr(x[0], DEC[k]) + ' (' + ', '.join(dict.fromkeys(x[1])) + ')'
    return [fmt(x) for x in sup], [fmt(x) for x in res], msup, mres

CORE = [k for k in ['GOLD_FUT', 'SILVER_FUT', 'PLAT_FUT', 'PALL_FUT', 'USDTRY', 'EURTRY', 'EURUSD', 'GBPTRY', 'USDJPY', 'DXY', 'BRENT', 'WTI', 'NATGAS', 'COPPER',
                        'XU100', 'ES_FUT', 'NDX', 'DJI', 'DAX', 'US10Y', 'VIX', 'BTC'] if k in D and f(D[k]['price_engine'])]

# ---------- teknik özet tablosu + CSV
rows, summary, preds = [], [], []
for k in CORE:
    r = D[k]; t = trend(r); ds, dn = dscore(r); ss, sn = stscore(k)
    sup, res, supv, resv = levels(k, r)
    bias = 'pozitif' if ds >= 3 else 'negatif' if ds <= -3 else 'karışık'
    sbias = '—' if ss is None else ('pozitif' if ss >= 2 else 'negatif' if ss <= -2 else 'karışık')
    rows.append(dict(k=k, t=t, ds=f"{ds:+d}/{dn}", ss='—' if ss is None else f"{ss:+d}/{sn}", rsi=f"{tr(f(r['rsi']),1)} ({rsi_state(f(r['rsi']))})",
                     macd=macd_state(r), adx=f"{tr(f(r['adx']),1)} (+DI {tr(f(r['pdi']),1)} / -DI {tr(f(r['mdi']),1)})", ma=ma_order(r),
                     vol=vol_conf(k, r), rev=reversal(r, t), sup=sup, res=res, bias=bias, sbias=sbias))
    summary.append([DATE, SESSION, k, NAME[k], r['price_engine'], t, ds, ss, r['rsi'], r['macd_hist'], r['adx'], r['atr14'], ' | '.join(sup), ' | '.join(res), bias, sbias])
    preds.append([RT, SESSION, k, r['price'], bias, sbias, supv[0] if supv else '', resv[0] if resv else '', supv[1] if len(supv) > 1 else '', resv[1] if len(resv) > 1 else '', r['atr14'], EVAL_AT, '', '', ''])

with open(os.path.join(TBL, 'tech.md'), 'w', encoding='utf-8') as fo:
    fo.write('| Varlık | Ana trend (günlük) | Günlük skor | Kısa vade skor (4s+1s) | RSI(14) | MACD | ADX(14) | Hareketli ort. | Hacim teyidi | Dönüş ihtimali |\n|---|---|---|---|---|---|---|---|---|---|\n')
    for x in rows:
        fo.write(f"| {NAME[x['k']]} | {x['t']} | {x['ds']} ({x['bias']}) | {x['ss']} ({x['sbias']}) | {x['rsi']} | {x['macd']} | {x['adx']} | {x['ma']} | {x['vol']} | {x['rev']} |\n")
with open(os.path.join(TBL, 'levels.md'), 'w', encoding='utf-8') as fo:
    fo.write('| Varlık | Fiyat (motor) | Günlük ATR(14) | Destek 1 | Destek 2 | Destek 3 | Direnç 1 | Direnç 2 | Direnç 3 |\n|---|---|---|---|---|---|---|---|---|\n')
    for x in rows:
        r = D[x['k']]; d = DEC[x['k']]; s = x['sup'] + ['—'] * 3; rr = x['res'] + ['—'] * 3
        pe, at = f(r['price_engine']), f(r['atr14'])
        fo.write(f"| {NAME[x['k']]} | {tr(pe, d)} | {tr(at, d)} ({tr(100*at/pe,2) if at and pe else '—'}%) | {s[0]} | {s[1]} | {s[2]} | {rr[0]} | {rr[1]} | {rr[2]} |\n")
with open(os.path.join(TBL, 'scen.md'), 'w', encoding='utf-8') as fo:
    fo.write('Seviyeler: fiyata en az 0,25×ATR uzaklıktaki ilk iki destek/direnç. Senaryolar kural tabanlıdır; olasılık içermez.\n\n| Varlık | Yükseliş senaryosu (koşul → hedef) | Nötr / yatay | Düşüş senaryosu (koşul → hedef) | Yükselişi geçersiz kılan | Düşüşü geçersiz kılan |\n|---|---|---|---|---|---|\n')
    for x, p in zip(rows, preds):
        k = x['k']; d = DEC[k]; s1, r1, s2, r2 = (f(str(v)) if v != '' else None for v in (p[6], p[7], p[8], p[9]))
        up = f"{tr(r1,d)} üzerinde kapanış → {tr(r2,d)}" if r1 and r2 else (f"{tr(r1,d)} üzerinde kapanış" if r1 else '—')
        dn = f"{tr(s1,d)} altında kapanış → {tr(s2,d)}" if s1 and s2 else (f"{tr(s1,d)} altında kapanış" if s1 else '—')
        neu = f"{tr(s1,d)} – {tr(r1,d)} bandı" if s1 and r1 else '—'
        fo.write(f"| {NAME[k]} | {up} | {neu} | {dn} | {tr(s1,d) + ' altı' if s1 else '—'} | {tr(r1,d) + ' üstü' if r1 else '—'} |\n")

with open(os.path.join(TBL, 'intraday.md'), 'w', encoding='utf-8') as fo:
    fo.write('| Varlık | Zaman dilimi | Kapanış | RSI | MACD hist. (önceki) | EMA9 vs EMA21 | Fiyat vs EMA50 | ADX | Stokastik %K/%D | VWAP (seans) |\n|---|---|---|---|---|---|---|---|---|---|\n')
    for k in ['GOLD_FUT', 'SILVER_FUT', 'USDTRY', 'EURTRY', 'EURUSD', 'DXY', 'BRENT', 'XU100', 'ES_FUT', 'DAX', 'BTC']:
        for tf, lbl in (('M5', '5 dk'), ('M15', '15 dk'), ('H1', '1 saat'), ('H4', '4 saat')):
            r = I.get((tf, k))
            if not r or k not in DEC: continue
            try:
                d = DEC[k]; c = f(r['c']); vw = f(r['vwap'])
                fo.write(f"| {NAME[k]} | {lbl} | {tr(c, d)} | {tr(f(r['rsi']),1)} | {tr(f(r['macd_hist']), 4 if d >= 3 else 2)} ({tr(f(r['macd_hist_prev']), 4 if d >= 3 else 2)}) | {'↑' if f(r['ema9']) > f(r['ema21']) else '↓'} | {'üstünde' if c > f(r['ema50']) else 'altında'} | {tr(f(r['adx']),1)} | {tr(f(r['st_k']),0)}/{tr(f(r['st_d']),0)} | {(tr(vw, d) + (' (fiyat üstte)' if c > vw else ' (fiyat altta)')) if vw else '—'} |\n")
            except TypeError:
                continue

with open(os.path.join(TBL, 'weekly.md'), 'w', encoding='utf-8') as fo:
    fo.write('| Varlık | Hafta başından | Haftalık SMA20 | Haftalık SMA50 | Haftalık RSI | Haftalık MACD hist. | ADX (+DI/-DI) | Haftalık pivot S1 / P / R1 |\n|---|---|---|---|---|---|---|---|\n')
    for k in CORE:
        w = W.get(k)
        if not w: continue
        d = DEC[k]
        try:
            fo.write(f"| {NAME[k]} | {pct(f(w['chg_wtd_pct']))} | {tr(f(w['sma20']), d)} | {tr(f(w['sma50']), d)} | {tr(f(w['rsi']),1)} | {tr(f(w['macd_hist']), 4 if d >= 3 else 2)} ({'↑' if f(w['macd_hist']) > f(w['macd_hist_prev']) else '↓'}) | {tr(f(w['adx']),1)} ({tr(f(w['pdi']),1)}/{tr(f(w['mdi']),1)}) | {tr(f(w['wpiv_s1']), d)} / {tr(f(w['wpiv_p']), d)} / {tr(f(w['wpiv_r1']), d)} |\n")
        except TypeError:
            continue

# ---------- altın modülü
OZ = 31.1034768
def mid(p): return (p[0] + p[1]) / 2 if p else None
ons_spot = mid(H.get('ons_usd')) or mid(DV.get('ons_usd'))
ons_src = (H if H.get('ons_usd') else DV).get('source', '') if ons_spot else ''
gfut = f(D['GOLD_FUT']['price']) if 'GOLD_FUT' in D else None
ons = ons_spot or gfut
usd = f(USD_THEO)
theo = ons * usd / OZ if (ons and usd) else None
with open(os.path.join(TBL, 'gold.md'), 'w', encoding='utf-8') as fo:
    if not theo:
        fo.write('Altın modülü hesaplanamadı: ons veya USD/TRY alınamadı.\n')
    else:
        osrc = f"{ons_src} spot ons" if ons_spot else f"COMEX vadeli ({D['GOLD_FUT']['time_disp']}; spot ons alınamadı)"
        fo.write(f"Girdi: ons {tr(ons,2)} $ ({osrc}) × USD/TRY {tr(usd,4)} ({USD_SRC}) ÷ 31,1034768\n\n")
        fo.write('| Fiyat | Alış | Satış | Teorik fiyata göre fark |\n|---|---|---|---|\n')
        fo.write(f"| **Teorik gram (ons × USD/TRY ÷ 31,1034768)** | {tr(theo,2)} TL | — | referans |\n")
        for S in (H, DV):
            if not S: continue
            for key, lbl in (('has_altin', 'HAS altın'), ('gram_altin', 'Gram altın – perakende')):
                pr = S.get(key)
                if not pr: continue
                a, s = pr
                fo.write(f"| {lbl} ({S.get('source','')}, {S.get('time','')}) | {tr(a,2)} TL | {tr(s,2)} TL | alış {pct(100*(a/theo-1))} · satış {pct(100*(s/theo-1))} |\n")
        coin_src = next((S for S in (H, DV) if S and S.get('yeni_ceyrek')), None)
        cs = inp.get('coin_specs_g') or {}
        if coin_src and cs:
            mil = cs.get('milyem', 0.9166)
            fo.write(f"\n| Sikke (yeni basım) | Brüt ağırlık | Has altın içeriği | Teorik değer | Alış | Satış | Prim (alış / satış) |\n|---|---|---|---|---|---|---|\n")
            for key, lbl, wk in (('yeni_ceyrek', 'Çeyrek', 'ceyrek'), ('yeni_yarim', 'Yarım', 'yarim'), ('yeni_tam', 'Tam', 'tam'), ('yeni_ata', 'Cumhuriyet (Ata)', 'ata')):
                pr = coin_src.get(key); wgt = cs.get(wk)
                if not pr or not wgt: continue
                a, s = pr; has_ = wgt * mil; tv = has_ * theo
                fo.write(f"| {lbl} | {tr(wgt,3)} g | {tr(has_,4)} g | {tr(tv,0)} TL | {tr(a,0)} TL | {tr(s,0)} TL | {pct(100*(a/tv-1))} / {pct(100*(s/tv-1))} |\n")
            fo.write(f"\nSikke fiyatları: {coin_src.get('source','')} ({coin_src.get('time','')}).\n")
        sil = f(D['SILVER_FUT']['price']) if 'SILVER_FUT' in D else None
        gsrc = next((S for S in (H, DV) if S and S.get('gumus_tl_gram')), None)
        if sil and gsrc:
            stheo = sil * usd / OZ; sa, ss_ = gsrc['gumus_tl_gram']
            fo.write(f"\nGümüş: teorik gram {tr(stheo,2)} TL (COMEX vadeli {tr(sil,3)} $). {gsrc.get('source','')} gram gümüş alış/satış {tr(sa,3)} / {tr(ss_,3)} TL (satış {pct(100*(ss_/stheo-1))}).\n")
        if ons_spot and gfut:
            fo.write(f"\nVadeli–spot farkı: COMEX vadeli {tr(gfut,1)} $ − spot ons {tr(ons_spot,1)} $ = {tr(gfut-ons_spot,1)} $ (%{tr(100*(gfut/ons_spot-1),2)}).\n")

g_sup, g_res = D['GOLD_FUT'].get('_all', ([], [])) if 'GOLD_FUT' in D else ([], [])
with open(os.path.join(TBL, 'gramlevels.md'), 'w', encoding='utf-8') as fo:
    if usd:
        fo.write('| Ons seviyesi ($) | Teknik anlamı | Gram altın karşılığı (TL) |\n|---|---|---|\n')
        for x, lbls in sorted(g_sup[:5] + g_res[:5], key=lambda z: z[0]):
            fo.write(f"| {tr(x,1)} | {', '.join(dict.fromkeys(lbls))} | {tr(x*usd/OZ,0)} |\n")

# ---------- fiyat tablosu (B)
def status_of(k, t):
    try: m = int(t[:2]) * 60 + int(t[3:5])
    except (ValueError, TypeError): m = None
    if k in ('SPX', 'NDX', 'DJI'):
        return 'seans içi (≈15 dk gecikmeli)' if 17 * 60 + 30 <= NOW_MIN < 24 * 60 else 'KAPANIŞ (piyasa kapalı)'
    if k in ('NIKKEI', 'HSI', 'SSE'):
        close = {'NIKKEI': 9 * 60 + 30, 'HSI': 11 * 60, 'SSE': 10 * 60}[k]
        return 'KAPANIŞ' if NOW_MIN >= close or NOW_MIN < 3 * 60 else 'seans içi (gecikmeli)'
    if k == 'XU100':
        return 'seans içi (≈15 dk gecikmeli)' if 10 * 60 <= NOW_MIN < 18 * 60 + 10 else 'KAPANIŞ'
    if k in ('USDTRY', 'EURTRY', 'EURUSD', 'GBPTRY', 'USDJPY', 'BTC'): return 'canlı (OTC)' if k != 'BTC' else 'canlı (7/24)'
    return '≈10–15 dk gecikmeli'
with open(os.path.join(TBL, 'prices.md'), 'w', encoding='utf-8') as fo:
    fo.write('| Varlık | Güncel fiyat | Günlük değişim | Veri saati (TSİ) | Kaynak | Durum | Trend (günlük) |\n|---|---|---|---|---|---|---|\n')
    tl = {x['k']: x['t'] for x in rows}
    for S in (H, DV):
        if S and S.get('gram_altin'):
            a, s = S['gram_altin']
            fo.write(f"| Gram altın (24 ayar) | {tr(a,2)} / {tr(s,2)} TL (alış/satış) | — | {S.get('time','')} | {S.get('source','')} | canlı | {tl.get('GOLD_FUT','—')} |\n")
    if theo:
        fo.write(f"| Gram altın (teorik) | {tr(theo,2)} TL | — | — | hesap: ons × USD/TRY ÷ 31,1035 | hesap | — |\n")
    if ons_spot:
        S = H if H.get('ons_usd') else DV
        fo.write(f"| Ons altın (spot) | {tr(S['ons_usd'][0],2)} / {tr(S['ons_usd'][1],2)} $ | — | {S.get('time','')} | {S.get('source','')} | canlı | — |\n")
    for k in ['GOLD_FUT', 'SILVER_FUT', 'PLAT_FUT', 'PALL_FUT', 'USDTRY', 'EURTRY', 'EURUSD', 'GBPTRY', 'USDJPY', 'DXY', 'BRENT', 'WTI', 'NATGAS', 'COPPER',
              'XU100', 'DAX', 'ES_FUT', 'SPX', 'NDX', 'DJI', 'NIKKEI', 'HSI', 'SSE', 'US10Y', 'VIX', 'BTC']:
        if k not in D: continue
        r = D[k]; p, pc = f(r['price']), f(r['prev_close'])
        if k == 'US10Y':
            chg = f"{'+' if p - pc >= 0 else ''}{tr(100*(p-pc),1)} bp" if (p is not None and pc is not None) else '—'
            price = tr(p, 3) + '%'
        else:
            chg = pct(f(r['chg_pct'])) + (' (NY kapanışına göre)' if r.get('fx_fixed') else ''); price = tr(p, DEC[k])
        fo.write(f"| {NAME[k]} | {price} | {chg} | {r['time_disp']} | Yahoo Finance | {status_of(k, r['time_disp'])} | {tl.get(k, '—')} |\n")
    tc = inp.get('tcmb') or {}
    if tc.get('USD') and tc['USD'].get('alis'):
        fo.write(f"| USD/TRY (TCMB gösterge) | {tr(tc['USD']['alis'],4)} / {tr(tc['USD']['satis'],4)} | — | {tc.get('date','')} | TCMB | günlük gösterge kur | — |\n")
    fo.write('| ABD 2Y tahvil faizi | alınamadı | — | — | — | Yahoo 2YY=F verisi güncellenmiyor | — |\n')

# ---------- CSV kayıtları
with open(os.path.join(WORK, 'technical_summary.csv'), 'w', newline='', encoding='utf-8') as fo:
    wr = csv.writer(fo); wr.writerow(['date', 'session', 'key', 'name', 'price_engine', 'trend', 'daily_score', 'short_score', 'rsi', 'macd_hist', 'adx', 'atr14', 'supports', 'resistances', 'daily_bias', 'short_bias']); wr.writerows(summary)
new = not os.path.exists(FORECAST)
with open(FORECAST, 'a', newline='', encoding='utf-8') as fo:
    wr = csv.writer(fo)
    if new: wr.writerow(['issued_trt', 'session', 'key', 'ref_price', 'daily_bias', 'short_bias', 'support1', 'resistance1', 'support2', 'resistance2', 'atr14', 'evaluate_at', 'actual_price', 'direction_hit', 'level_notes'])
    wr.writerows(preds)
json.dump({'rows': [{k: v for k, v in x.items()} for x in rows], 'theo': theo, 'ons': ons, 'ons_spot': bool(ons_spot), 'usd': usd},
          open(os.path.join(WORK, 'tables_meta.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(f"tablolar yazıldı: {len(rows)} varlık · teorik gram {tr(theo,2) if theo else '—'} TL")
