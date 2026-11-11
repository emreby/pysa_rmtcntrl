#!/usr/bin/env python3
"""GMI otomatik akış — GitHub Actions'ta çalışır, Claude gerekmez.

  python3 engine/pipeline.py decide [--force kontrol|seans] [--session KOD]
      Bu çalışmanın türünü yazar: "seans SABAH" ya da "kontrol K".
  python3 engine/pipeline.py run MOD SEANS
      work/collect.json verisinden uygulama verisini (data/app_data.json), durum dosyalarını (state/)
      ve tam seanslarda raporu (raporlar/) üretir.

Kurallar: veri uydurulmaz; alınamayan değer boş kalır. Saatler TSİ'dir. Sayısal olasılık ve al-sat önerisi yoktur.
"""
import csv, json, math, os, re, subprocess, sys
from datetime import datetime, timedelta, timezone

TRT = timezone(timedelta(hours=3))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK, STATE, DATA, REP = (os.path.join(ROOT, d) for d in ('work', 'state', 'data', 'raporlar'))
APP = os.path.join(DATA, 'app_data.json')
SNAP_HIST = os.path.join(STATE, 'price_snapshots.csv')
FORECAST = os.path.join(STATE, 'forecast_log.csv')
SESSIONS = [('SABAH', 'Sabah', '08:45'), ('OGLEN', 'Öğlen', '12:45'), ('OGLEDEN_SONRA', 'Öğleden sonra', '16:38'), ('AKSAM', 'Akşam', '22:15')]
LATE_LIMIT_MIN = 180
OZ = 31.1034768
COIN_SPECS = {'ceyrek': 1.754, 'yarim': 3.508, 'tam': 7.016, 'ata': 7.216, 'milyem': 0.9166, 'kaynak': "Bigpara 'Altın ağırlıkları' (22 ayar = 916,6 milyem)"}
AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
NAMES = {'GOLD_FUT': 'Ons altın', 'SILVER_FUT': 'Gümüş', 'PLAT_FUT': 'Platin', 'PALL_FUT': 'Paladyum', 'USDTRY': 'USD/TRY', 'EURTRY': 'EUR/TRY',
         'EURUSD': 'EUR/USD', 'GBPTRY': 'GBP/TRY', 'USDJPY': 'USD/JPY', 'DXY': 'Dolar endeksi', 'BRENT': 'Brent', 'WTI': 'WTI', 'NATGAS': 'Doğal gaz',
         'COPPER': 'Bakır', 'XU100': 'BIST 100', 'SPX': 'S&P 500', 'ES_FUT': 'S&P 500 vadeli', 'NDX': 'Nasdaq 100', 'DJI': 'Dow Jones', 'DAX': 'DAX',
         'NIKKEI': 'Nikkei 225', 'HSI': 'Hang Seng', 'SSE': 'Şanghay', 'US10Y': 'ABD 10Y faiz', 'VIX': 'VIX', 'BTC': 'Bitcoin'}


def load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def fnum(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def tr(x, d=2):
    if x is None:
        return '—'
    s = f"{x:,.{d}f}"
    return s.replace(',', '§').replace('.', ',').replace('§', '.')


def pct(x, d=2):
    return '—' if x is None else (('+' if x > 0 else '') + tr(x, d) + '%')


def when(dt):
    return f"{dt.day} {AY[dt.month - 1]} {dt:%H:%M}"


def session_start(now, hhmm):
    h, m = map(int, hhmm.split(':'))
    return now.replace(hour=h, minute=m, second=0, microsecond=0)


def next_trading_day(dt):
    d = dt + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def next_session_label(now):
    for code, name, hhmm in SESSIONS:
        if now.weekday() < 5 and session_start(now, hhmm) > now:
            return f"{name} seansı · {hhmm}"
    nd = next_trading_day(now)
    return f"{SESSIONS[0][1]} seansı · {nd.day} {AY[nd.month - 1]} {SESSIONS[0][2]}"


# ------------------------------------------------------------------ karar
def decide(args):
    force = args.get('--force', '').strip()
    sess = args.get('--session', '').strip().upper()
    now = datetime.now(TRT)
    if force == 'kontrol':
        print('kontrol K'); return
    if force == 'seans':
        code = sess if sess in [s[0] for s in SESSIONS] else None
        if not code:  # en son başlamış seans
            code = SESSIONS[0][0]
            for c, _, hhmm in SESSIONS:
                if session_start(now, hhmm) <= now:
                    code = c
        print('seans', code); return
    done = load(os.path.join(STATE, 'sessions.json'), {}).get(now.strftime('%Y-%m-%d'), [])
    due = None
    if now.weekday() < 5:
        for code, _, hhmm in SESSIONS:
            st = session_start(now, hhmm)
            if st <= now < st + timedelta(minutes=LATE_LIMIT_MIN) and code not in done:
                due = code
    print(f'seans {due}' if due else 'kontrol K')


# ------------------------------------------------------------------ yardımcılar
ASSET_TAGS = [
    (r'altın|\bons\b|gram|çeyrek|külçe', 'Altın'), (r'gümüş', 'Gümüş'), (r'dolar|kur\b|kurlar|döviz|\btl\b|türk lirası|euro', 'USD/TRY'),
    (r'\bfed\b|powell|abd|enflasyon|istihdam|tarım dışı|hazine', 'ABD faizleri, DXY'), (r'tcmb|merkez bankası|ppk|karahan|politika faizi', 'TL, BIST'),
    (r'petrol|brent|opec|wti|ham petrol', 'Petrol'), (r'borsa|bist', 'BIST 100'), (r'bitcoin|kripto', 'Bitcoin'),
    (r'savaş|saldırı|füze|ateşkes|iran|israil|rusya|ukrayna|hürmüz|gazze', 'Jeopolitik'),
]
HIGH = r'faiz karar|faizi sabit|faiz indir|faiz artır|ppk|fomc|enflasyon|tüfe|üfe|istihdam|tarım dışı|savaş|saldırı|ateşkes|opec|rekor|çöküş|sert'


def tag_assets(title):
    t = title.lower()
    out = [lbl for pat, lbl in ASSET_TAGS if re.search(pat, t)]
    return ', '.join(dict.fromkeys(out)) or 'Genel'


def read_csv(path):
    if not os.path.exists(path):
        return [], []
    with open(path, encoding='utf-8') as f:
        rd = csv.DictReader(f)
        return list(rd), rd.fieldnames


def write_csv(path, rows, fields):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)


# ------------------------------------------------------------------ çalıştır
def run(mode, session):
    now = datetime.now(TRT)
    RT = now.strftime('%Y-%m-%d %H:%M'); today, hhmm = RT[:10], RT[11:]
    C = load(os.path.join(WORK, 'collect.json'), None)

    def fail(msg):
        dump(os.path.join(STATE, 'son_calisma.json'), {'run_trt': RT, 'mode': mode, 'label': session, 'error': msg, 'errors': (C or {}).get('errors', [])[:40]})
        sys.exit(msg)
    if not C:
        fail('work/collect.json yok (veri toplama adımı çöktü)')
    Q, FX, LOC = C.get('quick') or {}, C.get('fx') or {}, C.get('local') or {}
    if not Q:
        fail('Hiç fiyat alınamadı')
    is_seans = mode == 'seans'
    sname = dict((c, n) for c, n, _ in SESSIONS).get(session, '')
    stime = dict((c, t) for c, _, t in SESSIONS).get(session, '')
    label = session if is_seans else 'K' + hhmm.replace(':', '')
    sess_title = f"{sname} seansı ({stime})" if is_seans else f"Uyarı kontrolü ({hhmm})"
    prev_app = load(APP, {})
    os.makedirs(WORK, exist_ok=True); os.makedirs(STATE, exist_ok=True)

    locs = [LOC[k] for k in ('harem', 'truncgil', 'genelpara') if k in LOC]
    H = locs[0] if locs else {}
    DV = locs[1] if len(locs) > 1 else {}

    def price(key):
        if key in FX:
            return FX[key]['live']
        return (Q.get(key) or {}).get('price')

    def chg(key):
        if key in FX:
            return FX[key]['chg']
        return (Q.get(key) or {}).get('chg')

    def fresh(key):
        q = Q.get(key)
        return bool(q) and q.get('time', '')[:10] == today

    usd = price('USDTRY')
    usd_t = (FX.get('USDTRY') or Q.get('USDTRY') or {}).get('time', '')[11:]
    mid = lambda p: (p[0] + p[1]) / 2 if p else None
    ons_spot = mid(H.get('ons_usd')) or mid(DV.get('ons_usd'))
    ons_src = (H if H.get('ons_usd') else DV) if ons_spot else None
    ons = ons_spot or price('GOLD_FUT')
    theo = ons * usd / OZ if (ons and usd) else None
    theo_src = f"hesap: {'spot ons (' + ons_src['source'] + ')' if ons_spot else 'COMEX vadeli ons'} × USD/TRY (Yahoo)"

    # ---- fiyat anlık görüntüsü
    snap = []
    for key, q in Q.items():
        if key in ('US2Y', 'XAU_SPOT'):
            continue
        p, pc, c, t, src = q.get('price'), q.get('prev'), q.get('chg'), q.get('time', '')[11:], 'yahoo'
        if key in FX:
            fx = FX[key]; p, pc, c, t, src = fx['live'], fx['prev_c'], fx['chg'], fx['time'][11:], 'yahoo+nyclose_fix'
        snap.append([RT, label, key, p, '' if pc is None else pc, '' if c is None else c, t, src])
    for S, suf in ((H, ''), (DV, '2')):
        if not S:
            continue
        if S.get('gram_altin'):
            snap.append([RT, label, 'GRAM_ALTIN_YEREL' + suf, f"{S['gram_altin'][0]}/{S['gram_altin'][1]}", '', '', S.get('time') or hhmm, S.get('source', '')])
        if S.get('has_altin') and not suf:
            snap.append([RT, label, 'HAS_ALTIN_YEREL', f"{S['has_altin'][0]}/{S['has_altin'][1]}", '', '', S.get('time') or hhmm, S.get('source', '')])
    if ons_spot:
        snap.append([RT, label, 'ONS_SPOT_YEREL', f"{ons_src['ons_usd'][0]}/{ons_src['ons_usd'][1]}", '', '', ons_src.get('time') or hhmm, ons_src.get('source', '')])
    if theo:
        snap.append([RT, label, 'GRAM_ALTIN_TEORIK', round(theo, 2), '', '', hhmm, theo_src])
    head = ['ts_trt', 'session', 'key', 'price', 'prev_close', 'chg_pct', 'data_time_trt', 'source']
    with open(os.path.join(WORK, 'snap.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(head); w.writerows(snap)
    if is_seans:
        new = not os.path.exists(SNAP_HIST)
        with open(SNAP_HIST, 'a', newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            if new: w.writerow(head)
            w.writerows(snap)

    # ---- seans girdileri
    ev = next_trading_day(now).replace(hour=now.hour, minute=now.minute)
    inputs = {
        'session': label, 'date': today, 'report_time_trt': RT, 'yerel': H, 'yerel2': DV, 'tcmb': C.get('tcmb'),
        'yahoo_fresh': {k: [q['price'], q.get('time', '')[11:], q['prev']] for k, q in Q.items() if k not in FX and q.get('prev')},
        'yahoo_fx': FX, 'coin_specs_g': COIN_SPECS, 'usdtry_for_theo': usd, 'usdtry_for_theo_src': f"Yahoo, {usd_t}",
        'theo_gram': round(theo, 4) if theo else None, 'evaluate_at': ev.strftime('%Y-%m-%d %H:%M'), 'labels': {},
    }
    dump(os.path.join(WORK, 'inputs.json'), inputs)

    tables_ok = False
    if is_seans:
        raw = os.path.join(WORK, 'raw.csv')
        if os.path.exists(raw):
            r = subprocess.run([sys.executable, os.path.join(ROOT, 'engine', 'build_tables.py'), raw, os.path.join(WORK, 'inputs.json'), WORK, FORECAST],
                               capture_output=True, text=True)
            print(r.stdout.strip())
            if r.returncode == 0:
                tables_ok = True
            else:
                print('build_tables hatası:', r.stderr[-1500:], file=sys.stderr)

    # ---- tahmin değerlendirmesi (vakti gelenler)
    frows, ffields = read_csv(FORECAST)
    n_eval = 0
    for row in frows:
        if (row.get('actual_price') or '').strip() or not row.get('evaluate_at'):
            continue
        try:
            evt = datetime.strptime(row['evaluate_at'], '%Y-%m-%d %H:%M').replace(tzinfo=TRT)
        except ValueError:
            continue
        cur, ref = fnum(price(row['key'])), fnum(row.get('ref_price'))
        if evt > now or cur is None or not ref:
            continue
        ch = cur / ref - 1
        bias = row.get('daily_bias', '')
        if bias not in ('pozitif', 'negatif'):
            hit = 'yönsüz'
        elif abs(ch) <= 0.0025:
            hit = 'yatay'
        else:
            hit = 'isabet' if (ch > 0) == (bias == 'pozitif') else 'ıska'
        s1, r1 = fnum(row.get('support1')), fnum(row.get('resistance1'))
        lvl = 'S1 altında' if (s1 and cur < s1) else 'R1 üstünde' if (r1 and cur > r1) else ('S1–R1 bandında' if (s1 and r1) else '')
        late = (now - evt).total_seconds() > 45 * 60
        row['actual_price'] = f"{cur:.6g}"
        row['direction_hit'] = hit
        row['level_notes'] = f"{'gecikmeli eval' if late else 'eval'} {hhmm} TSİ (otomatik, anlık fiyat)" + (f"; {lvl}" if lvl else '')
        n_eval += 1
    cutoff = (now - timedelta(days=60)).strftime('%Y-%m-%d')
    frows = [r for r in frows if r.get('issued_trt', '') >= cutoff]
    if ffields:
        write_csv(FORECAST, frows, ffields)

    # ---- uyarılar
    AS = load(os.path.join(STATE, 'alerts_state.json'), {})
    seen = AS.setdefault(today, {})
    alerts = []

    def add(ck, asset, title, detail):
        if ck in seen:
            return
        seen[ck] = hhmm
        alerts.append({'id': f"{today}-{hhmm.replace(':', '')}-{ck}", 'time': hhmm, 'asset': asset, 'title': title, 'detail': detail,
                       'level': 'uyarı', 'session': sess_title})

    g, gc = price('GOLD_FUT'), chg('GOLD_FUT')
    if fresh('GOLD_FUT') and gc is not None and abs(gc) >= 1.5:
        add('ons-yuzde' + ('+' if gc > 0 else '-'), 'Ons altın', f"Günlük {pct(gc)}", f"COMEX vadeli {tr(g, 1)} $ ({Q['GOLD_FUT']['time'][11:]}); eşik ±%1,5.")
    uc = chg('USDTRY')
    if fresh('GOLD_FUT') and gc is not None and uc is not None:
        gramc = ((1 + gc / 100) * (1 + uc / 100) - 1) * 100
        if abs(gramc) >= 1.5:
            add('gram-yuzde' + ('+' if gramc > 0 else '-'), 'Gram altın', f"Günlük ≈{pct(gramc)} (teorik)", f"Teorik gram {tr(theo, 2)} TL; ons ve USD/TRY değişiminden hesaplandı; eşik ±%1,5.")
    tech = {t['key']: t for t in (prev_app.get('tech') or [])}
    gt = tech.get('GOLD_FUT')
    if gt and g and fresh('GOLD_FUT'):
        s1, r1 = fnum(gt.get('s1')), fnum(gt.get('r1'))
        if s1 and g < s1:
            add(f"ons-s1-{s1:g}", 'Ons altın', f"S1 {tr(s1, 1)} $ kırıldı", f"Ons (COMEX vadeli) {tr(g, 1)} $; seviye {gt.get('asof', '')} teknik görünümünden ({gt.get('s1_note', '')}).")
        if r1 and g > r1:
            add(f"ons-r1-{r1:g}", 'Ons altın', f"R1 {tr(r1, 1)} $ aşıldı", f"Ons (COMEX vadeli) {tr(g, 1)} $; seviye {gt.get('asof', '')} teknik görünümünden ({gt.get('r1_note', '')}).")
    if uc is not None and abs(uc) >= 0.5:
        add('usdtry-yuzde' + ('+' if uc > 0 else '-'), 'USD/TRY', f"Günlük {pct(uc)} (rejim dışı hareket)", f"USD/TRY {tr(usd, 4)}; NY kapanışına göre değişim; eşik ±%0,5.")
    bc = chg('BRENT')
    if fresh('BRENT') and bc is not None and abs(bc) >= 3:
        add('brent-yuzde' + ('+' if bc > 0 else '-'), 'Brent', f"Günlük {pct(bc)}", f"Brent vadeli {tr(price('BRENT'), 2)} $; eşik ±%3.")
    xc = chg('XU100')
    if fresh('XU100') and xc is not None and abs(xc) >= 2:
        add('bist-yuzde' + ('+' if xc > 0 else '-'), 'BIST 100', f"Günlük {pct(xc)}", f"BIST 100 {tr(price('XU100'), 0)} (≈15 dk gecikmeli); eşik ±%2.")
    v, vc = price('VIX'), chg('VIX')
    if fresh('VIX') and v is not None and v >= 25:
        add('vix-25', 'VIX', f"VIX {tr(v, 2)} (≥25)", 'Piyasada oynaklık beklentisi yüksek.')
    if fresh('VIX') and vc is not None and vc >= 15:
        add('vix-sicrama', 'VIX', f"VIX günlük {pct(vc)}", f"VIX {tr(v, 2)}; eşik +%15.")
    t10 = Q.get('US10Y') or {}
    if fresh('US10Y') and t10.get('price') is not None and t10.get('prev') is not None:
        bp = (t10['price'] - t10['prev']) * 100
        if abs(bp) >= 10:
            add('us10y-bp' + ('+' if bp > 0 else '-'), 'ABD 10Y', f"Günlük {'+' if bp > 0 else ''}{tr(bp, 1)} bp", f"ABD 10 yıllık faiz %{tr(t10['price'], 3)}; eşik ±10 bp.")
    for d in list(AS.keys()):
        if d < (now - timedelta(days=3)).strftime('%Y-%m-%d'):
            del AS[d]
    dump(os.path.join(STATE, 'alerts_state.json'), AS)

    # ---- gündem (haber başlıkları + ekonomik takvim) — yalnız tam seansta yenilenir
    patch = {}
    if is_seans:
        prev_ag = prev_app.get('agenda') or []
        news = C.get('news')
        items = []
        if news:
            for i, n in enumerate(news[:16]):
                dt = datetime.fromtimestamp(n['pub'], TRT)
                items.append({'id': f"h{i:02d}", 'kind': 'haber', 'when': when(dt), 'sort': dt.strftime('%Y-%m-%dT%H:%M'), 'title': n['title'], 'detail': '',
                              'assets': tag_assets(n['title']), 'impact': 'otomatik başlık; yön değerlendirilmedi',
                              'importance': 'Yüksek' if re.search(HIGH, n['title'].lower()) else 'Orta', 'source': n.get('source') or 'Google Haberler'})
        else:
            items += [x for x in prev_ag if x.get('kind') == 'haber']
        cal = C.get('calendar')
        CT = {'USD': 'ABD', 'EUR': 'Euro Bölgesi', 'GBP': 'İngiltere', 'JPY': 'Japonya', 'CNY': 'Çin', 'TRY': 'Türkiye', 'CHF': 'İsviçre', 'CAD': 'Kanada', 'AUD': 'Avustralya'}
        if cal is not None:
            lo, hi = now - timedelta(hours=8), now + timedelta(hours=48)
            j = 0
            for e in sorted(cal, key=lambda x: x['t']):
                dt = datetime.fromtimestamp(e['t'], TRT)
                if not (lo <= dt <= hi) or e['country'] not in CT:
                    continue
                if not (e['impact'] == 'High' or (e['impact'] == 'Medium' and e['country'] in ('USD', 'EUR'))):
                    continue
                det = ' · '.join(x for x in (f"beklenti {e['forecast']}" if e['forecast'] else '', f"önceki {e['previous']}" if e['previous'] else '') if x)
                items.append({'id': f"c{j:02d}", 'kind': 'takvim', 'when': when(dt), 'sort': dt.strftime('%Y-%m-%dT%H:%M'), 'title': f"{CT[e['country']]} · {e['title']}",
                              'detail': det, 'assets': e['country'], 'impact': '', 'importance': 'Yüksek' if e['impact'] == 'High' else 'Orta', 'source': 'Forex Factory takvimi'})
                j += 1
        else:
            items += [x for x in prev_ag if x.get('kind') == 'takvim']
        patch['agenda'] = items

    # ---- durum ve özet
    errs = C.get('errors') or []
    parts = []
    if g is not None:
        parts.append(f"Ons {tr(g, 0)} $ ({pct(gc, 1)})")
    if theo:
        parts.append(f"gram ≈{tr(theo, 0)} TL")
    if usd:
        parts.append(f"USD/TRY {tr(usd, 2)} ({pct(uc, 2)})")
    if price('XU100') is not None:
        parts.append(f"BIST {tr(price('XU100'), 0)} ({pct(xc, 1)})")
    n_today = len([a for a in (prev_app.get('alerts') or []) if a.get('id', '').startswith(today)]) + len(alerts)
    summary = ' · '.join(parts) + (f" · bugün {n_today} uyarı" if n_today else '')
    notes = []
    if not locs:
        notes.append('Yerel altın fiyatı alınamadı; gram altın teorik hesaplandı (COMEX vadeli ons ile)' if not ons_spot else 'Yerel altın fiyatı alınamadı')
    miss = [e.split(':')[0].replace('fiyat ', '') for e in errs if e.startswith('fiyat ')]
    if miss:
        notes.append(f"Alınamayan fiyat: {', '.join(miss[:6])}")
    if is_seans and not tables_ok:
        notes.append('Teknik görünüm yenilenemedi; önceki hesap gösteriliyor')
    status = {'updated_trt': RT, 'session': sess_title, 'summary': summary, 'next_session': next_session_label(now), 'note': '; '.join(notes)}
    report_rel = None
    if is_seans and tables_ok:
        meta = load(os.path.join(WORK, 'tables_meta.json'), {})
        rows = meta.get('rows', [])
        npos = sum(1 for x in rows if x['bias'] == 'pozitif'); nneg = sum(1 for x in rows if x['bias'] == 'negatif')
        status['summary'] = (summary + f" · teknik: {npos} pozitif, {nneg} negatif")[:230]
        status['tech_asof'] = f"{now.day} {AY[now.month - 1]} {hhmm} ({sname.lower()} seansı, otomatik)"
        report_rel = f"raporlar/{today}_{session}.md"
        status['report'] = report_rel
        write_report(os.path.join(ROOT, report_rel), now, sname, stime, rows, Q, FX, alerts, prev_app, patch.get('agenda', []), C, notes, n_eval)
    patch['status'] = status
    if alerts:
        patch['alerts_add'] = alerts
    dump(os.path.join(WORK, 'patch.json'), patch)

    cmd = [sys.executable, os.path.join(ROOT, 'engine', 'build_app_data.py'), '--prev', APP, '--snapshots', os.path.join(WORK, 'snap.csv'), '--snap-session', label,
           '--inputs', os.path.join(WORK, 'inputs.json'), '--forecast', FORECAST, '--patch', os.path.join(WORK, 'patch.json'), '--out', APP]
    if is_seans and tables_ok:
        cmd += ['--tech', os.path.join(WORK, 'technical_summary.csv')]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        fail('build_app_data hatası: ' + (r.stderr or r.stdout)[-1500:])

    # ---- durum dosyaları
    if is_seans:
        st = load(os.path.join(STATE, 'sessions.json'), {})
        st.setdefault(today, [])
        if session not in st[today]:
            st[today].append(session)
        for d in list(st.keys()):
            if d < (now - timedelta(days=7)).strftime('%Y-%m-%d'):
                del st[d]
        dump(os.path.join(STATE, 'sessions.json'), st)
        hist, hf = read_csv(SNAP_HIST)
        cut = (now - timedelta(days=45)).strftime('%Y-%m-%d')
        if hf:
            write_csv(SNAP_HIST, [x for x in hist if x.get('ts_trt', '') >= cut], hf)
    dump(os.path.join(STATE, 'son_calisma.json'), {'run_trt': RT, 'mode': mode, 'label': label, 'yahoo_host': C.get('yahoo_host'), 'seconds_collect': C.get('seconds'),
                                                  'prices': len(Q), 'fx': len(FX), 'local': list(LOC.keys()), 'errors': errs[:40], 'alerts_new': len(alerts),
                                                  'forecasts_evaluated': n_eval, 'tables_ok': tables_ok, 'report': report_rel})
    print(f"bitti: {mode} {label} · uyarı {len(alerts)} · değerlendirilen tahmin {n_eval} · hata {len(errs)}")


def write_report(path, now, sname, stime, rows, Q, FX, alerts, prev_app, agenda, C, notes, n_eval):
    T = lambda n: open(os.path.join(WORK, '_tables', n), encoding='utf-8').read() if os.path.exists(os.path.join(WORK, '_tables', n)) else '(üretilemedi)\n'
    movers = []
    for k, q in Q.items():
        c = FX[k]['chg'] if k in FX else q.get('chg')
        if c is not None and k in NAMES and q.get('time', '')[:10] == now.strftime('%Y-%m-%d'):
            movers.append((abs(c), k, c))
    movers.sort(reverse=True)
    npos = [x for x in rows if x['bias'] == 'pozitif']; nneg = [x for x in rows if x['bias'] == 'negatif']
    flags = []
    for x in rows:
        m = re.match(r'([\d,]+)', x['rsi'])
        rv = fnum(m.group(1).replace(',', '.')) if m else None
        if rv is not None and (rv >= 70 or rv <= 30):
            flags.append(f"{NAMES.get(x['k'], x['k'])}: RSI {tr(rv, 1)} ({'aşırı alım' if rv >= 70 else 'aşırı satım'}) — tek başına dönüş sinyali değildir.")
    for x in rows:
        if 'dikkat' in x['rev'] or 'erken toparlanma' in x['rev']:
            flags.append(f"{NAMES.get(x['k'], x['k'])}: {x['t'].lower()}, {x['rev']}.")
    L = []
    L.append(f"# GMI {sname} raporu — {now.day} {AY[now.month - 1]} {now.year}, {now:%H:%M} TSİ\n")
    L.append("> Otomatik rapor (GitHub Actions). Fiyat ve teknik bölümler kurallara dayanır; haberler yalnız başlık olarak listelenir ve yorumlanmaz. "
             "Sayısal olasılık içermez. **Yatırım tavsiyesi değildir.**\n")
    L.append('## A) Genel özet\n')
    if movers:
        L.append('- En büyük günlük hareketler: ' + '; '.join(f"{NAMES[k]} {pct(c)}" for _, k, c in movers[:4]) + '.')
    L.append(f"- Günlük teknik görünüm (7 oylu skor): {len(npos)} varlık pozitif, {len(nneg)} negatif, {len(rows) - len(npos) - len(nneg)} karışık.")
    if npos:
        L.append('- Pozitif: ' + ', '.join(NAMES.get(x['k'], x['k']) for x in npos) + '.')
    if nneg:
        L.append('- Negatif: ' + ', '.join(NAMES.get(x['k'], x['k']) for x in nneg) + '.')
    today_alerts = [a for a in (prev_app.get('alerts') or []) if a.get('id', '').startswith(now.strftime('%Y-%m-%d'))] + alerts
    if today_alerts:
        L.append('- Bugünkü uyarılar: ' + '; '.join(f"{a['time']} {a['asset']} — {a['title']}" for a in today_alerts[:6]) + '.')
    L.append('')
    L.append('## B) Fiyat tablosu\n'); L.append(T('prices.md'))
    L.append('## C) Teknik görünüm\n'); L.append('### C.1 Günlük görünüm ve skorlar\n'); L.append(T('tech.md'))
    L.append('### C.2 Destek ve direnç\n'); L.append(T('levels.md'))
    L.append('### C.3 Gün içi zaman dilimleri\n'); L.append(T('intraday.md'))
    L.append('### C.4 Haftalık görünüm\n'); L.append(T('weekly.md'))
    L.append('## Altın modülü\n'); L.append(T('gold.md')); L.append(T('gramlevels.md'))
    L.append('## D) Haber başlıkları (otomatik, yorumsuz)\n')
    hn = [a for a in agenda if a['kind'] == 'haber']
    if hn:
        for a in hn[:14]:
            L.append(f"- {a['when']} · {a['source']} — {a['title']} _(etiket: {a['assets']})_")
    else:
        L.append('- Haber başlıkları alınamadı.')
    L.append('\nHaberlerin önemi ve fiyat etkisi otomatik olarak değerlendirilmez. Etiketler başlıktaki anahtar sözcüklere göre atanır.\n')
    L.append('## E) Senaryolar (kural tabanlı)\n'); L.append(T('scen.md'))
    L.append('## F) Dikkat çeken noktalar (kural tabanlı)\n')
    for x in (flags[:5] or ['Kural tabanlı dikkat noktası yok.']):
        L.append(f"- {x}")
    L.append('\n## Ekonomik takvim (önümüzdeki 48 saat)\n')
    cal = [a for a in agenda if a['kind'] == 'takvim']
    for a in cal[:14]:
        L.append(f"- {a['when']} · {a['title']}" + (f" ({a['detail']})" if a['detail'] else '') + f" · önem: {a['importance']}")
    if not cal:
        L.append('- Takvim alınamadı veya önemli olay yok.')
    L.append('\n## Veri kalitesi\n')
    L.append(f"- Kaynaklar: Yahoo Finance ({C.get('yahoo_host', '').replace('https://', '')}), yerel altın: {', '.join((C.get('local') or {}).keys()) or 'alınamadı'}, "
             f"TCMB gösterge kurları: {'var' if C.get('tcmb') else 'alınamadı'}, haberler: Google Haberler RSS, takvim: Forex Factory.")
    L.append(f"- Değerlendirilen tahmin sayısı (bu çalışmada): {n_eval}. Tahminler 1 iş günü sonra aynı saatte, o andaki fiyatla değerlendirilir.")
    for n in notes:
        L.append(f"- {n}.")
    errs = C.get('errors') or []
    if errs:
        L.append(f"- Hatalar ({len(errs)}): " + '; '.join(errs[:10]))
    L.append('- Yahoo verisi belgelenmiş bir genel API değildir; vadeliler ≈10 dk, BIST/DAX/VIX ≈15 dk gecikmelidir. Döviz değişimleri NY kapanışına göre hesaplanır.')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(L) + '\n')


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == 'decide':
        opts = {a[i]: a[i + 1] if i + 1 < len(a) else '' for i in range(1, len(a), 2)}
        decide(opts)
    elif a[0] == 'run':
        run(a[1], a[2] if len(a) > 2 else 'K')
    else:
        sys.exit(__doc__)
