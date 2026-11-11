/* GMI Teknik Analiz Motoru v1.0 — GLOBAL_MARKET_INTELLIGENCE
 * Çalıştığı yer: yerleşik tarayıcıda https://query1.finance.yahoo.com/... sayfası (aynı köken fetch) veya Node (test).
 * Göstergeler: SMA20/50/100/200, EMA9/21/50, MACD(12,26,9), ADX/+DI/-DI(14), Parabolic SAR(0.02/0.2),
 * RSI(14, Wilder), StochRSI(14,14,3,3), Stokastik(14,3,3), CCI(20), ROC(12), Bollinger(20,2; popülasyon std),
 * ATR(14, Wilder), Keltner(EMA20 ± 2×ATR10), OBV, seans VWAP (5 dk), Volume Profile (60 gün; POC/VAH/VAL),
 * klasik pivot (günlük/haftalık), Fibonacci düzeltme+uzatma (60 günlük salınım), fraktal tepe/dipler (120 gün).
 * Zaman dilimleri: 5dk (ham), 15dk (5dk'dan), 1s (ham), 4s (1s'ten), Günlük (ham), Haftalık (günlükten).
 * Çıktı: CSV metni (D=günlük, W=haftalık, H4/H1/M15/M5=gün içi satırları). Saatler Europe/Istanbul (UTC+3).
 */
const GMI = (() => {
  const isNum = x => typeof x === 'number' && isFinite(x);
  const mean = a => a.reduce((s, y) => s + y, 0) / a.length;

  function smaN(a, n) {
    const out = new Array(a.length).fill(null);
    for (let i = n - 1; i < a.length; i++) {
      let s = 0, ok = true;
      for (let j = i - n + 1; j <= i; j++) { if (!isNum(a[j])) { ok = false; break; } s += a[j]; }
      if (ok) out[i] = s / n;
    }
    return out;
  }
  function seeded(a, n, upd) { // ilk n geçerli değerin SMA'sı ile tohumlanan özyinelemeli ortalama
    const out = new Array(a.length).fill(null); let prev = null; const buf = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i]; if (!isNum(x)) continue;
      if (prev === null) { buf.push(x); if (buf.length === n) { prev = mean(buf); out[i] = prev; } }
      else { prev = upd(prev, x); out[i] = prev; }
    }
    return out;
  }
  const ema = (a, n) => { const k = 2 / (n + 1); return seeded(a, n, (p, x) => x * k + p * (1 - k)); };
  const rma = (a, n) => seeded(a, n, (p, x) => (p * (n - 1) + x) / n); // Wilder
  function rsi(c, n = 14) {
    const g = [null], l = [null];
    for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g.push(d > 0 ? d : 0); l.push(d < 0 ? -d : 0); }
    const ag = rma(g, n), al = rma(l, n);
    return c.map((_, i) => !isNum(ag[i]) ? null : (al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i])));
  }
  function macd(c, f = 12, s = 26, g = 9) {
    const ef = ema(c, f), es = ema(c, s);
    const m = c.map((_, i) => isNum(ef[i]) && isNum(es[i]) ? ef[i] - es[i] : null);
    const sg = ema(m, g);
    return { m, s: sg, h: m.map((x, i) => isNum(x) && isNum(sg[i]) ? x - sg[i] : null) };
  }
  const trueRange = b => b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)));
  const atr = (b, n = 14) => rma(trueRange(b), n);
  function adx(b, n = 14) {
    const tr = trueRange(b); tr[0] = null; const pdm = [null], mdm = [null];
    for (let i = 1; i < b.length; i++) {
      const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l;
      pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
    }
    const at = rma(tr, n), pd = rma(pdm, n), md = rma(mdm, n);
    const pdi = b.map((_, i) => isNum(at[i]) && at[i] > 0 ? 100 * pd[i] / at[i] : null);
    const mdi = b.map((_, i) => isNum(at[i]) && at[i] > 0 ? 100 * md[i] / at[i] : null);
    const dx = b.map((_, i) => isNum(pdi[i]) && isNum(mdi[i]) && pdi[i] + mdi[i] > 0 ? 100 * Math.abs(pdi[i] - mdi[i]) / (pdi[i] + mdi[i]) : null);
    return { adx: rma(dx, n), pdi, mdi };
  }
  function psar(b, step = 0.02, maxAf = 0.2) {
    const out = new Array(b.length).fill(null); if (b.length < 3) return out;
    let up = b[1].c >= b[0].c, sar = up ? b[0].l : b[0].h, ep = up ? b[1].h : b[1].l, af = step;
    for (let i = 2; i < b.length; i++) {
      sar = sar + af * (ep - sar);
      if (up) {
        sar = Math.min(sar, b[i - 1].l, b[i - 2].l);
        if (b[i].l < sar) { up = false; sar = ep; ep = b[i].l; af = step; }
        else if (b[i].h > ep) { ep = b[i].h; af = Math.min(af + step, maxAf); }
      } else {
        sar = Math.max(sar, b[i - 1].h, b[i - 2].h);
        if (b[i].h > sar) { up = true; sar = ep; ep = b[i].h; af = step; }
        else if (b[i].l < ep) { ep = b[i].l; af = Math.min(af + step, maxAf); }
      }
      out[i] = { sar, up };
    }
    return out;
  }
  function hhll(b, i, n) { let hh = -Infinity, ll = Infinity; for (let j = i - n + 1; j <= i; j++) { if (b[j].h > hh) hh = b[j].h; if (b[j].l < ll) ll = b[j].l; } return [hh, ll]; }
  function stoch(b, n = 14, k = 3, d = 3) {
    const raw = b.map((x, i) => { if (i < n - 1) return null; const [hh, ll] = hhll(b, i, n); return hh === ll ? 50 : 100 * (x.c - ll) / (hh - ll); });
    const K = smaN(raw, k); return { K, D: smaN(K, d) };
  }
  function stochrsi(c, n = 14, k = 3, d = 3) {
    const r = rsi(c, n);
    const raw = r.map((x, i) => {
      if (!isNum(x) || i < n - 1) return null; let mx = -Infinity, mn = Infinity;
      for (let j = i - n + 1; j <= i; j++) { if (!isNum(r[j])) return null; if (r[j] > mx) mx = r[j]; if (r[j] < mn) mn = r[j]; }
      return mx === mn ? 50 : 100 * (x - mn) / (mx - mn);
    });
    const K = smaN(raw, k); return { K, D: smaN(K, d) };
  }
  function cci(b, n = 20) {
    const tp = b.map(x => (x.h + x.l + x.c) / 3);
    return tp.map((x, i) => {
      if (i < n - 1) return null; let m = 0; for (let j = i - n + 1; j <= i; j++) m += tp[j]; m /= n;
      let md = 0; for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m); md /= n;
      return md === 0 ? 0 : (x - m) / (0.015 * md);
    });
  }
  function boll(c, n = 20, k = 2) {
    if (c.length < n) return null; const w = c.slice(-n), mu = mean(w), sd = Math.sqrt(mean(w.map(y => (y - mu) ** 2))), x = c[c.length - 1];
    return { u: mu + k * sd, m: mu, l: mu - k * sd, pctb: sd > 0 ? (x - (mu - k * sd)) / (2 * k * sd) : 0.5, width: mu ? 100 * 2 * k * sd / mu : null };
  }
  function obv(b) {
    let o = 0; const a = [0];
    for (let i = 1; i < b.length; i++) { o += b[i].c > b[i - 1].c ? b[i].v : (b[i].c < b[i - 1].c ? -b[i].v : 0); a.push(o); }
    const s = smaN(a, 20), n = a.length - 1; return { up: a[n] > s[n], slope20: n >= 20 ? a[n] - a[n - 20] : null };
  }
  function volProfile(b, bins = 24) {
    let lo = Infinity, hi = -Infinity, tot = 0; b.forEach(x => { if (x.l < lo) lo = x.l; if (x.h > hi) hi = x.h; });
    if (!(hi > lo)) return null; const w = (hi - lo) / bins, vol = new Array(bins).fill(0);
    b.forEach(x => {
      if (!(x.v > 0)) return; const a = Math.max(0, Math.min(bins - 1, Math.floor((x.l - lo) / w))), z = Math.max(0, Math.min(bins - 1, Math.floor((x.h - lo) / w)));
      const per = x.v / (z - a + 1); for (let k = a; k <= z; k++) vol[k] += per; tot += x.v;
    });
    if (tot === 0) return null; let poc = 0; vol.forEach((v, k) => { if (v > vol[poc]) poc = k; });
    let a = poc, z = poc, acc = vol[poc];
    while (acc < 0.7 * tot && (a > 0 || z < bins - 1)) { const va = a > 0 ? vol[a - 1] : -1, vz = z < bins - 1 ? vol[z + 1] : -1; if (vz >= va) { z++; acc += vol[z]; } else { a--; acc += vol[a]; } }
    return { poc: lo + (poc + 0.5) * w, vah: lo + (z + 1) * w, val: lo + a * w };
  }
  function pivots(h, l, c) { const p = (h + l + c) / 3; return { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + (h - l), s2: p - (h - l), r3: h + 2 * (p - l), s3: l - 2 * (h - p) }; }
  function fib(b, look = 60) {
    const s = b.slice(-look); let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
    s.forEach((x, i) => { if (x.h > hi) { hi = x.h; hiI = i; } if (x.l < lo) { lo = x.l; loI = i; } });
    const up = hiI > loI, r = hi - lo, L = {};
    [0.236, 0.382, 0.5, 0.618, 0.786].forEach(k => { L['f' + Math.round(k * 1000)] = up ? hi - r * k : lo + r * k; });
    [1.272, 1.618].forEach(k => { L['x' + Math.round(k * 1000)] = up ? lo + r * k : hi - r * k; });
    return Object.assign({ dir: up ? 'up' : 'down', hi, lo, hiT: s[hiI].t, loT: s[loI].t }, L);
  }
  function levels(b, price, look = 120, w = 3) {
    const s = b.slice(-look), cand = [];
    for (let i = w; i < s.length - w; i++) {
      let isH = true, isL = true;
      for (let j = i - w; j <= i + w; j++) { if (j === i) continue; if (s[j].h >= s[i].h) isH = false; if (s[j].l <= s[i].l) isL = false; }
      if (isH) cand.push(s[i].h); if (isL) cand.push(s[i].l);
    }
    const pick = arr => { const out = []; for (const v of arr) { if (out.every(o => Math.abs(o - v) / price > 0.0025)) out.push(v); if (out.length === 3) break; } return out; };
    return { res: pick(cand.filter(v => v > price).sort((a, z) => a - z)), sup: pick(cand.filter(v => v < price).sort((a, z) => z - a)) };
  }
  const dstr = (t, off) => new Date((t + (off || 0)) * 1000).toISOString().slice(0, 10);
  const trt = t => new Date((t + 10800) * 1000).toISOString().slice(0, 16).replace('T', ' ');
  function agg(b, keyFn) {
    const out = []; let cur = null, key = null;
    b.forEach(x => {
      const k = keyFn(x);
      if (k !== key) { if (cur) out.push(cur); key = k; cur = { t: x.t, k, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0 }; }
      else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v || 0; }
    });
    if (cur) out.push(cur); return out;
  }
  const toWeekly = (b, off) => agg(b, x => { const d = new Date((x.t + (off || 0)) * 1000), dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10); });
  const resample = (b, sec) => agg(b, x => Math.floor(x.t / sec) * sec);
  function vwapSession(b, off) {
    const d = dstr(b[b.length - 1].t, off); let pv = 0, vv = 0;
    for (let i = b.length - 1; i >= 0 && dstr(b[i].t, off) === d; i--) { pv += (b[i].h + b[i].l + b[i].c) / 3 * b[i].v; vv += b[i].v; }
    return vv > 0 ? pv / vv : null;
  }
  // ---- biçimlendirme
  const P = x => isNum(x) ? String(+x.toPrecision(6)) : '';
  const F1 = x => isNum(x) ? x.toFixed(1) : '';
  const F2 = x => isNum(x) ? x.toFixed(2) : '';
  const P4 = x => isNum(x) ? String(+x.toPrecision(4)) : '';
  const LN = (n, k = 0) => n[n.length - 1 - k];

  const HEAD = {
    D: 'tf,key,sym,time_trt,age_min,mkt_open,partial,price,prev_close,chg_pct,day_h,day_l,h52,l52,sma20,sma50,sma100,sma200,ema9,ema21,ema50,macd,macd_sig,macd_hist,macd_hist_prev,adx,pdi,mdi,psar,psar_up,rsi,rsi_prev,srsi_k,srsi_d,st_k,st_d,cci,roc12,bb_u,bb_m,bb_l,bb_pctb,bb_width,atr14,kc_u,kc_l,obv_up,obv_slope20,vol_ratio,vol_ratio_prev,vp_poc,vp_vah,vp_val,rv20,piv_date,piv_p,piv_r1,piv_r2,piv_r3,piv_s1,piv_s2,piv_s3,fib_dir,fib_hi,fib_hi_date,fib_lo,fib_lo_date,fib_236,fib_382,fib_500,fib_618,fib_786,fib_1272,fib_1618,res1,res2,res3,sup1,sup2,sup3,closes5',
    W: 'tf,key,week_of,c,chg_wtd_pct,sma20,sma50,ema21,rsi,macd_hist,macd_hist_prev,adx,pdi,mdi,st_k,wpiv_p,wpiv_r1,wpiv_r2,wpiv_s1,wpiv_s2',
    I: 'tf,key,time_trt,c,rsi,rsi_prev,macd,macd_sig,macd_hist,macd_hist_prev,ema9,ema21,ema50,sma200,adx,pdi,mdi,st_k,st_d,bb_u,bb_l,atr14,vwap'
  };

  function dailyRow(key, sym, meta, b, nowSec) {
    const off = meta.gmtoffset || 0, n = b.length;
    const partial = dstr(b[n - 1].t, off) === dstr(nowSec, off);
    if (partial && isNum(meta.regularMarketPrice)) { const x = b[n - 1]; x.c = meta.regularMarketPrice; x.h = Math.max(x.h, x.c); x.l = Math.min(x.l, x.c); }
    const c = b.map(x => x.c), price = c[n - 1], prevC = c[n - 2], pb = partial ? b[n - 2] : b[n - 1];
    const tp = meta.currentTradingPeriod && meta.currentTradingPeriod.regular;
    const open = tp ? (nowSec >= tp.start && nowSec <= tp.end) : '';
    const age = isNum(meta.regularMarketTime) ? Math.round((nowSec - meta.regularMarketTime) / 60) : '';
    const M = macd(c), A = adx(b), S = psar(b), R = rsi(c), SR = stochrsi(c), ST = stoch(b), CC = cci(b), BB = boll(c) || {};
    const AT = atr(b, 14), A10 = atr(b, 10), E20 = ema(c, 20);
    const hasVol = b.slice(-20).filter(x => x.v > 0).length >= 15;
    const OB = hasVol ? obv(b) : null;
    let vr = null, vrp = null;
    if (hasVol && n > 22) { const a1 = mean(b.slice(n - 21, n - 1).map(x => x.v)), a2 = mean(b.slice(n - 22, n - 2).map(x => x.v)); vr = a1 > 0 ? b[n - 1].v / a1 : null; vrp = a2 > 0 ? b[n - 2].v / a2 : null; }
    const VP = hasVol ? volProfile(b.slice(-60)) : null;
    const lr = []; for (let i = n - 20; i < n; i++) lr.push(Math.log(c[i] / c[i - 1]));
    const mu = mean(lr), rv = Math.sqrt(lr.reduce((s, y) => s + (y - mu) ** 2, 0) / (lr.length - 1)) * Math.sqrt(252) * 100;
    const PV = pivots(pb.h, pb.l, pb.c), FB = fib(b), LV = levels(b, price), y1 = b.slice(-252);
    const sm = k => LN(k === 'e9' ? ema(c, 9) : k === 'e21' ? ema(c, 21) : k === 'e50' ? ema(c, 50) : smaN(c, +k));
    const sp = LN(S) || {};
    const row = ['D', key, sym, trt(meta.regularMarketTime || b[n - 1].t), age, open, partial, P(price), P(prevC), F2(100 * (price / prevC - 1)), P(b[n - 1].h), P(b[n - 1].l),
      P(Math.max(...y1.map(x => x.h))), P(Math.min(...y1.map(x => x.l))), P(sm(20)), P(sm(50)), P(sm(100)), P(sm(200)), P(sm('e9')), P(sm('e21')), P(sm('e50')),
      P4(LN(M.m)), P4(LN(M.s)), P4(LN(M.h)), P4(LN(M.h, 1)), F1(LN(A.adx)), F1(LN(A.pdi)), F1(LN(A.mdi)), P(sp.sar), sp.up === undefined ? '' : sp.up,
      F1(LN(R)), F1(LN(R, 1)), F1(LN(SR.K)), F1(LN(SR.D)), F1(LN(ST.K)), F1(LN(ST.D)), F1(LN(CC)), F2(n > 12 ? 100 * (c[n - 1] / c[n - 13] - 1) : null),
      P(BB.u), P(BB.m), P(BB.l), F2(BB.pctb), F2(BB.width), P(LN(AT)), P(LN(E20) + 2 * LN(A10)), P(LN(E20) - 2 * LN(A10)),
      OB ? OB.up : '', OB ? P4(OB.slope20) : '', F2(vr), F2(vrp), VP ? P(VP.poc) : '', VP ? P(VP.vah) : '', VP ? P(VP.val) : '', F1(rv),
      dstr(pb.t, off), P(PV.p), P(PV.r1), P(PV.r2), P(PV.r3), P(PV.s1), P(PV.s2), P(PV.s3),
      FB.dir, P(FB.hi), dstr(FB.hiT, off), P(FB.lo), dstr(FB.loT, off), P(FB.f236), P(FB.f382), P(FB.f500), P(FB.f618), P(FB.f786), P(FB.x1272), P(FB.x1618),
      P(LV.res[0]), P(LV.res[1]), P(LV.res[2]), P(LV.sup[0]), P(LV.sup[1]), P(LV.sup[2]), c.slice(-5).map(P).join('|')];
    return row.join(',');
  }
  function weeklyRow(key, b, off) {
    const w = toWeekly(b, off), n = w.length, c = w.map(x => x.c), M = macd(c), A = adx(w), R = rsi(c), ST = stoch(w), pw = w[n - 2], PV = pivots(pw.h, pw.l, pw.c);
    return ['W', key, w[n - 1].k, P(c[n - 1]), F2(100 * (c[n - 1] / c[n - 2] - 1)), P(LN(smaN(c, 20))), P(LN(smaN(c, 50))), P(LN(ema(c, 21))), F1(LN(R)),
      P4(LN(M.h)), P4(LN(M.h, 1)), F1(LN(A.adx)), F1(LN(A.pdi)), F1(LN(A.mdi)), F1(LN(ST.K)), P(PV.p), P(PV.r1), P(PV.r2), P(PV.s1), P(PV.s2)].join(',');
  }
  function tfRow(tf, key, b, off, withVwap) {
    const n = b.length, c = b.map(x => x.c), M = macd(c), R = rsi(c), A = adx(b), ST = stoch(b), BB = boll(c) || {};
    return [tf, key, trt(b[n - 1].t), P(c[n - 1]), F1(LN(R)), F1(LN(R, 1)), P4(LN(M.m)), P4(LN(M.s)), P4(LN(M.h)), P4(LN(M.h, 1)),
      P(LN(ema(c, 9))), P(LN(ema(c, 21))), P(LN(ema(c, 50))), P(LN(smaN(c, 200))), F1(LN(A.adx)), F1(LN(A.pdi)), F1(LN(A.mdi)),
      F1(LN(ST.K)), F1(LN(ST.D)), P(BB.u), P(BB.l), P(LN(atr(b, 14))), withVwap ? P(vwapSession(b, off)) : ''].join(',');
  }

  const LIST = [
    ['GOLD_FUT', 'GC=F', 1], ['XAU_SPOT', 'XAUUSD=X', 0], ['SILVER_FUT', 'SI=F', 1], ['PLAT_FUT', 'PL=F', 0], ['PALL_FUT', 'PA=F', 0],
    ['USDTRY', 'TRY=X', 1], ['EURTRY', 'EURTRY=X', 1], ['EURUSD', 'EURUSD=X', 1], ['GBPTRY', 'GBPTRY=X', 0], ['USDJPY', 'JPY=X', 0], ['DXY', 'DX-Y.NYB', 1],
    ['BRENT', 'BZ=F', 1], ['WTI', 'CL=F', 0], ['NATGAS', 'NG=F', 0], ['TTF_GAS', 'TTF=F', 0], ['COPPER', 'HG=F', 0],
    ['XU100', 'XU100.IS', 1], ['SPX', '^GSPC', 0], ['ES_FUT', 'ES=F', 1], ['NDX', '^NDX', 0], ['DJI', '^DJI', 0], ['DAX', '^GDAXI', 1],
    ['NIKKEI', '^N225', 0], ['HSI', '^HSI', 0], ['SSE', '000001.SS', 0], ['US10Y', '^TNX', 0], ['US2Y', '2YY=F', 0], ['VIX', '^VIX', 0], ['BTC', 'BTC-USD', 1]
  ];

  async function fetchChart(sym, range, interval) {
    const url = '/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + range + '&interval=' + interval + '&includePrePost=false';
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(url);
        if (r.status === 429) { await new Promise(z => setTimeout(z, 1500 * (a + 1))); continue; }
        const j = await r.json(), res = j && j.chart && j.chart.result && j.chart.result[0];
        if (!res) return { err: (j && j.chart && j.chart.error && j.chart.error.description) || ('HTTP ' + r.status) };
        const ts = res.timestamp || [], q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {}, bars = [];
        for (let k = 0; k < ts.length; k++) {
          const o = q.open && q.open[k], h = q.high && q.high[k], l = q.low && q.low[k], c = q.close && q.close[k];
          if ([o, h, l, c].every(isNum)) bars.push({ t: ts[k], o, h, l, c, v: (q.volume && q.volume[k]) || 0 });
        }
        return { meta: res.meta, bars };
      } catch (e) { if (a === 2) return { err: String(e) }; await new Promise(z => setTimeout(z, 800)); }
    }
    return { err: 'HTTP 429' };
  }

  async function collect(list = LIST, conc = 4) {
    const nowSec = Math.floor(Date.now() / 1000), out = { run_trt: trt(nowSec), D: [], W: [], I: [], err: [] }; let idx = 0;
    async function work() {
      while (idx < list.length) {
        const [key, sym, intra] = list[idx++];
        try {
          const d = await fetchChart(sym, '2y', '1d');
          if (d.err || d.bars.length < 60) { out.err.push(key + ':' + (d.err || ('az veri ' + d.bars.length))); continue; }
          const off = d.meta.gmtoffset || 0;
          out.D.push(dailyRow(key, sym, d.meta, d.bars, nowSec));
          out.W.push(weeklyRow(key, d.bars, off));
          if (intra) {
            const [h1, m5] = await Promise.all([fetchChart(sym, '3mo', '60m'), fetchChart(sym, '5d', '5m')]);
            if (!h1.err && h1.bars.length > 60) { out.I.push(tfRow('H4', key, resample(h1.bars, 14400), off, false)); out.I.push(tfRow('H1', key, h1.bars, off, false)); }
            else out.err.push(key + ':H1 ' + (h1.err || 'az veri'));
            if (!m5.err && m5.bars.length > 60) {
              const vw = m5.bars.slice(-30).some(x => x.v > 0);
              out.I.push(tfRow('M15', key, resample(m5.bars, 900), off, vw)); out.I.push(tfRow('M5', key, m5.bars, off, vw));
            } else out.err.push(key + ':M5 ' + (m5.err || 'az veri'));
          }
        } catch (e) { out.err.push(key + ':' + String(e)); }
      }
    }
    await Promise.all(Array.from({ length: conc }, work));
    const ord = k => list.findIndex(x => x[0] === k.split(',')[1]);
    ['D', 'W', 'I'].forEach(t => out[t].sort((a, b) => ord(a) - ord(b) || a.localeCompare(b)));
    out.csv = ['# run_trt=' + out.run_trt, HEAD.D, ...out.D, HEAD.W, ...out.W, HEAD.I, ...out.I, '# errors=' + out.err.join(' ; ')].join('\n');
    return out;
  }
  return { smaN, ema, rma, rsi, macd, atr, adx, psar, stoch, stochrsi, cci, boll, obv, volProfile, pivots, fib, levels, toWeekly, resample, vwapSession, dailyRow, weeklyRow, tfRow, fetchChart, collect, LIST, HEAD };
})();
if (typeof module !== 'undefined') module.exports = GMI;
