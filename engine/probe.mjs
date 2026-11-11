// GMI — veri kaynağı testi: GitHub sunucusundan hangi kaynaklara erişilebildiğini ölçer.
import { writeFileSync, mkdirSync } from 'node:fs';

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const Y = (h, s, q) => `https://${h}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?${q}`;
const tests = [
  ['yahoo1_gold_d', Y('query1', 'GC=F', 'range=5d&interval=1d')],
  ['yahoo1_gold_d_nodeUA', Y('query1', 'GC=F', 'range=5d&interval=1d'), { ua: null }],
  ['yahoo2_try_60m', Y('query2', 'TRY=X', 'range=5d&interval=60m')],
  ['yahoo1_xu100_2y', Y('query1', 'XU100.IS', 'range=2y&interval=1d')],
  ['harem_ajax', 'https://www.haremaltin.com/dashboard/ajax/doviz', { method: 'POST', body: 'dil_kodu=tr', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.haremaltin.com/' } }],
  ['truncgil_v4', 'https://finans.truncgil.com/v4/today.json'],
  ['truncgil_v3', 'https://finans.truncgil.com/today.json'],
  ['genelpara_altin', 'https://api.genelpara.com/embed/altin.json'],
  ['genelpara_doviz', 'https://api.genelpara.com/embed/doviz.json'],
  ['tcmb_today', 'https://www.tcmb.gov.tr/kurlar/today.xml'],
  ['doviz_home', 'https://www.doviz.com/'],
  ['doviz_gram_api', 'https://www.doviz.com/api/v12/assets/gram-altin/daily'],
  ['stooq_xauusd', 'https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=csv'],
  ['gnews_altin', 'https://news.google.com/rss/search?q=alt%C4%B1n+fiyatlar%C4%B1+when:1d&hl=tr&gl=TR&ceid=TR:tr'],
  ['bloomberght_rss', 'https://www.bloomberght.com/rss'],
  ['aa_ekonomi_rss', 'https://www.aa.com.tr/tr/rss/default?cat=ekonomi'],
  ['ff_calendar', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'],
];

function shape(txt) {
  try {
    const j = JSON.parse(txt);
    const top = Array.isArray(j) ? ['<dizi ' + j.length + '>'] : Object.keys(j).slice(0, 90);
    let inner = null;
    const d = Array.isArray(j) ? j[0] : (j.data && typeof j.data === 'object' ? j.data : null);
    if (d && typeof d === 'object') inner = Object.keys(d).slice(0, 90);
    return { json: true, top, inner };
  } catch { return { json: false }; }
}

const out = { run_utc: new Date().toISOString(), results: {} };
for (const [name, url, opt = {}] of tests) {
  const t0 = Date.now();
  const headers = Object.assign({ Accept: '*/*', 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' }, opt.headers || {});
  if (opt.ua !== null) headers['User-Agent'] = BROWSER_UA;
  try {
    const ctl = AbortSignal.timeout(20000);
    const r = await fetch(url, { method: opt.method || 'GET', headers, body: opt.body, signal: ctl, redirect: 'follow' });
    const txt = await r.text();
    out.results[name] = { status: r.status, ms: Date.now() - t0, ctype: r.headers.get('content-type'), len: txt.length, shape: shape(txt), sample: txt.slice(0, 1500) };
  } catch (e) {
    out.results[name] = { error: String(e && e.message || e), ms: Date.now() - t0 };
  }
}
mkdirSync('out', { recursive: true });
writeFileSync('out/probe.json', JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.results)) console.log(k.padEnd(22), v.status || v.error, v.len || '', v.ms + 'ms');
