/* GMI telefon içi analiz motoru.
   Android uygulamasında (GMI_NATIVE köprüsü) Yahoo Finance ve Truncgil verisini telefondan çeker;
   göstergeleri, destek/direnci, skorları, kural tabanlı eğilim etiketlerini, geçmiş testini ve uygulama
   verisini (data/app_data.json ile aynı biçim) telefonda üretir. Sayısal olasılık üretmez; geçmiş testi
   yalnız geçmişte ne olduğunu sayar. Etiketler al-sat emri değildir. */
(function () {
  'use strict';
  var NATIVE = window.GMI_NATIVE || null;
  var ENG = (typeof GMI !== 'undefined') ? GMI : null;
  var OZ = 31.1034768;
  var isNum = function (x) { return typeof x === 'number' && isFinite(x); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var nowSec = function () { return Math.floor(Date.now() / 1000); };
  var trt = function (t) { return new Date((t + 10800) * 1000).toISOString().slice(0, 16).replace('T', ' '); };
  var trtDay = function (t) { return trt(t).slice(0, 10); };
  var MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

  /* ---------------- varlıklar ---------------- */
  // [anahtar, Yahoo sembolü, saatlik veri, ad, grup, sıra, birim, ondalık, gecikme, seans saatleri (TSİ)]
  var ASSETS = [
    ['GOLD_FUT', 'GC=F', 1, 'Ons altın (COMEX vadeli)', 'Altın ve metaller', 10, '$', 1, '≈10 dk gecikmeli', null],
    ['SILVER_FUT', 'SI=F', 1, 'Gümüş (COMEX vadeli)', 'Altın ve metaller', 16, '$', 3, '≈10 dk gecikmeli', null],
    ['PLAT_FUT', 'PL=F', 0, 'Platin (vadeli)', 'Altın ve metaller', 17, '$', 1, '≈10 dk gecikmeli', null],
    ['PALL_FUT', 'PA=F', 0, 'Paladyum (vadeli)', 'Altın ve metaller', 18, '$', 1, '≈10 dk gecikmeli', null],
    ['USDTRY', 'TRY=X', 1, 'USD/TRY', 'Döviz', 20, '', 4, 'anlık', null],
    ['EURTRY', 'EURTRY=X', 1, 'EUR/TRY', 'Döviz', 21, '', 4, 'anlık', null],
    ['GBPTRY', 'GBPTRY=X', 1, 'GBP/TRY', 'Döviz', 22, '', 4, 'anlık', null],
    ['EURUSD', 'EURUSD=X', 1, 'EUR/USD', 'Döviz', 23, '', 4, 'anlık', null],
    ['USDJPY', 'JPY=X', 1, 'USD/JPY', 'Döviz', 24, '', 3, 'anlık', null],
    ['DXY', 'DX-Y.NYB', 1, 'Dolar endeksi (DXY)', 'Döviz', 25, '', 2, '≈10 dk gecikmeli', null],
    ['BRENT', 'BZ=F', 1, 'Brent petrol', 'Enerji ve emtia', 30, '$', 2, '≈10 dk gecikmeli', null],
    ['WTI', 'CL=F', 0, 'WTI petrol', 'Enerji ve emtia', 31, '$', 2, '≈10 dk gecikmeli', null],
    ['NATGAS', 'NG=F', 0, 'Doğal gaz (Henry Hub)', 'Enerji ve emtia', 32, '$', 3, '≈10 dk gecikmeli', null],
    ['COPPER', 'HG=F', 0, 'Bakır ($/libre)', 'Enerji ve emtia', 33, '$', 4, '≈10 dk gecikmeli', null],
    ['XU100', 'XU100.IS', 1, 'BIST 100', 'Borsalar', 40, '', 2, '≈15 dk gecikmeli', ['10:00', '18:10']],
    ['ES_FUT', 'ES=F', 1, 'S&P 500 vadeli', 'Borsalar', 41, '', 2, '≈10 dk gecikmeli', null],
    ['SPX', '^GSPC', 0, 'S&P 500', 'Borsalar', 42, '', 2, 'seans içi', ['17:30', '24:00']],
    ['NDX', '^NDX', 0, 'Nasdaq 100', 'Borsalar', 43, '', 2, 'seans içi', ['17:30', '24:00']],
    ['DJI', '^DJI', 0, 'Dow Jones', 'Borsalar', 44, '', 2, 'seans içi', ['17:30', '24:00']],
    ['DAX', '^GDAXI', 1, 'DAX', 'Borsalar', 45, '', 2, '≈15 dk gecikmeli', ['11:00', '19:30']],
    ['NIKKEI', '^N225', 0, 'Nikkei 225', 'Borsalar', 46, '', 2, '≈15–20 dk gecikmeli', ['03:00', '09:30']],
    ['HSI', '^HSI', 0, 'Hang Seng', 'Borsalar', 47, '', 2, '≈15–20 dk gecikmeli', ['04:30', '11:00']],
    ['SSE', '000001.SS', 0, 'Şanghay Bileşik', 'Borsalar', 48, '', 2, '≈15–20 dk gecikmeli', ['04:30', '10:00']],
    ['US10Y', '^TNX', 0, 'ABD 10 yıllık faiz', 'Faiz ve risk', 50, '%', 3, '≈15 dk gecikmeli', null],
    ['VIX', '^VIX', 0, 'VIX oynaklık endeksi', 'Faiz ve risk', 51, '', 2, '≈15 dk gecikmeli', null],
    ['BTC', 'BTC-USD', 1, 'Bitcoin', 'Kripto', 60, '$', 0, 'anlık', null]
  ];
  var A = {};
  ASSETS.forEach(function (x) { A[x[0]] = { key: x[0], sym: x[1], intra: x[2], name: x[3], group: x[4], order: x[5], unit: x[6], dp: x[7], lat: x[8], sess: x[9] }; });
  A.GRAM = { key: 'GRAM', sym: '', intra: 1, name: 'Gram altın (teorik)', group: 'Altın ve metaller', order: 12, unit: 'TL', dp: 2, lat: 'hesap', sess: null };
  var FXKEYS = ['USDTRY', 'EURTRY', 'GBPTRY', 'EURUSD', 'USDJPY'];
  var STEP = { GOLD_FUT: 50, SILVER_FUT: 1, PLAT_FUT: 50, PALL_FUT: 50, USDTRY: 0.25, EURTRY: 0.5, EURUSD: 0.005, GBPTRY: 0.5, USDJPY: 1, DXY: 0.5,
    BRENT: 5, WTI: 5, NATGAS: 0.25, COPPER: 0.25, XU100: 250, SPX: 100, ES_FUT: 100, NDX: 500, DJI: 500, DAX: 250, US10Y: 0.25, VIX: 5, BTC: 2500, GRAM: 100 };
  var VOL_OK = { GOLD_FUT: 1, SILVER_FUT: 1, BRENT: 1, WTI: 1, NATGAS: 1, COPPER: 1, XU100: 1, SPX: 1, ES_FUT: 1, NDX: 1, DJI: 1, DAX: 1, BTC: 1 };
  var SIGNAL_KEYS = ['GRAM', 'GOLD_FUT', 'SILVER_FUT', 'PLAT_FUT', 'PALL_FUT', 'USDTRY', 'EURTRY', 'GBPTRY', 'EURUSD', 'USDJPY', 'DXY', 'BRENT', 'WTI', 'NATGAS',
    'COPPER', 'XU100', 'ES_FUT', 'NDX', 'DJI', 'DAX', 'US10Y', 'VIX', 'BTC'];

  /* ---------------- ağ ---------------- */
  var pending = {}, seq = 0;
  window.__gmiNative = function (id, code, body) {
    var cb = pending[id];
    if (!cb) return;
    delete pending[id];
    cb({ status: code, body: body });
  };
  function get(url, timeoutMs) {
    if (!NATIVE) {
      return fetch(url, { cache: 'no-store' }).then(function (r) { return r.text().then(function (t) { return { status: r.status, body: t }; }); })
        .catch(function (e) { return { status: 0, body: String((e && e.message) || e) }; });
    }
    return new Promise(function (res) {
      var id = 'q' + (++seq);
      pending[id] = res;
      try { NATIVE.fetch(id, url); } catch (e) { delete pending[id]; res({ status: 0, body: String(e) }); return; }
      setTimeout(function () { if (pending[id]) { delete pending[id]; res({ status: 0, body: 'zaman aşımı' }); } }, timeoutMs || 40000);
    });
  }
  async function chart(sym, range, interval) {
    var path = '/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + range + '&interval=' + interval + '&includePrePost=false';
    for (var a = 0; a < 3; a++) {
      var host = a === 2 ? 'https://query2.finance.yahoo.com' : 'https://query1.finance.yahoo.com';
      var r = await get(host + path);
      if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
      var j = null;
      try { j = JSON.parse(r.body); } catch (e) { if (a === 2) return { err: 'HTTP ' + r.status }; await sleep(700); continue; }
      var res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res) return { err: (j && j.chart && j.chart.error && j.chart.error.description) || ('HTTP ' + r.status) };
      var ts = res.timestamp || [], q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {}, bars = [];
      for (var k = 0; k < ts.length; k++) {
        var o = q.open && q.open[k], h = q.high && q.high[k], l = q.low && q.low[k], c = q.close && q.close[k];
        if (isNum(o) && isNum(h) && isNum(l) && isNum(c)) bars.push({ t: ts[k], o: o, h: h, l: l, c: c, v: (q.volume && q.volume[k]) || 0 });
      }
      return { meta: res.meta || {}, bars: bars };
    }
    return { err: 'Yahoo çok sık istek uyarısı verdi (HTTP 429)' };
  }

  /* ---------------- önbellek ---------------- */
  var CK = 'gmi-b1:';
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) {
    var s = JSON.stringify(v);
    try { localStorage.setItem(k, s); return true; } catch (e) {
      try { // yer açmak için saatlik önbellekleri sil
        Object.keys(localStorage).forEach(function (x) { if (x.indexOf(CK) === 0 && /\|h$/.test(x)) localStorage.removeItem(x); });
        localStorage.setItem(k, s); return true;
      } catch (e2) { return false; }
    }
  }
  var r7 = function (x) { return +(+x).toPrecision(7); };
  function pack(b) { return b.map(function (x) { return [x.t, r7(x.o), r7(x.h), r7(x.l), r7(x.c), x.v || 0]; }); }
  function unpack(a) { return (a || []).map(function (x) { return { t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] }; }); }
  function mergeBars(old, nw, keyFn) {
    var m = new Map();
    old.forEach(function (x) { m.set(keyFn(x.t), x); });
    nw.forEach(function (x) { m.set(keyFn(x.t), x); });
    return Array.from(m.values()).sort(function (a, b) { return a.t - b.t; });
  }
  // Günlük 2 yıllık ve saatlik 3 aylık veri günde bir kez tam çekilir; gün içinde yalnız son 5 gün eklenir.
  async function series(sym, kind) {
    var daily = kind === 'd', ck = CK + sym + '|' + kind, c = lsGet(ck), today = trtDay(nowSec());
    var fresh = !!(c && c.day === today && c.b && c.b.length > 60);
    var d = await chart(sym, fresh ? '5d' : (daily ? '2y' : '3mo'), daily ? '1d' : '60m');
    if (d.err) return c ? { meta: c.meta || {}, bars: unpack(c.b), stale: true, err: d.err } : { err: d.err };
    var bars = d.bars;
    if (fresh) {
      var off = (d.meta && d.meta.gmtoffset) || 0;
      var keyFn = daily ? function (t) { return new Date((t + off) * 1000).toISOString().slice(0, 10); } : function (t) { return Math.floor(t / 3600); };
      bars = mergeBars(unpack(c.b), d.bars, keyFn);
    }
    bars = bars.slice(daily ? -520 : -1700);
    lsSet(ck, { day: today, meta: d.meta, b: pack(bars) });
    return { meta: d.meta, bars: bars };
  }
  function cachedSeries(sym, kind) {
    var c = lsGet(CK + sym + '|' + kind);
    return c ? { meta: c.meta || {}, bars: unpack(c.b), stale: true } : null;
  }

  /* ---------------- yardımcılar ---------------- */
  function f(x) { var v = parseFloat(x); return isFinite(v) ? v : null; }
  function gt(a, b) { return (a == null || b == null) ? null : a > b; }
  function parseRow(head, line) { var h = head.split(','), v = line.split(','), o = {}; h.forEach(function (k, i) { o[k] = v[i]; }); return o; }
  function clone(b) { return b.map(function (x) { return { t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }; }); }
  function tr(x, d) {
    if (x == null || !isFinite(x)) return '—';
    return x.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(x, d) { return x == null ? '—' : ((x > 0 ? '+' : (x < 0 ? '−' : '')) + '%' + tr(Math.abs(x), d == null ? 2 : d)); }
  function nthSunday(y, m0, n) { var first = Date.UTC(y, m0, 1) / 1000, dow = new Date(first * 1000).getUTCDay(); return first + ((7 - dow) % 7) * 86400 + (n - 1) * 7 * 86400; }
  function usDST(t) { var y = new Date(t * 1000).getUTCFullYear(); return t >= nthSunday(y, 2, 2) + 7 * 3600 && t < nthSunday(y, 10, 1) + 6 * 3600; }
  function nyKey(t) { return new Date((t + (usDST(t) ? 3 : 2) * 3600) * 1000).toISOString().slice(0, 10); }
  function minutes(hhmm) { var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  async function pool(items, n, fn) {
    var i = 0;
    await Promise.all(Array.from({ length: n }, async function () { while (i < items.length) { var it = items[i++]; await fn(it); } }));
  }

  /* ---------------- kurallar (GMI motoru v1.0 ile aynı) ---------------- */
  function dscore(r) {
    var p = f(r.price_engine), g = function (k) { return f(r[k]); }, votes = [];
    function add(c, yes, no) { if (c !== null) votes.push({ ok: c, txt: c ? yes : no }); }
    add(gt(p, g('sma50')), 'Fiyat 50 günlük ortalamanın üstünde', 'Fiyat 50 günlük ortalamanın altında');
    add(gt(p, g('sma200')), 'Fiyat 200 günlük ortalamanın üstünde', 'Fiyat 200 günlük ortalamanın altında');
    add(gt(g('ema9'), g('ema21')), 'Kısa ortalama (EMA9) uzunun (EMA21) üstünde', 'Kısa ortalama (EMA9) uzunun (EMA21) altında');
    add(gt(g('macd'), g('macd_sig')), 'MACD sinyal çizgisinin üstünde', 'MACD sinyal çizgisinin altında');
    add(gt(g('rsi'), 50), 'RSI 50 üstünde (' + tr(g('rsi'), 0) + ')', 'RSI 50 altında (' + tr(g('rsi'), 0) + ')');
    add(r.psar_up === 'true' ? true : (r.psar_up === 'false' ? false : null), 'Parabolic SAR yukarı yönlü', 'Parabolic SAR aşağı yönlü');
    add(gt(g('pdi'), g('mdi')), 'Yön göstergesi alıcılar lehine (+DI > −DI)', 'Yön göstergesi satıcılar lehine (−DI > +DI)');
    var s = 0; votes.forEach(function (v) { s += v.ok ? 1 : -1; });
    return { s: s, n: votes.length, votes: votes };
  }
  function stscore(rows) {
    var s = 0, n = 0;
    rows.forEach(function (r) {
      if (!r) return;
      [gt(f(r.ema9), f(r.ema21)), gt(f(r.macd_hist), 0), gt(f(r.rsi), 50)].forEach(function (c) { if (c === null) return; s += c ? 1 : -1; n += 1; });
    });
    return n ? { s: s, n: n } : { s: null, n: 0 };
  }
  function trend(r) {
    var p = f(r.price_engine), s50 = f(r.sma50), s200 = f(r.sma200), adx = f(r.adx), pdi = f(r.pdi), mdi = f(r.mdi);
    if ([p, s50, s200].some(function (x) { return x == null; })) return 'veri yetersiz';
    var strong = adx != null && adx >= 25;
    if (p > s50 && p > s200) return s50 > s200 ? (strong && pdi > mdi ? 'Güçlü yükseliş' : 'Yükseliş') : 'Yükselişe dönüş (SMA50<SMA200)';
    if (p < s50 && p < s200) return s50 < s200 ? (strong && mdi > pdi ? 'Güçlü düşüş' : 'Düşüş') : 'Düşüşe dönüş (SMA50>SMA200)';
    if (p > s200) return 'Uzun vade yukarı, kısa vade düzeltme';
    return 'Uzun vade aşağı, kısa vade tepki';
  }
  function rsiState(x) {
    if (x == null) return '—';
    return x >= 70 ? 'aşırı alım' : x <= 30 ? 'aşırı satım' : x >= 60 ? 'güçlü' : x <= 40 ? 'zayıf' : 'nötr';
  }
  function levels(k, r, w) {
    var p = f(r.price_engine), atr = f(r.atr14) || 0, c = [];
    function add(lbl, x) { x = typeof x === 'number' ? x : f(x); if (x) c.push([x, lbl]); }
    if (r.piv_r1 !== r.piv_s1) ['s1', 's2', 'r1', 'r2'].forEach(function (n) { add('pivot ' + n.toUpperCase(), r['piv_' + n]); });
    ['sma20', 'sma50', 'sma100', 'sma200'].forEach(function (n) { add(n.toUpperCase(), r[n]); });
    add('Bollinger alt', r.bb_l); add('Bollinger üst', r.bb_u);
    [['fib_236', 'Fib %23,6'], ['fib_382', 'Fib %38,2'], ['fib_500', 'Fib %50'], ['fib_618', 'Fib %61,8'], ['fib_786', 'Fib %78,6']].forEach(function (x) { add(x[1], r[x[0]]); });
    ['sup1', 'sup2', 'sup3'].forEach(function (n) { add('dip', r[n]); });
    ['res1', 'res2', 'res3'].forEach(function (n) { add('tepe', r[n]); });
    if (w) { add('haftalık S1', w.wpiv_s1); add('haftalık R1', w.wpiv_r1); }
    var st = STEP[k];
    if (st && p) { add('psikolojik', Math.floor(p / st) * st); add('psikolojik', Math.ceil(p / st) * st); }
    var tol = Math.max(0.15 * atr, (p || 0) * 0.0005);
    function cluster(xs) {
      var out = [];
      xs.forEach(function (z) {
        var last = out[out.length - 1];
        if (last && Math.abs(last.v - z[0]) <= tol) { if (last.labels.indexOf(z[1]) < 0) last.labels.push(z[1]); }
        else out.push({ v: z[0], labels: [z[1]] });
      });
      return out;
    }
    var sup = cluster(c.filter(function (z) { return z[0] < p - 1e-12; }).sort(function (a, b) { return b[0] - a[0]; }));
    var res = cluster(c.filter(function (z) { return z[0] > p + 1e-12; }).sort(function (a, b) { return a[0] - b[0]; }));
    return {
      sup: sup, res: res,
      msup: sup.filter(function (x) { return p - x.v >= 0.25 * atr; }).slice(0, 2),
      mres: res.filter(function (x) { return x.v - p >= 0.25 * atr; }).slice(0, 2)
    };
  }

  /* ---------------- sinyal ---------------- */
  // Etiketler bir emir değil, göstergelerin bugünkü eğilim özetidir (kodlar karne uyumluluğu için aynı kaldı).
  var SIG_LABEL = { GAL: 'Güçlü yükseliş eğilimi', AL: 'Yükseliş eğilimi', NOTR: 'Yön belirsiz', SAT: 'Düşüş eğilimi', GSAT: 'Güçlü düşüş eğilimi', VERI: 'Veri yetersiz' };
  var SIG_SHORT = { GAL: 'Güçlü yükseliş', AL: 'Yükseliş', NOTR: 'Belirsiz', SAT: 'Düşüş', GSAT: 'Güçlü düşüş', VERI: 'Veri yok' };
  function signal(t) {
    var ds = t.ds, ss = t.ss, code;
    if (ds == null || t.dn < 6) code = 'VERI';
    else if (ds >= 5 && (ss == null || ss >= 2)) code = 'GAL';
    else if (ds >= 3 && (ss == null || ss >= -1)) code = 'AL';
    else if (ds <= -5 && (ss == null || ss <= -2)) code = 'GSAT';
    else if (ds <= -3 && (ss == null || ss <= 1)) code = 'SAT';
    else code = 'NOTR';
    var notes = [], dp = (A[t.key] || {}).dp;
    var s1 = t.msup[0], r1 = t.mres[0];
    if (ds != null && ds >= 3 && ss != null && ss <= -2) notes.push('Günlük görünüm pozitif ama kısa vade (4 saat, 1 saat) negatif: çelişkili.');
    if (ds != null && ds <= -3 && ss != null && ss >= 2) notes.push('Günlük görünüm negatif ama kısa vade pozitif: tepki yükselişi olabilir.');
    if ((code === 'AL' || code === 'GAL') && t.rsi != null && t.rsi >= 70) notes.push('RSI aşırı alım bölgesinde: geri çekilme riski yüksek.');
    if ((code === 'SAT' || code === 'GSAT') && t.rsi != null && t.rsi <= 30) notes.push('RSI aşırı satım bölgesinde: tepki yükselişi riski yüksek.');
    if (t.adx != null && t.adx < 20) notes.push('ADX ' + tr(t.adx, 0) + ': trend zayıf, eğilim etiketleri daha sık yanılabilir.');
    var inv = '';
    if (code === 'AL' || code === 'GAL') inv = s1 ? tr(s1.v, dp) + ' altında günlük kapanış' : '';
    else if (code === 'SAT' || code === 'GSAT') inv = r1 ? tr(r1.v, dp) + ' üstünde günlük kapanış' : '';
    else if (s1 && r1) inv = tr(s1.v, dp) + ' – ' + tr(r1.v, dp) + ' bandı dışına kapanış yön verir';
    return { code: code, label: SIG_LABEL[code], notes: notes, invalid: inv };
  }

  /* ---------------- tek varlık analizi ---------------- */
  var IND_D = ['sma20', 'sma50', 'sma200', 'ema9', 'ema21', 'macd', 'macd_sig', 'macd_hist', 'macd_hist_prev', 'rsi', 'rsi_prev', 'adx', 'pdi', 'mdi',
    'bb_u', 'bb_m', 'bb_l', 'bb_pctb', 'atr14', 'h52', 'l52', 'day_h', 'day_l', 'roc12', 'prev_close', 'price_engine'];
  var IND_I = ['c', 'rsi', 'rsi_prev', 'macd', 'macd_sig', 'macd_hist', 'macd_hist_prev', 'ema9', 'ema21', 'adx', 'pdi', 'mdi'];
  var IND_W = ['c', 'chg_wtd_pct', 'rsi', 'macd_hist', 'macd_hist_prev', 'sma20'];
  function pick(r, keys) { var o = {}; keys.forEach(function (k) { var v = f(r[k]); if (v != null) o[k] = r7(v); }); return o; }
  function analyzeAsset(key, sym, d, h, ns) {
    var meta = d.meta || {}, off = meta.gmtoffset || 0;
    var D = parseRow(ENG.HEAD.D, ENG.dailyRow(key, sym, meta, clone(d.bars), ns));
    D.price_engine = D.price;
    var W = d.bars.length > 20 ? parseRow(ENG.HEAD.W, ENG.weeklyRow(key, d.bars, off)) : null;
    var H4 = null, H1 = null;
    if (h && h.bars && h.bars.length > 60) {
      H4 = parseRow(ENG.HEAD.I, ENG.tfRow('H4', key, ENG.resample(h.bars, 14400), off, false));
      H1 = parseRow(ENG.HEAD.I, ENG.tfRow('H1', key, h.bars, off, false));
    }
    var fx = null;
    if (FXKEYS.indexOf(key) >= 0 && h && h.bars && h.bars.length > 10) {
      var groups = new Map();
      h.bars.forEach(function (b) { var k = nyKey(b.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
      var ks = Array.from(groups.keys());
      if (ks.length >= 2) {
        var pb = groups.get(ks[ks.length - 2]);
        var H = Math.max.apply(null, pb.map(function (x) { return x.h; })), L = Math.min.apply(null, pb.map(function (x) { return x.l; })), C = pb[pb.length - 1].c;
        var live = isNum(meta.regularMarketPrice) ? meta.regularMarketPrice : h.bars[h.bars.length - 1].c;
        var P = ENG.pivots(H, L, C);
        fx = { live: live, prev: C, chg: 100 * (live / C - 1) };
        D.price = String(live); D.prev_close = String(C); D.chg_pct = (100 * (live / C - 1)).toFixed(2);
        D.piv_p = P.p; D.piv_r1 = P.r1; D.piv_r2 = P.r2; D.piv_r3 = P.r3; D.piv_s1 = P.s1; D.piv_s2 = P.s2; D.piv_s3 = P.s3;
      }
    }
    var dsr = dscore(D), ssr = stscore([H4, H1]), lv = levels(key, D, W);
    // yorum motoru için göstergelerin sayısal değerleri (günlük, 4 saat, 1 saat, haftalık)
    var ind = { d: pick(D, IND_D), h4: H4 ? pick(H4, IND_I) : null, h1: H1 ? pick(H1, IND_I) : null, w: W ? pick(W, IND_W) : null,
      psar_up: D.psar_up === 'true' ? true : (D.psar_up === 'false' ? false : null) };
    var t = {
      key: key, name: A[key].name, dp: A[key].dp, order: A[key].order,
      price: f(D.price), price_engine: f(D.price_engine), prev: f(D.prev_close), chg: f(D.chg_pct), time: D.time_trt, fx: !!fx,
      ds: dsr.s, dn: dsr.n, votes: dsr.votes, ss: ssr.s, sn: ssr.n, rsi: f(D.rsi), adx: f(D.adx), atr: f(D.atr14),
      trend: trend(D), rsiState: rsiState(f(D.rsi)), sup: lv.sup, res: lv.res, msup: lv.msup, mres: lv.mres,
      sma50: f(D.sma50), sma200: f(D.sma200), h52: f(D.h52), l52: f(D.l52), stale: !!d.stale, ind: ind
    };
    t.sig = signal(t);
    return t;
  }

  // Gram altın (teorik): COMEX vadeli ons × USD/TRY ÷ 31,1035 (günlük ve saatlik seriler zamana göre eşleştirilir)
  function gramSeries(gold, usd, kind) {
    if (!gold || !usd || !gold.bars || !usd.bars) return null;
    var keyFn = kind === 'd' ? function (t) { return new Date(t * 1000).toISOString().slice(0, 10); } : function (t) { return Math.floor(t / 3600); };
    var um = new Map();
    usd.bars.forEach(function (b) { um.set(keyFn(b.t), b); });
    var out = [], lastU = null;
    gold.bars.forEach(function (g) {
      var u = um.get(keyFn(g.t)) || lastU;
      if (!u) return;
      lastU = u;
      var o = g.o * u.o / OZ, c = g.c * u.c / OZ, hh = g.h * u.c / OZ, ll = g.l * u.c / OZ;
      out.push({ t: g.t, o: o, h: Math.max(hh, o, c), l: Math.min(ll, o, c), c: c, v: 0 });
    });
    return out.length > 60 ? out : null;
  }

  /* ---------------- yerel altın (Truncgil) ---------------- */
  async function truncgil() {
    var r = await get('https://finans.truncgil.com/v4/today.json', 20000);
    if (r.status !== 200) return null;
    try {
      var j = JSON.parse(r.body), time = (String(j.Update_Date || '').match(/(\d{2}:\d{2})/) || [])[1] || '';
      var pair = function (k) { var v = j[k]; return v && isNum(+v.Buying) && +v.Buying > 0 && isNum(+v.Selling) && +v.Selling > 0 ? [+v.Buying, +v.Selling, isNum(+v.Change) ? +v.Change : null] : null; };
      return {
        source: 'Truncgil', time: time, date: String(j.Update_Date || '').slice(0, 10),
        gram: pair('GRA'), has: pair('HAS'), ceyrek: pair('CEYREKALTIN'), yarim: pair('YARIMALTIN'), tam: pair('TAMALTIN'), ata: pair('ATAALTIN') || pair('CUMHURIYETALTINI'),
        gumus: pair('GUMUS'), usd: pair('USD'), eur: pair('EUR')
      };
    } catch (e) { return null; }
  }

  /* ---------------- spot ons ve gümüş (gold-api.com; ücretsiz, uygulamada kullanım serbest) ---------------- */
  async function spotMetals() {
    var out = {};
    await Promise.all([['XAU', 'ons'], ['XAG', 'gumus']].map(async function (x) {
      var r = await get('https://api.gold-api.com/price/' + x[0], 15000);
      if (r.status !== 200) return;
      try {
        var j = JSON.parse(r.body), px = +j.price, at = Date.parse(j.updatedAt || '');
        if (isNum(px) && px > 0) out[x[1]] = { price: px, time: isFinite(at) ? trt(Math.floor(at / 1000)).slice(11) : '', ts: isFinite(at) ? Math.floor(at / 1000) : null, source: 'gold-api.com' };
      } catch (e) { /* yok say */ }
    }));
    return out.ons || out.gumus ? out : null;
  }

  /* ---------------- gündem: haber başlıkları ve ekonomik takvim ---------------- */
  var QUERIES = ['altın fiyatları', 'dolar TL kur', 'TCMB faiz', 'Fed faiz Powell', 'petrol fiyatları Brent', 'Borsa İstanbul BIST'];
  var TAGS = [[/altın|\bons\b|gram|çeyrek|külçe/i, 'Altın'], [/gümüş/i, 'Gümüş'], [/dolar|\bkur\b|kurlar|döviz|türk lirası|euro/i, 'USD/TRY'],
    [/\bfed\b|powell|abd|enflasyon|istihdam|tarım dışı|hazine/i, 'ABD faizleri, DXY'], [/tcmb|merkez bankası|ppk|politika faizi/i, 'TL, BIST'],
    [/petrol|brent|opec|wti/i, 'Petrol'], [/borsa|bist/i, 'BIST 100'], [/bitcoin|kripto/i, 'Bitcoin'],
    [/savaş|saldırı|füze|ateşkes|iran|israil|rusya|ukrayna|hürmüz|gazze/i, 'Jeopolitik']];
  var HIGH = /faiz karar|faizi sabit|faiz indir|faiz artır|ppk|fomc|enflasyon|tüfe|üfe|istihdam|tarım dışı|savaş|saldırı|ateşkes|opec|rekor|çöküş|sert/i;
  function when(t) { var d = new Date((t + 10800) * 1000); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + trt(t).slice(11); }
  async function news() {
    var items = [], seen = {};
    await pool(QUERIES, 3, async function (q) {
      var r = await get('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:1d') + '&hl=tr&gl=TR&ceid=TR:tr', 20000);
      if (r.status !== 200) return;
      var doc = new DOMParser().parseFromString(r.body, 'text/xml');
      Array.prototype.forEach.call(doc.querySelectorAll('item'), function (it) {
        var g = function (s) { var e = it.querySelector(s); return e ? e.textContent.trim() : ''; };
        var title = g('title'), src = g('source'), pub = Date.parse(g('pubDate'));
        if (src && title.slice(-(src.length + 3)) === ' - ' + src) title = title.slice(0, -(src.length + 3));
        var norm = title.toLowerCase().replace(/[^a-zçğıöşü0-9 ]/gi, '').slice(0, 70);
        if (!title || seen[norm] || !isFinite(pub)) return;
        seen[norm] = 1;
        items.push({ title: title, source: src, link: g('link'), pub: Math.floor(pub / 1000) });
      });
    });
    var cut = nowSec() - 30 * 3600;
    return items.filter(function (x) { return x.pub >= cut; }).sort(function (a, b) { return b.pub - a.pub; }).slice(0, 16).map(function (n, i) {
      var tags = TAGS.filter(function (x) { return x[0].test(n.title); }).map(function (x) { return x[1]; });
      return { id: 'h' + i, kind: 'haber', when: when(n.pub), sort: trt(n.pub).replace(' ', 'T'), title: n.title, detail: '', link: n.link,
        assets: tags.filter(function (v, i2, a) { return a.indexOf(v) === i2; }).join(', ') || 'Genel', impact: 'otomatik başlık; yön değerlendirilmedi',
        importance: HIGH.test(n.title) ? 'Yüksek' : 'Orta', source: n.source || 'Google Haberler' };
    });
  }
  var CT = { USD: 'ABD', EUR: 'Euro Bölgesi', GBP: 'İngiltere', JPY: 'Japonya', CNY: 'Çin', CHF: 'İsviçre', CAD: 'Kanada', AUD: 'Avustralya' };
  async function calendar() {
    var r = await get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', 20000);
    if (r.status !== 200) return null;
    var j; try { j = JSON.parse(r.body); } catch (e) { return null; }
    var lo = nowSec() - 8 * 3600, hi = nowSec() + 48 * 3600, out = [];
    j.forEach(function (e) {
      var t = Math.floor(Date.parse(e.date) / 1000);
      if (!isFinite(t) || t < lo || t > hi || !CT[e.country]) return;
      if (!(e.impact === 'High' || (e.impact === 'Medium' && (e.country === 'USD' || e.country === 'EUR')))) return;
      var det = [e.forecast ? 'beklenti ' + e.forecast : '', e.previous ? 'önceki ' + e.previous : ''].filter(Boolean).join(' · ');
      out.push({ id: 'c' + out.length, kind: 'takvim', when: when(t), sort: trt(t).replace(' ', 'T'), title: CT[e.country] + ' · ' + e.title, detail: det,
        assets: e.country, impact: '', importance: e.impact === 'High' ? 'Yüksek' : 'Orta', source: 'Forex Factory takvimi' });
    });
    return out.sort(function (a, b) { return a.sort < b.sort ? -1 : 1; });
  }

  /* ---------------- sinyal karnesi (telefonda tutulur) ---------------- */
  var SL = 'gmi-sinyal-log';
  function updateSignalLog(techRows, ns) {
    var log = lsGet(SL) || [], last = {};
    log.forEach(function (e) { if (!last[e.k] || e.t > last[e.k].t) last[e.k] = e; });
    var price = {};
    techRows.forEach(function (t) { price[t.key] = t.price; });
    // değerlendir: 24–72 saat sonra o anki fiyatla
    log.forEach(function (e) {
      if (e.r || ns - e.t < 24 * 3600 || price[e.k] == null) return;
      if (ns - e.t > 72 * 3600) { e.r = 'süresi geçti'; return; }
      var ch = price[e.k] / e.p - 1;
      if (e.c === 'NOTR' || e.c === 'VERI') e.r = 'yönsüz';
      else if (Math.abs(ch) <= 0.0025) e.r = 'yatay';
      else e.r = ((ch > 0) === (e.c === 'AL' || e.c === 'GAL')) ? 'isabet' : 'ıska';
      e.a = price[e.k]; e.at = ns;
    });
    techRows.forEach(function (t) {
      if (!t.sig || t.sig.code === 'VERI' || t.price == null || t.stale) return;
      var L = last[t.key];
      if (L && ns - L.t < 20 * 3600 && L.c === t.sig.code) return;
      log.push({ t: ns, k: t.key, c: t.sig.code, p: t.price });
    });
    var cut = ns - 75 * 86400;
    log = log.filter(function (e) { return e.t >= cut; }).slice(-1500);
    lsSet(SL, log);
    return log;
  }
  function perfRows(log) {
    return log.filter(function (e) { return e.r && e.r !== 'süresi geçti'; }).sort(function (a, b) { return b.t - a.t; }).slice(0, 120).map(function (e) {
      var a = A[e.k] || { name: e.k, dp: 2 };
      return { id: e.t + '|' + e.k, issued: trt(e.t), key: e.k, name: a.name, dp: a.dp, ref_price: e.p, actual_price: e.a,
        chg_pct: e.a && e.p ? 100 * (e.a / e.p - 1) : null, daily_bias: SIG_SHORT[e.c] || e.c, direction_hit: e.r,
        level_notes: 'değerlendirme ' + trt(e.at || e.t), evaluate_at: '' };
    });
  }

  /* ---------------- uyarılar (uygulama açıkken) ---------------- */
  var AL = 'gmi-uyarilar';
  function checkAlerts(tech, prevLevels, gramChg, gramPx, ns) {
    var today = trtDay(ns), hhmm = trt(ns).slice(11), st = lsGet(AL) || { seen: {}, list: [] };
    if (!st.seen[today]) st.seen = (function () { var o = {}; o[today] = {}; return o; })();
    var seen = st.seen[today], out = [];
    var T = {}; tech.forEach(function (t) { T[t.key] = t; });
    function fresh(t) { return t && t.time && t.time.slice(0, 10) === today; }
    function add(k, asset, title, detail) {
      if (seen[k]) return;
      seen[k] = hhmm;
      out.push({ id: today + '-' + hhmm.replace(':', '') + '-' + k, time: today + ' ' + hhmm, asset: asset, title: title, detail: detail, level: 'uyarı', session: 'Uygulama' });
    }
    var g = T.GOLD_FUT, u = T.USDTRY;
    if (fresh(g) && g.chg != null && Math.abs(g.chg) >= 1.5) add('ons-yuzde' + (g.chg >= 0 ? '+' : '-'), 'Ons altın', 'Günlük ' + pct(g.chg), 'COMEX vadeli ' + tr(g.price, 1) + ' $; eşik ±%1,5');
    if (gramChg != null && Math.abs(gramChg) >= 1.5) add('gram-yuzde' + (gramChg >= 0 ? '+' : '-'), 'Gram altın', 'Günlük ' + pct(gramChg), 'Gram altın ' + tr(gramPx, 2) + ' TL; eşik ±%1,5');
    Object.keys(prevLevels || {}).forEach(function (k) {
      var t = T[k], L = prevLevels[k];
      if (!t || !L || !fresh(t) || !A[k]) return;
      var dp = A[k].dp, u = A[k].unit ? ' ' + A[k].unit : '', nm = L.name || A[k].name, al = L.code === 'AL' || L.code === 'GAL', sat = L.code === 'SAT' || L.code === 'GSAT';
      if (L.s1 != null && t.price < L.s1) add(k + '-s1-' + L.s1, nm, (al ? 'Yükseliş eğilimi bozuldu: destek ' : 'Destek ') + tr(L.s1, dp) + u + ' kırıldı', nm + ' ' + tr(t.price, dp) + u + ' · seviye ' + L.asof + ' analizinden (' + (L.s1_note || '') + ')');
      if (L.r1 != null && t.price > L.r1) add(k + '-r1-' + L.r1, nm, (sat ? 'Düşüş eğilimi bozuldu: direnç ' : 'Direnç ') + tr(L.r1, dp) + u + ' aşıldı', nm + ' ' + tr(t.price, dp) + u + ' · seviye ' + L.asof + ' analizinden (' + (L.r1_note || '') + ')');
    });
    if (u && u.chg != null && Math.abs(u.chg) >= 0.5) add('usdtry-yuzde' + (u.chg >= 0 ? '+' : '-'), 'USD/TRY', 'Günlük ' + pct(u.chg), 'USD/TRY ' + tr(u.price, 4) + ' (NY kapanışına göre); eşik ±%0,5');
    var b = T.BRENT; if (fresh(b) && b.chg != null && Math.abs(b.chg) >= 3) add('brent-yuzde' + (b.chg >= 0 ? '+' : '-'), 'Brent', 'Günlük ' + pct(b.chg), 'Brent ' + tr(b.price, 2) + ' $; eşik ±%3');
    var x = T.XU100; if (fresh(x) && x.chg != null && Math.abs(x.chg) >= 2) add('bist-yuzde' + (x.chg >= 0 ? '+' : '-'), 'BIST 100', 'Günlük ' + pct(x.chg), 'BIST 100 ' + tr(x.price, 0) + '; eşik ±%2');
    var v = T.VIX; if (fresh(v) && v.price >= 25) add('vix-25', 'VIX', 'VIX ' + tr(v.price, 2) + ' (25 üstü)', 'Piyasada oynaklık beklentisi yüksek.');
    if (fresh(v) && v.chg >= 15) add('vix-sicrama', 'VIX', 'Günlük ' + pct(v.chg), 'VIX ' + tr(v.price, 2) + '; eşik +%15');
    var n10 = T.US10Y; if (fresh(n10) && n10.prev != null) { var bp = (n10.price - n10.prev) * 100; if (Math.abs(bp) >= 10) add('us10y-bp' + (bp >= 0 ? '+' : '-'), 'ABD 10Y faiz', (bp > 0 ? '+' : '−') + tr(Math.abs(bp), 1) + ' bp', '10 yıllık faiz %' + tr(n10.price, 3) + '; eşik ±10 bp'); }
    // arka plan uyarıları (Android işçisi)
    var bg = [];
    if (NATIVE && NATIVE.backgroundAlerts) { try { bg = JSON.parse(NATIVE.backgroundAlerts() || '[]'); } catch (e) { bg = []; } }
    bg.forEach(function (a) { var k = String(a.id || '').slice(16); if (a.id && a.id.slice(0, 10) === today && k) seen[k] = seen[k] || a.time.slice(11); });
    var all = st.list.concat(out).concat(bg), ids = {};
    st.list = all.filter(function (a) { if (ids[a.id]) return false; ids[a.id] = 1; return true; })
      .sort(function (a, b) { return a.time < b.time ? 1 : -1; }).slice(0, 40);
    lsSet(AL, st);
    return { list: st.list, seenToday: Object.keys(seen), today: today };
  }

  /* ---------------- ana akış ---------------- */
  var MEM = { series: {}, tech: {} };
  var LAST = 'gmi-yerel-veri';
  async function run(onProgress) {
    if (!ENG) throw new Error('teknik motor yüklenemedi');
    var ns = nowSec(), errs = [], done = 0, total = ASSETS.length + 4;
    var prog = function (msg) { if (onProgress) onProgress(++done, total, msg); };
    var S = {};
    var extras = Promise.all([
      truncgil().then(function (x) { prog('Truncgil'); return x; }),
      (NATIVE ? news() : Promise.resolve(null)).then(function (x) { prog('haberler'); return x; }).catch(function () { return null; }),
      (NATIVE ? calendar() : Promise.resolve(null)).then(function (x) { prog('takvim'); return x; }).catch(function () { return null; }),
      spotMetals().then(function (x) { prog('spot ons'); return x; }).catch(function () { return null; })
    ]);
    await pool(ASSETS, 4, async function (a) {
      var d = await series(a[1], 'd'), h = null;
      if (!d.err || d.bars) { if (a[2]) h = await series(a[1], 'h'); }
      if (d.err) errs.push(A[a[0]].name + ': ' + d.err + (d.bars ? ' (önbellekteki veri kullanıldı)' : ''));
      S[a[0]] = { d: d, h: h };
      prog(A[a[0]].name);
    });
    var ex = await extras, TG = ex[0], NEWS = ex[1], CAL = ex[2], SP = ex[3];
    if (!TG) errs.push('Truncgil (yerel altın) alınamadı');
    if (!SP) errs.push('Spot ons (gold-api.com) alınamadı');

    // gram altın serisi
    if (S.GOLD_FUT && S.USDTRY && S.GOLD_FUT.d.bars && S.USDTRY.d.bars) {
      var gd = gramSeries(S.GOLD_FUT.d, S.USDTRY.d, 'd'), gh = gramSeries(S.GOLD_FUT.h, S.USDTRY.h, 'h');
      var gm = S.GOLD_FUT.d.meta || {}, um = S.USDTRY.d.meta || {};
      if (gd) {
        var lp = isNum(gm.regularMarketPrice) && isNum(um.regularMarketPrice) ? gm.regularMarketPrice * um.regularMarketPrice / OZ : gd[gd.length - 1].c;
        S.GRAM = { d: { meta: { regularMarketPrice: lp, regularMarketTime: gm.regularMarketTime, gmtoffset: 0 }, bars: gd, stale: S.GOLD_FUT.d.stale }, h: gh ? { meta: { gmtoffset: 0 }, bars: gh } : null, synthetic: true };
      }
    }

    // teknik analiz
    var tech = [];
    Object.keys(S).forEach(function (k) {
      var s = S[k];
      if (!s.d || !s.d.bars || s.d.bars.length < 60) return;
      try { tech.push(analyzeAsset(k, A[k].sym || 'GRAM', s.d, s.h, ns)); } catch (e) { errs.push(A[k].name + ': hesaplanamadı (' + e.message + ')'); }
    });
    tech.sort(function (a, b) { return a.order - b.order; });
    MEM.series = S; MEM.tech = {};
    tech.forEach(function (t) { MEM.tech[t.key] = t; });
    var T = MEM.tech;

    // fiyatlar
    var now = trt(ns), today = now.slice(0, 10), nowMin = minutes(now.slice(11));
    var prices = [];
    tech.forEach(function (t) {
      if (t.key === 'GRAM') return;
      var a = A[t.key], kind = a.lat, dmin = minutes((t.time || '').slice(11));
      if (t.time && t.time.slice(0, 10) < today) kind = 'önceki gün kapanışı';
      else if (a.sess && dmin != null) { var o = minutes(a.sess[0]), c = minutes(a.sess[1]); if (!(o <= nowMin && nowMin < c)) kind = 'kapanış'; }
      var chgAbs = (t.price != null && t.prev != null) ? t.price - t.prev : null;
      prices.push({ key: t.key, name: a.name, group: a.group, order: a.order, unit: a.unit, dp: a.dp, value: t.price, bid: null, ask: null, prev_close: t.prev,
        chg_pct: t.chg, chg_abs: chgAbs, chg_bp: t.key === 'US10Y' && chgAbs != null ? chgAbs * 100 : null, kind: kind + (t.stale ? ' (önbellek)' : ''),
        time: (t.time || '').slice(11), source: t.fx ? 'Yahoo Finance (NY kapanışına göre)' : 'Yahoo Finance', session: 'telefon', ts_trt: now });
    });
    var g = T.GOLD_FUT, u = T.USDTRY, theo = (g && u) ? g.price * u.price / OZ : null;
    var gramChg = (g && u && g.chg != null && u.chg != null) ? ((1 + g.chg / 100) * (1 + u.chg / 100) - 1) * 100 : null, gramPx = theo;
    if (theo) prices.push({ key: 'GRAM_ALTIN_TEORIK', name: 'Gram altın (teorik)', group: 'Altın ve metaller', order: 12, unit: 'TL', dp: 2, value: theo, bid: null, ask: null,
      prev_close: null, chg_pct: gramChg, chg_abs: null, chg_bp: null, kind: 'hesap', time: now.slice(11), source: 'hesap: COMEX vadeli ons × USD/TRY', session: 'telefon', ts_trt: now });
    if (TG && TG.gram) {
      prices.push({ key: 'GRAM_ALTIN_YEREL', name: 'Gram altın', group: 'Altın ve metaller', order: 13, unit: 'TL', dp: 2, value: null, bid: TG.gram[0], ask: TG.gram[1],
        prev_close: null, chg_pct: TG.gram[2], chg_abs: null, chg_bp: null, kind: 'anlık', time: TG.time, source: 'Truncgil', session: 'telefon', ts_trt: now });
      gramChg = TG.gram[2]; gramPx = TG.gram[1];
    }
    if (SP && SP.ons) prices.push({ key: 'ONS_SPOT', name: 'Ons altın (spot)', group: 'Altın ve metaller', order: 1.5, unit: '$', dp: 2, value: SP.ons.price, bid: null, ask: null,
      prev_close: null, chg_pct: null, chg_abs: null, chg_bp: null, kind: 'anlık', time: SP.ons.time, source: 'gold-api.com', session: 'telefon', ts_trt: now });
    if (SP && SP.gumus) prices.push({ key: 'GUMUS_SPOT', name: 'Gümüş (spot)', group: 'Altın ve metaller', order: 2.5, unit: '$', dp: 3, value: SP.gumus.price, bid: null, ask: null,
      prev_close: null, chg_pct: null, chg_abs: null, chg_bp: null, kind: 'anlık', time: SP.gumus.time, source: 'gold-api.com', session: 'telefon', ts_trt: now });
    if (TG && TG.has) prices.push({ key: 'HAS_ALTIN_YEREL', name: 'HAS altın', group: 'Altın ve metaller', order: 15, unit: 'TL', dp: 2, value: null, bid: TG.has[0], ask: TG.has[1],
      prev_close: null, chg_pct: TG.has[2], chg_abs: null, chg_bp: null, kind: 'anlık', time: TG.time, source: 'Truncgil', session: 'telefon', ts_trt: now });
    prices.sort(function (a, b) { return a.order - b.order; });

    // altın modülü
    var gold = [];
    if (theo) gold.push({ metric: 'THEO', label: 'Teorik gram (COMEX vadeli ons × USD/TRY ÷ 31,1035)', unit: 'TL', value: theo, bid: null, ask: null, theo: theo,
      diff_bid_pct: null, diff_ask_pct: null, spread_pct: null, time: now.slice(11), source: 'hesap', order: 1 });
    if (SP && SP.ons && u) gold.push({ metric: 'THEO_SPOT', label: 'Teorik gram (spot ons × USD/TRY ÷ 31,1035)', unit: 'TL', value: SP.ons.price * u.price / OZ, bid: null, ask: null,
      theo: theo, diff_bid_pct: null, diff_ask_pct: theo ? 100 * (SP.ons.price / g.price - 1) : null, spread_pct: null, time: SP.ons.time, source: 'gold-api.com', order: 1.5 });
    [['has', 'HAS', 'HAS altın (Truncgil)', 2], ['gram', 'RETAIL', 'Gram altın (Truncgil)', 3]].forEach(function (x) {
      var p = TG && TG[x[0]];
      if (!p) return;
      gold.push({ metric: x[1], label: x[2], unit: 'TL', value: null, bid: p[0], ask: p[1], theo: theo, diff_bid_pct: theo ? 100 * (p[0] / theo - 1) : null,
        diff_ask_pct: theo ? 100 * (p[1] / theo - 1) : null, spread_pct: 100 * (p[1] - p[0]) / p[0], time: TG.time, source: 'Truncgil', order: x[3] });
    });
    var hasMid = TG && TG.has ? (TG.has[0] + TG.has[1]) / 2 : theo;
    var COINS = [['ceyrek', 'CEYREK', 'Çeyrek altın', 1.754], ['yarim', 'YARIM', 'Yarım altın', 3.508], ['tam', 'TAM', 'Tam altın', 7.016], ['ata', 'ATA', 'Cumhuriyet (Ata) altını', 7.216]];
    if (TG && hasMid) COINS.forEach(function (c, i) {
      var p = TG[c[0]];
      if (!p) return;
      var tv = c[3] * 0.9166 * hasMid;
      gold.push({ metric: c[1], label: c[2], unit: 'TL', value: null, bid: p[0], ask: p[1], theo: tv, diff_bid_pct: 100 * (p[0] / tv - 1), diff_ask_pct: 100 * (p[1] / tv - 1),
        spread_pct: 100 * (p[1] - p[0]) / p[0], time: TG.time, source: 'Truncgil; teorik: has içerik (brüt × 0,9166) × HAS altın', order: 10 + i });
    });

    // teknik tablo ve senaryolar (uygulama biçimi)
    var asof = now + ' (telefon)';
    var techOut = tech.map(function (t) {
      var o = { key: t.key, name: t.name, price: t.price_engine, trend: t.trend, daily_score: t.ds, short_score: t.ss, rsi: t.rsi, adx: t.adx, atr: t.atr,
        daily_bias: t.ds >= 3 ? 'pozitif' : (t.ds <= -3 ? 'negatif' : 'karışık'), short_bias: t.ss == null ? '—' : (t.ss >= 2 ? 'pozitif' : (t.ss <= -2 ? 'negatif' : 'karışık')),
        asof: asof, dp: t.dp, order: t.order, signal: t.sig.label, signal_code: t.sig.code };
      for (var i = 0; i < 3; i++) {
        o['s' + (i + 1)] = t.sup[i] ? t.sup[i].v : null; o['s' + (i + 1) + '_note'] = t.sup[i] ? t.sup[i].labels.join(', ') : '';
        o['r' + (i + 1)] = t.res[i] ? t.res[i].v : null; o['r' + (i + 1) + '_note'] = t.res[i] ? t.res[i].labels.join(', ') : '';
      }
      return o;
    });
    var scen = tech.filter(function (t) { return t.msup.length || t.mres.length; }).map(function (t) {
      return { key: t.key, name: t.name, dp: t.dp, asof: asof, order: t.order, up_level: t.mres[0] ? t.mres[0].v : null, up_target: t.mres[1] ? t.mres[1].v : null,
        down_level: t.msup[0] ? t.msup[0].v : null, down_target: t.msup[1] ? t.msup[1].v : null };
    });

    // uyarılar, sinyal karnesi, arka plan için seviyeler
    var prevState = lsGet('gmi-durum') || {};
    var al = checkAlerts(tech, prevState.levels, gramChg, gramPx, ns);
    var lvl = {};
    // Arka plan işçisi bu varlıkların fiyatını ~15 dakikada bir kontrol eder (destek/direnç kırılımı ve sinyali bozan seviye).
    ['GOLD_FUT', 'SILVER_FUT', 'USDTRY', 'EURTRY', 'BRENT', 'XU100', 'BTC'].forEach(function (k) {
      var t = T[k]; if (!t) return;
      lvl[k] = { sym: A[k].sym, fx: FXKEYS.indexOf(k) >= 0, name: A[k].name.replace(/ \(.*\)$/, ''), dp: A[k].dp, unit: A[k].unit,
        code: t.sig ? t.sig.code : '', label: t.sig ? t.sig.label : '',
        s1: t.msup[0] ? t.msup[0].v : null, r1: t.mres[0] ? t.mres[0].v : null, s1_note: t.msup[0] ? t.msup[0].labels.join(', ') : '',
        r1_note: t.mres[0] ? t.mres[0].labels.join(', ') : '', asof: now.slice(11) };
    });
    var state = { levels: lvl, updated: now, seen: { date: al.today, keys: al.seenToday } };
    lsSet('gmi-durum', state);
    if (NATIVE && NATIVE.saveState) { try { NATIVE.saveState(JSON.stringify(state)); } catch (e) { /* yok say */ } }
    var slog = updateSignalLog(tech.filter(function (t) { return SIGNAL_KEYS.indexOf(t.key) >= 0; }), ns);

    // gündem: yeni alınamazsa öncekini koru
    var prevData = lsGet(LAST) || {};
    var prevAg = prevData.agenda || [];
    var agenda = (NEWS && NEWS.length ? NEWS : prevAg.filter(function (a) { return a.kind === 'haber'; }))
      .concat(CAL ? CAL : prevAg.filter(function (a) { return a.kind === 'takvim'; }));

    // özet
    var parts = [];
    if (SP && SP.ons) parts.push('Ons ' + tr(SP.ons.price, 0) + ' $ (spot)');
    else if (g) parts.push('Ons ' + tr(g.price, 0) + ' $ (vadeli, ' + pct(g.chg, 1) + ')');
    if (gramPx) parts.push('gram ' + tr(gramPx, 0) + ' TL');
    if (u) parts.push('USD/TRY ' + tr(u.price, 2) + ' (' + pct(u.chg, 2) + ')');
    if (T.XU100) parts.push('BIST ' + tr(T.XU100.price, 0) + ' (' + pct(T.XU100.chg, 1) + ')');
    var sig = tech.filter(function (t) { return SIGNAL_KEYS.indexOf(t.key) >= 0; });
    var nAl = sig.filter(function (t) { return t.sig.code === 'AL' || t.sig.code === 'GAL'; }).length;
    var nSat = sig.filter(function (t) { return t.sig.code === 'SAT' || t.sig.code === 'GSAT'; }).length;
    var nToday = al.list.filter(function (a) { return String(a.time).slice(0, 10) === today; }).length;
    var summary = parts.join(' · ') + ' · eğilimler: ' + nAl + ' yükseliş, ' + nSat + ' düşüş, ' + (sig.length - nAl - nSat) + ' belirsiz' + (nToday ? ' · bugün ' + nToday + ' uyarı' : '');

    var data = {
      generated_at: new Date(ns * 1000).toISOString(), source: 'telefon',
      status: [{ key: 'now', updated_trt: now, session: 'Telefonda hesaplandı', summary: summary, next_session: 'Arka plan kontrolü ≈15 dk',
        note: errs.length ? errs.length + ' veri alınamadı: ' + errs.slice(0, 3).join('; ') + (errs.length > 3 ? '…' : '') : '', report: '', tech_asof: now + ' (telefonda)' }],
      prices: prices, gold: gold, tech: techOut, scenarios: scen, alerts: al.list, agenda: agenda, perf: perfRows(slog),
      signals: sig.map(function (t) {
        return { key: t.key, name: t.name, dp: t.dp, unit: A[t.key].unit, price: t.price, chg: t.chg, code: t.sig.code, label: t.sig.label, ds: t.ds, dn: t.dn, ss: t.ss, sn: t.sn,
          rsi: t.rsi, rsiState: t.rsiState, adx: t.adx, trend: t.trend, votes: t.votes, notes: t.sig.notes, invalid: t.sig.invalid,
          s1: t.msup[0] || null, s2: t.msup[1] || null, r1: t.mres[0] || null, r2: t.mres[1] || null, stale: t.stale, synthetic: t.key === 'GRAM',
          atr: t.atr, ind: t.ind, time: t.time, spot: spotFor(t, SP) };
      }),
      spot: SP,
      errors: errs
    };
    lsSet(LAST, data);
    return data;
  }

  function spotFor(t, SP) {
    var s = SP && (t.key === 'GOLD_FUT' ? SP.ons : (t.key === 'SILVER_FUT' ? SP.gumus : null));
    if (!s || !isNum(t.price)) return null;
    return { price: s.price, time: s.time, source: s.source, diff: t.price - s.price, diffPct: 100 * (t.price / s.price - 1) };
  }

  /* ---------------- geçmiş testi: 10 yıllık günlük veriyle, haftada bir ---------------- */
  // Uygulamanın 7 oylu günlük kuralı geçmişin her gününe uygulanır. Geçmiş 4 saat/1 saat verisi olmadığı için
  // kısa vade onayı testte yoktur. Seriler saklanmaz; yalnız sayımlar saklanır (birkaç KB).
  var BT = 'gmi-gecmis-test', BT_V = 1, BT_AGE = 7 * 86400, BT_NOSTRAT = { VIX: 1, US10Y: 1 };
  function btCode(ds) { return ds == null ? null : (ds >= 5 ? 'GAL' : (ds >= 3 ? 'AL' : (ds <= -5 ? 'GSAT' : (ds <= -3 ? 'SAT' : 'NOTR')))); }
  function btCodes(b) {
    var c = b.map(function (x) { return x.c; }), s50 = ENG.smaN(c, 50), s200 = ENG.smaN(c, 200), e9 = ENG.ema(c, 9), e21 = ENG.ema(c, 21);
    var M = ENG.macd(c), R = ENG.rsi(c), X = ENG.adx(b), P = ENG.psar(b);
    return b.map(function (x, i) {
      var v = [gt(c[i], s50[i]), gt(c[i], s200[i]), gt(e9[i], e21[i]), gt(M.m[i], M.s[i]), gt(R[i], 50), P[i] ? P[i].up : null, gt(X.pdi[i], X.mdi[i])]
        .filter(function (z) { return z !== null; });
      if (v.length < 7) return null;
      var ds = 0; v.forEach(function (z) { ds += z ? 1 : -1; });
      return btCode(ds);
    });
  }
  function btStats(b, cd, H, from) {
    var g = { GAL: [], AL: [], NOTR: [], SAT: [], GSAT: [], ALL: [] }, ep = { GAL: 0, AL: 0, NOTR: 0, SAT: 0, GSAT: 0 };
    for (var i = Math.max(from, 1); i < b.length - H; i++) {
      var k = cd[i];
      if (!k) continue;
      var r = b[i + H].c / b[i].c - 1;
      g[k].push(r); g.ALL.push(r);
      if (cd[i - 1] !== k) ep[k]++;
    }
    var o = {};
    Object.keys(g).forEach(function (k) {
      var a = g[k];
      if (!a.length) return;
      var up = 0, sum = 0; a.forEach(function (r) { if (r > 0) up++; sum += r; });
      o[k] = { n: a.length, ep: k === 'ALL' ? null : ep[k], up: Math.round(1000 * up / a.length) / 10, ort: Math.round(10000 * sum / a.length) / 100 };
    });
    return o;
  }
  // Yükseliş eğiliminde al, düşüş eğiliminde sat, belirsizde bekle. Maliyet sonradan (btNet) uygulanır.
  function btStrat(b, cd, from) {
    var pos = 0, gross = 1, ch = 0, inv = 0, n = 0;
    for (var i = from; i < b.length - 1; i++) {
      var k = cd[i], np = pos;
      if (k === 'AL' || k === 'GAL') np = 1; else if (k === 'SAT' || k === 'GSAT') np = 0;
      if (np !== pos) { ch++; pos = np; }
      if (pos) { gross *= b[i + 1].c / b[i].c; inv++; }
      n++;
    }
    return { g: gross, ch: ch, son: pos, gun: n ? Math.round(100 * inv / n) : null, bh: b[b.length - 1].c / b[from].c, bas: trt(b[from].t).slice(0, 10) };
  }
  // c: her alışta ve her satışta ödenen maliyet (oran). Açık pozisyon dönem sonunda satılmış sayılır.
  function btNet(st, c) {
    if (!st) return null;
    return { sinyal: 100 * (st.g * Math.pow(1 - c, st.ch + (st.son ? 1 : 0)) - 1), alTut: 100 * (st.bh * (1 - c) * (1 - c) - 1), islem: st.ch + (st.son ? 1 : 0) };
  }
  async function btBars(sym, cache) {
    if (cache[sym] !== undefined) return cache[sym];
    var r = await chart(sym, '10y', '1d');
    cache[sym] = r && r.bars && r.bars.length > 400 ? r : null;
    await sleep(350);
    return cache[sym];
  }
  async function btAsset(key, cache) {
    var b = null;
    if (key === 'GRAM') {
      var g = await btBars(A.GOLD_FUT.sym, cache), u = await btBars(A.USDTRY.sym, cache);
      b = g && u ? gramSeries(g, u, 'd') : null;
    } else if (A[key]) {
      var d = await btBars(A[key].sym, cache);
      b = d && d.bars;
    }
    if (!b || b.length < 400) return null;
    var cd = btCodes(b), from = -1;
    for (var i = 0; i < cd.length; i++) { if (cd[i]) { from = i; break; } }
    if (from < 0 || b.length - from < 250) return null;
    var cut = b[b.length - 1].t - 730 * 86400, i2 = from;
    while (i2 < b.length - 1 && b[i2].t < cut) i2++;
    var o = { bas: trt(b[from].t).slice(0, 10), son: trt(b[b.length - 1].t).slice(0, 10), gun: b.length - from,
      h5: btStats(b, cd, 5, from), h20: btStats(b, cd, 20, from), h5_2y: btStats(b, cd, 5, i2), bugun: cd[cd.length - 1] };
    if (!BT_NOSTRAT[key]) { o.st = btStrat(b, cd, from); o.st2y = btStrat(b, cd, i2); }
    return o;
  }
  var btBusy = null;
  function backtestData() { var d = lsGet(BT); return d && d.v === BT_V ? d : null; }
  function backtest(force, onProgress) {
    var cur = backtestData();
    if (!force && cur && nowSec() - cur.asof < BT_AGE) return Promise.resolve(cur);
    if (btBusy) return btBusy;
    btBusy = (async function () {
      var cache = {}, res = {}, miss = [];
      for (var i = 0; i < SIGNAL_KEYS.length; i++) {
        var k = SIGNAL_KEYS[i];
        try { var r = await btAsset(k, cache); if (r) res[k] = r; else miss.push(A[k] ? A[k].name : k); } catch (e) { miss.push(A[k] ? A[k].name : k); }
        if (onProgress) onProgress(i + 1, SIGNAL_KEYS.length);
      }
      var out = { v: BT_V, asof: nowSec(), asof_trt: trt(nowSec()), assets: res, missing: miss };
      if (Object.keys(res).length) lsSet(BT, out);
      return Object.keys(res).length ? out : (cur || out);
    })();
    return btBusy.then(function (x) { btBusy = null; return x; }, function (e) { btBusy = null; throw e; });
  }

  function cached() { return lsGet(LAST); }
  function signalStats() {
    var log = lsGet(SL) || [], by = {};
    log.forEach(function (e) {
      if (!e.r || e.r === 'süresi geçti' || e.r === 'yönsüz') return;
      var b = by[e.c] || (by[e.c] = { isabet: 0, 'ıska': 0, yatay: 0 });
      b[e.r] = (b[e.r] || 0) + 1;
    });
    return { by: by, pending: log.filter(function (e) { return !e.r; }).length, total: log.length };
  }
  // Grafik verisi: bellekte yoksa önbellekten
  function seriesFor(key) {
    var s = MEM.series[key];
    if (s) return { d: s.d && s.d.bars, h: s.h && s.h.bars };
    if (key === 'GRAM') {
      var gd = cachedSeries('GC=F', 'd'), ud = cachedSeries('TRY=X', 'd'), gh = cachedSeries('GC=F', 'h'), uh = cachedSeries('TRY=X', 'h');
      return { d: gramSeries(gd, ud, 'd'), h: gramSeries(gh, uh, 'h') };
    }
    var a = A[key]; if (!a) return null;
    var d = cachedSeries(a.sym, 'd'), h = a.intra ? cachedSeries(a.sym, 'h') : null;
    return { d: d && d.bars, h: h && h.bars };
  }
  function techFor(key) { return MEM.tech[key] || null; }

  window.GMIA = { native: !!NATIVE, run: run, cached: cached, seriesFor: seriesFor, techFor: techFor, signalStats: signalStats, assets: A, SIG_LABEL: SIG_LABEL, SIG_SHORT: SIG_SHORT,
    backtest: backtest, backtestData: backtestData, btCode: btCode, btNet: btNet };
})();
