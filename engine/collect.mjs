// GMI — veri toplama. GitHub Actions'ta çalışır; Claude gerekmez.
// Kullanım: node engine/collect.mjs <kontrol|seans> <çıktı klasörü>
//   kontrol : güncel fiyatlar (Yahoo), NY kapanışına göre düzeltilmiş döviz, yerel altın
//   seans   : yukarıdakiler + teknik motor (ta_engine.js), haber başlıkları, ekonomik takvim
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MODE = process.argv[2] || 'kontrol';
const OUT = process.argv[3] || 'work';
mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
let yahooHost = HOSTS[0];
const nodeFetch = globalThis.fetch;
// ta_engine.js tarayıcı için yazıldı (göreli adres). Node'da adresi tamamlayan ve zaman aşımı ekleyen sarmalayıcı:
globalThis.fetch = (u, o = {}) => {
  const url = typeof u === 'string' && u.startsWith('/') ? yahooHost + u : u;
  const headers = Object.assign({ 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' }, o.headers || {});
  return nodeFetch(url, Object.assign({}, o, { headers, signal: o.signal || AbortSignal.timeout(20000) }));
};
const GMI = require('./ta_engine.js');

const isNum = (x) => typeof x === 'number' && isFinite(x);
const r6 = (x) => (isNum(x) ? +x.toPrecision(7) : null);
const trt = (t) => new Date((t + 10800) * 1000).toISOString().slice(0, 16).replace('T', ' ');
const nowSec = () => Math.floor(Date.now() / 1000);
const errors = [];
const log = (...a) => console.log(...a);

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}

// ---------- 1) Güncel fiyatlar (günlük barlar + meta)
async function quick() {
  const res = {};
  const run = async (list) => {
    const failed = [];
    await pool(list, 4, async ([key, sym]) => {
      const d = await GMI.fetchChart(sym, '5d', '1d');
      if (d.err || !d.bars.length) { failed.push([key, sym, d.err || 'veri yok']); return; }
      const m = d.meta, b = d.bars, n = b.length;
      const price = isNum(m.regularMarketPrice) ? m.regularMarketPrice : b[n - 1].c;
      const t = m.regularMarketTime || b[n - 1].t;
      const prev = n >= 2 ? b[n - 2].c : null;
      res[key] = { sym, price: r6(price), prev: r6(prev), chg: prev ? +(100 * (price / prev - 1)).toFixed(2) : null, epoch: t, time: trt(t) };
    });
    return failed;
  };
  let failed = await run(GMI.LIST);
  if (failed.length > GMI.LIST.length / 2) { // query1 engellendiyse query2'yi dene
    yahooHost = HOSTS[1];
    failed = await run(failed.map(([k, s]) => [k, s]));
  }
  failed.forEach(([k, , e]) => errors.push(`fiyat ${k}: ${e}`));
  return res;
}

// ---------- 2) Döviz: Yahoo günlük döviz mumları bir gün kayık; NY kapanışı (17:00 New York) seanslarına göre yeniden hesapla
function nthSunday(y, month0, n) {
  const first = Date.UTC(y, month0, 1) / 1000;
  const dow = new Date(first * 1000).getUTCDay();
  return first + ((7 - dow) % 7) * 86400 + (n - 1) * 7 * 86400;
}
function usDST(t) {
  const y = new Date(t * 1000).getUTCFullYear();
  return t >= nthSunday(y, 2, 2) + 7 * 3600 && t < nthSunday(y, 10, 1) + 6 * 3600;
}
const nyKey = (t) => new Date((t + (usDST(t) ? 3 : 2) * 3600) * 1000).toISOString().slice(0, 10);
const FX = [['EURUSD', 'EURUSD=X'], ['EURTRY', 'EURTRY=X'], ['GBPTRY', 'GBPTRY=X'], ['USDJPY', 'JPY=X'], ['USDTRY', 'TRY=X']];
async function fxfix() {
  const out = {};
  await pool(FX, 3, async ([key, sym]) => {
    const d = await GMI.fetchChart(sym, '5d', '60m');
    if (d.err || d.bars.length < 10) { errors.push(`döviz ${key}: ${d.err || 'az veri'}`); return; }
    const groups = new Map();
    for (const b of d.bars) { const k = nyKey(b.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
    const keys = [...groups.keys()];
    if (keys.length < 2) { errors.push(`döviz ${key}: tek seans`); return; }
    const pk = keys[keys.length - 2], pb = groups.get(pk);
    const H = Math.max(...pb.map((x) => x.h)), L = Math.min(...pb.map((x) => x.l)), C = pb[pb.length - 1].c;
    const m = d.meta, live = isNum(m.regularMarketPrice) ? m.regularMarketPrice : d.bars[d.bars.length - 1].c;
    const P = GMI.pivots(H, L, C);
    out[key] = { live: r6(live), prev_c: r6(C), chg: +(100 * (live / C - 1)).toFixed(2), piv: [P.p, P.r1, P.r2, P.r3, P.s1, P.s2, P.s3].map(r6), piv_date: pk, time: trt(m.regularMarketTime || d.bars[d.bars.length - 1].t) };
  });
  return out;
}

// ---------- 3) Yerel altın (TL)
async function getText(url, opt = {}) {
  const r = await fetch(url, opt);
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return txt;
}
const trNum = (s) => {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return isFinite(s) ? s : null;
  let t = String(s).trim().replace(/\s|%|₺|TL|\$/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(t);
  return isFinite(v) ? v : null;
};
const LOCAL = {
  // Harem Altın: sitenin kendi veri isteği (yerleşik tarayıcıda okunan sayfayla aynı kaynak)
  async harem() {
    const txt = await getText('https://www.haremaltin.com/dashboard/ajax/doviz', {
      method: 'POST', body: 'dil_kodu=tr',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.haremaltin.com/' },
    });
    const j = JSON.parse(txt), d = j.data || {};
    const pair = (code) => (d[code] ? [trNum(d[code].alis), trNum(d[code].satis)] : null);
    const _keys = Object.keys(d).slice(0, 60);
    const tm = (j.meta && j.meta.tarih) || (d.ALTIN && d.ALTIN.tarih) || '';
    const time = (tm.match(/(\d{2}:\d{2})/) || [])[1] || trt(nowSec()).slice(11);
    return {
      source: 'Harem Altın', time,
      has_altin: pair('ALTIN'), gram_altin: pair('KULCEALTIN'), ons_usd: pair('ONS'), altin_22_ayar: pair('AYAR22'),
      yeni_ceyrek: pair('CEYREK_YENI'), eski_ceyrek: pair('CEYREK_ESKI'), yeni_yarim: pair('YARIM_YENI'), yeni_tam: pair('TEK_YENI'), yeni_ata: pair('ATA_YENI'),
      gumus_tl_gram: pair('GUMUSTRY'), gumus_ons: pair('XAGUSD'), usdtry: pair('USDTRY'), _keys,
    };
  },
  // Truncgil Finans (ücretsiz JSON)
  async truncgil() {
    const j = JSON.parse(await getText('https://finans.truncgil.com/v4/today.json'));
    const find = (re) => { for (const [k, v] of Object.entries(j)) { if (v && typeof v === 'object' && (re.test(k) || re.test(v.Name || ''))) return v; } return null; };
    const pair = (re) => { const v = find(re); return v ? [trNum(v.Buying), trNum(v.Selling)] : null; };
    const up = String(j.Update_Date || '');
    const _keys = Object.keys(j).slice(0, 60);
    return { _keys,
      source: 'Truncgil Finans', time: (up.match(/(\d{2}:\d{2})/) || [])[1] || '',
      gram_altin: pair(/^GRA$|^gram altın$/i), has_altin: pair(/^HAS$|has altın/i), ons_usd: pair(/^ONS$/i),
      yeni_ceyrek: pair(/^CEY$|çeyrek/i), yeni_yarim: pair(/^YAR$|yarım/i), yeni_tam: pair(/^TAM$|tam altın/i), yeni_ata: pair(/^ATA$|^CUM$|cumhuriyet|ata altın/i),
      gumus_tl_gram: pair(/^GUM$|gümüş/i), usdtry: pair(/^USD$/i),
    };
  },
  // GenelPara (ücretsiz gömülü veri)
  async genelpara() {
    const j = JSON.parse(await getText('https://api.genelpara.com/embed/altin.json'));
    const pair = (...ks) => { for (const k of ks) if (j[k]) return [trNum(j[k].alis), trNum(j[k].satis)]; return null; };
    return { _keys: Object.keys(j).slice(0, 60),
      source: 'GenelPara', time: '',
      gram_altin: pair('GA'), ons_usd: pair('ONS', 'XAU'), yeni_ceyrek: pair('C', 'CA'), yeni_yarim: pair('Y', 'YA'), yeni_tam: pair('T', 'TA'), yeni_ata: pair('CMR', 'CMA'),
      gumus_tl_gram: pair('GAG', 'GG'),
    };
  },
};
const okPair = (p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]) && p[0] > 0 && p[1] > 0;
async function local() {
  const out = {};
  for (const [name, fn] of Object.entries(LOCAL)) {
    try {
      const v = await fn();
      const keys = v._keys || []; delete v._keys;
      for (const k of Object.keys(v)) if (Array.isArray(v[k]) && !okPair(v[k])) delete v[k];
      if (!okPair(v.gram_altin) && !okPair(v.has_altin)) throw new Error('gram/has altın bulunamadı; anahtarlar: ' + keys.join(','));
      out[name] = v;
    } catch (e) { errors.push(`yerel ${name}: ${e.message || e}`); }
  }
  return out;
}

// ---------- 4) TCMB gösterge kurları (resmî, günde bir kez)
async function tcmb() {
  try {
    const x = await getText('https://www.tcmb.gov.tr/kurlar/today.xml');
    const date = (x.match(/Tarih="([^"]+)"/) || [])[1] || '';
    const get = (code) => {
      const m = x.match(new RegExp(`<Currency[^>]*CurrencyCode="${code}"[\\s\\S]*?</Currency>`));
      if (!m) return null;
      const f = (tag) => trNum((m[0].match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]);
      return { alis: f('ForexBuying'), satis: f('ForexSelling') };
    };
    return { date, USD: get('USD'), EUR: get('EUR'), GBP: get('GBP') };
  } catch (e) { errors.push(`tcmb: ${e.message || e}`); return null; }
}

// ---------- 5) Haber başlıkları (Google Haberler RSS) — yalnız başlık, kaynak ve saat
const QUERIES = ['altın fiyatları', 'dolar TL kur', 'TCMB faiz', 'Fed faiz Powell', 'petrol fiyatları Brent', 'Borsa İstanbul BIST'];
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
async function news() {
  const items = [], seen = new Set();
  for (const q of QUERIES) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&hl=tr&gl=TR&ceid=TR:tr`;
      const x = await getText(url);
      for (const m of x.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const it = m[1], g = (t) => decode((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '');
        let title = g('title'); const src = g('source'); const pub = Date.parse(g('pubDate'));
        if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
        const norm = title.toLowerCase().replace(/[^a-zçğıöşü0-9 ]/gi, '').slice(0, 70);
        if (!title || seen.has(norm) || !isFinite(pub)) continue;
        seen.add(norm);
        items.push({ q, title, source: src, link: g('link'), pub: Math.floor(pub / 1000) });
      }
    } catch (e) { errors.push(`haber "${q}": ${e.message || e}`); }
  }
  const cut = nowSec() - 30 * 3600;
  return items.filter((x) => x.pub >= cut).sort((a, b) => b.pub - a.pub).slice(0, 60);
}

// ---------- 6) Ekonomik takvim (Forex Factory haftalık JSON)
async function calendar() {
  try {
    const j = JSON.parse(await getText('https://nfs.faireconomy.media/ff_calendar_thisweek.json'));
    return j.map((e) => ({ title: e.title, country: e.country, t: Math.floor(Date.parse(e.date) / 1000), impact: e.impact, forecast: e.forecast || '', previous: e.previous || '' })).filter((e) => isFinite(e.t));
  } catch (e) { errors.push(`takvim: ${e.message || e}`); return null; }
}

// ---------- çalıştır
const t0 = Date.now();
const out = { mode: MODE, run_utc: new Date().toISOString(), run_trt: trt(nowSec()) };
if (MODE === 'seans') {
  const r = await GMI.collect();
  if (r.err.length > GMI.LIST.length / 2) { yahooHost = HOSTS[1]; const r2 = await GMI.collect(); if (r2.err.length < r.err.length) Object.assign(r, r2); }
  writeFileSync(`${OUT}/raw.csv`, r.csv);
  r.err.forEach((e) => errors.push(`motor ${e}`));
  out.engine = { rows_D: r.D.length, rows_W: r.W.length, rows_I: r.I.length };
}
out.quick = await quick();
out.fx = await fxfix();
out.local = await local();
out.tcmb = await tcmb();
if (MODE === 'seans') { out.news = await news(); out.calendar = await calendar(); }
out.yahoo_host = yahooHost;
out.errors = errors;
out.seconds = Math.round((Date.now() - t0) / 1000);
writeFileSync(`${OUT}/collect.json`, JSON.stringify(out, null, 1));
log(`toplama bitti (${MODE}) · ${out.seconds} sn · fiyat ${Object.keys(out.quick).length} · döviz ${Object.keys(out.fx).length} · yerel ${Object.keys(out.local).join(',') || 'yok'} · hata ${errors.length}`);
errors.forEach((e) => log('  -', e));
