/* GMI Piyasa — mobil uygulama. Android'de veriyi telefon çeker ve analizi telefonda yapar (analysis.js);
   web sürümü data/app_data.json dosyasını okur. */
(function () {
  'use strict';
  var CFG = window.GMI_CONFIG || {};
  var VERSION = '2.1.0';
  var NATIVE = window.GMI_NATIVE || null;
  var GA = window.GMIA || null;
  var USE_PHONE = !!(NATIVE && GA);
  var SIG_CLS = { GAL: 'sg-gal', AL: 'sg-al', NOTR: 'sg-notr', SAT: 'sg-sat', GSAT: 'sg-gsat', VERI: 'sg-veri' };
  var STRIP = ['GRAM', 'GOLD_FUT', 'SILVER_FUT', 'USDTRY', 'XU100', 'BTC'];
  var chartState = { key: null, tf: 'G', span: 1 };
  var MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  var VIEWS = ['piyasa', 'altin', 'teknik', 'gundem', 'karne'];
  var state = { data: null, fetchedAt: 0, offline: false, loading: false, error: null };
  var installEvt = null;

  /* ---------- yardımcılar ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var nfCache = {};
  function num(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    dp = dp == null ? 2 : dp;
    var f = nfCache[dp] || (nfCache[dp] = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
    return f.format(v).replace('-', '−');
  }
  function sign(v) { return v > 0 ? '+' : (v < 0 ? '−' : ''); }
  function pct(v) { return (v == null || !isFinite(v)) ? '—' : sign(v) + '%' + num(Math.abs(v), 2); }
  function bp(v) { return (v == null || !isFinite(v)) ? '—' : sign(v) + num(Math.abs(v), 1) + ' bp'; }
  function dir(v) { return (v == null || !isFinite(v) || Math.abs(v) < 0.005) ? 'flat' : (v > 0 ? 'up' : 'down'); }
  function when(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s || '');
    if (!m) return s || '—';
    return (+m[3]) + ' ' + MON[+m[2] - 1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
  }
  function rows(sec) { return (state.data && Array.isArray(state.data[sec])) ? state.data[sec] : []; }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function td(text, cls) { return el('td', cls || null, text); }

  /* ---------- veri ---------- */
  function load() {
    if (state.loading) return;
    state.loading = true;
    $('btn-refresh').classList.add('spin');
    if (USE_PHONE) {
      if (!state.data) { var c = GA.cached(); if (c) { state.data = c; render(); } }
      $('m-updated').textContent = 'Veriler telefona çekiliyor…';
      GA.run(function (done, total) { $('m-updated').textContent = 'Veriler telefona çekiliyor… ' + done + '/' + total; })
        .then(function (d) { state.data = d; state.error = null; })
        .catch(function (e) { state.error = (e && e.message) || String(e); })
        .then(function () {
          state.loading = false; state.fetchedAt = Date.now();
          $('btn-refresh').classList.remove('spin');
          render();
          if (chartState.key && !$('chart-sheet').hidden) drawChart();
        });
      return;
    }
    fetch(CFG.dataUrl + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        state.data = d; state.offline = false;
        if ('caches' in window) {
          caches.open('gmi-veri').then(function (c) {
            return c.put(new URL(CFG.dataUrl, location.href).href, new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }));
          }).catch(function () {});
        }
      })
      .catch(function () {
        if (!('caches' in window)) return null;
        return caches.match(new URL(CFG.dataUrl, location.href).href)
          .then(function (c) { return c ? c.json() : null; })
          .then(function (d) { if (d) { state.data = d; state.offline = true; } });
      })
      .then(function () {
        state.loading = false;
        state.fetchedAt = Date.now();
        $('btn-refresh').classList.remove('spin');
        render();
      });
  }

  /* ---------- çizim ---------- */
  function render() {
    if (!state.data) {
      $('m-updated').textContent = 'Veri alınamadı. İnternet bağlantınızı kontrol edip yenileyin.';
      return;
    }
    renderHeader(); renderStrip(); renderAlerts(); renderPrices(); renderGold(); renderSignals(); renderTech(); renderAgenda(); renderPerf(); renderBanner();
  }

  function status() { return rows('status')[0] || {}; }

  function renderHeader() {
    var s = status();
    $('m-updated').textContent = 'Son güncelleme ' + when(s.updated_trt);
    $('m-session').textContent = (s.session || '') + (s.next_session ? ' · Sonraki: ' + s.next_session : '');
    $('summary').textContent = s.summary || '';
    var note = $('note');
    note.textContent = s.note || '';
    note.hidden = !s.note;
    $('tech-asof').textContent = s.tech_asof || '—';
  }

  function renderBanner() {
    var b = $('banner'); clear(b);
    var msgs = [];
    if (state.offline || navigator.onLine === false) msgs.push('Çevrimdışısınız; son kaydedilen veriler gösteriliyor.');
    if (state.error) msgs.push('Analiz tamamlanamadı: ' + state.error + '. Son kaydedilen veriler gösteriliyor.');
    var gen = Date.parse((state.data && state.data.generated_at) || '');
    if (isFinite(gen)) {
      var h = (Date.now() - gen) / 36e5;
      if (USE_PHONE && h > 3 && !state.loading) msgs.push('Veriler ' + Math.round(h) + ' saat önce hesaplandı. Yenilemek için ↻ düğmesine dokunun.');
      if (!USE_PHONE && h > (CFG.staleHours || 12)) msgs.push('Bu web sayfası artık otomatik güncellenmiyor (veriler ' + Math.round(h) + ' saatlik). Güncel veri için Android uygulamasını kurun.');
    }
    if (!USE_PHONE && CFG.apkUrl) {
      var a = el('a', 'btn', 'Android uygulamasını indir'); a.href = CFG.apkUrl; a.rel = 'noopener';
      b.append(a);
    }
    if (installEvt && !isStandalone()) {
      var span = el('span', null, 'Uygulamayı telefona yükleyebilirsiniz.');
      var btn = el('button', 'btn', 'Yükle'); btn.addEventListener('click', doInstall);
      b.append(span, btn);
    }
    msgs.forEach(function (m) { b.append(el('div', null, m)); });
    b.hidden = !b.firstChild;
  }

  function renderAlerts() {
    var ul = clear($('alerts'));
    var a = rows('alerts').slice(0, 8);
    $('alerts-empty').hidden = a.length > 0;
    a.forEach(function (x) {
      var li = el('li', 'item' + (x.level === 'uyarı' ? ' warn' : ''));
      var top = el('div', 'item-top');
      top.append(el('span', null, when(x.time)), el('span', null, x.asset || ''), el('span', 'badge' + (x.level === 'uyarı' ? ' hi' : ''), x.level || ''));
      li.append(top, el('div', 'item-title', x.title || ''));
      if (x.detail) li.append(el('p', 'item-detail', x.detail));
      ul.append(li);
    });
  }

  function priceCard(r) {
    var c = el('div', 'card');
    c.append(el('div', 'pname', r.name));
    var v = el('div', 'pval');
    if (r.bid != null || r.ask != null) {
      v.className = 'pval pval-sm';
      v.textContent = num(r.bid, r.dp) + ' / ' + num(r.ask, r.dp) + (r.unit ? ' ' + r.unit : '');
    } else {
      v.textContent = num(r.value, r.dp) + (r.unit ? ' ' + r.unit : '');
    }
    c.append(v);
    if (r.key === 'US10Y' && r.chg_bp != null) c.append(el('div', 'pchg ' + dir(r.chg_bp), bp(r.chg_bp)));
    else if (r.chg_pct != null) c.append(el('div', 'pchg ' + dir(r.chg_pct), pct(r.chg_pct)));
    else if (r.bid != null) c.append(el('div', 'pchg flat', 'alış / satış'));
    c.append(el('div', 'pmeta', (r.time || '') + ' · ' + (r.kind || '')));
    return c;
  }

  function renderPrices() {
    var box = clear($('prices'));
    var groups = {}; var order = [];
    rows('prices').slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (r) {
      if (!groups[r.group]) { groups[r.group] = []; order.push(r.group); }
      groups[r.group].push(r);
    });
    order.forEach(function (g) {
      box.append(el('div', 'grp', g));
      var grid = el('div', 'grid');
      groups[g].forEach(function (r) { grid.append(priceCard(r)); });
      box.append(grid);
    });
  }

  function renderGold() {
    var gold = rows('gold');
    var cards = clear($('gram-cards'));
    gold.filter(function (r) { return (r.order || 0) < 10; }).sort(function (a, b) { return a.order - b.order; }).forEach(function (r) {
      var c = el('div', 'card');
      c.append(el('div', 'pname', r.label));
      c.append(el('div', 'pval pval-sm', (r.bid != null ? num(r.bid, 2) + ' / ' + num(r.ask, 2) : num(r.value, 2)) + ' TL'));
      var diff = r.metric === 'THEO' ? 'referans' : 'teorikten fark ' + pct(r.diff_bid_pct) + (r.diff_ask_pct != null ? ' / ' + pct(r.diff_ask_pct) : '');
      c.append(el('div', 'pchg flat', diff));
      c.append(el('div', 'pmeta', (r.time || '') + (r.spread_pct != null ? ' · makas %' + num(r.spread_pct, 2) : '')));
      cards.append(c);
    });
    var tb = clear($('coins').tBodies[0]);
    gold.filter(function (r) { return (r.order || 0) >= 10; }).sort(function (a, b) { return a.order - b.order; }).forEach(function (r) {
      var tr = el('tr');
      tr.append(td(r.label), td(num(r.bid, 0)), td(num(r.ask, 0)), td(num(r.theo, 0)), td(pct(r.diff_bid_pct)), td(pct(r.diff_ask_pct)), td(r.time || ''));
      tb.append(tr);
    });
    renderLadder();
    var gl = clear($('gram-levels').tBodies[0]);
    var g = rows('tech').filter(function (r) { return r.key === 'GOLD_FUT'; })[0];
    var fx = rows('prices').filter(function (r) { return r.key === 'USDTRY'; })[0];
    if (g && fx && fx.value != null) {
      ['r3', 'r2', 'r1', 's1', 's2', 's3'].forEach(function (k) {
        if (g[k] == null) return;
        var tr = el('tr');
        tr.append(td(k.toUpperCase()), td(num(g[k], 1)), td(num(g[k] * fx.value / 31.1034768, 2)), td(g[k + '_note'] || ''));
        gl.append(tr);
      });
    }
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function renderLadder() {
    var box = clear($('ladder'));
    var g = rows('tech').filter(function (r) { return r.key === 'GOLD_FUT'; })[0];
    var px = rows('prices').filter(function (r) { return r.key === 'GOLD_FUT'; })[0];
    if (!g) { box.textContent = '—'; return; }
    var lv = [];
    ['r3', 'r2', 'r1', 's1', 's2', 's3'].forEach(function (k) { if (g[k] != null) lv.push({ k: k.toUpperCase(), v: g[k], note: g[k + '_note'] || '', res: k.charAt(0) === 'r' }); });
    var price = px && px.value != null ? px.value : null;
    var W = Math.max(260, (box.clientWidth || 340) - 12), H = 300, padR = 4, padL = 4;
    var vals = lv.map(function (d) { return d.v; }); if (price != null) vals.push(price);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = (hi - lo) || 1;
    lo -= span * 0.08; hi += span * 0.08;
    function y(v) { return 12 + (hi - v) / (hi - lo) * (H - 24); }
    var midX = Math.round(W * 0.46);
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', 'aria-label': 'Ons altın son fiyatı ' + num(price, 1) + ' dolar; destek ve direnç seviyeleri' });
    var tip = el('div', 'tip'); tip.hidden = true;
    lv.sort(function (a, b) { return b.v - a.v; });
    var lastY = -Infinity;
    lv.forEach(function (d) {
      var yy = y(d.v), ly = Math.max(yy - 4, lastY + 14); lastY = ly;
      var gr = svgEl('g', {}); gr.style.cursor = 'pointer';
      var line = svgEl('line', { x1: midX, x2: W - padR, y1: yy, y2: yy, 'stroke-width': 1.6, 'stroke-dasharray': '5 3' });
      line.style.stroke = d.res ? 'var(--bad)' : 'var(--ok)';
      var t = svgEl('text', { x: W - padR, y: ly, 'text-anchor': 'end', 'font-size': 12 }); t.style.fill = 'var(--fg)';
      t.textContent = d.k + ' · ' + num(d.v, 1);
      var hit = svgEl('rect', { x: midX, y: yy - 14, width: W - padR - midX, height: 22, fill: 'transparent' });
      gr.append(line, t, hit);
      gr.addEventListener('click', function () {
        tip.textContent = d.k + ' ' + num(d.v, 1) + ' $ — ' + (d.note || 'seviye');
        tip.hidden = false;
        tip.style.left = Math.max(0, Math.min(midX - 40, W - 230)) + 'px';
        tip.style.top = Math.min(H - 30, yy + 14) + 'px';
      });
      svg.append(gr);
    });
    if (price != null) {
      var py = y(price);
      var pl = svgEl('line', { x1: padL, x2: W - padR, y1: py, y2: py, 'stroke-width': 1.3 }); pl.style.stroke = 'var(--fg)';
      var dot = svgEl('circle', { cx: midX - 8, cy: py, r: 5 }); dot.style.fill = 'var(--gold)';
      var t1 = svgEl('text', { x: padL, y: py - 7, 'font-size': 13, 'font-weight': 700 }); t1.style.fill = 'var(--fg)'; t1.textContent = 'Son ' + num(price, 1) + ' $';
      var t2 = svgEl('text', { x: padL, y: py + 16, 'font-size': 11 }); t2.style.fill = 'var(--muted)'; t2.textContent = (px.time || '') + ' · ' + (px.kind || '');
      svg.append(pl, dot, t1, t2);
    }
    box.addEventListener('click', function (e) { if (e.target === box || e.target === svg) tip.hidden = true; });
    box.append(svg, tip);
  }

  function scoreTxt(v) { return v == null ? '—' : sign(v) + Math.abs(v); }
  function sigBadge(code, label) { return el('span', 'sig ' + (SIG_CLS[code] || 'sg-veri'), label || code || '—'); }
  function statFor(code) {
    if (!GA || !GA.signalStats) return null;
    var b = GA.signalStats().by[code];
    if (!b) return null;
    var n = (b.isabet || 0) + (b['ıska'] || 0);
    return n ? { rate: 100 * b.isabet / n, n: n, flat: b.yatay || 0 } : null;
  }

  function renderStrip() {
    var box = clear($('sig-strip')), list = rows('signals');
    box.hidden = !list.length;
    STRIP.forEach(function (k) {
      var x = list.filter(function (r) { return r.key === k; })[0];
      if (!x) return;
      var b = el('button', 'chip'); b.type = 'button';
      b.append(el('span', 'chip-n', x.name.replace(/ \(.*\)$/, '')), sigBadge(x.code, x.label));
      b.addEventListener('click', function () { openChart(k); });
      box.append(b);
    });
  }

  function renderSignals() {
    var box = clear($('signals')), list = rows('signals');
    $('signals-empty').hidden = list.length > 0;
    list.forEach(function (x) {
      var c = el('button', 'card sig-card'); c.type = 'button';
      var top = el('div', 'sig-top'); top.append(el('span', 'pname', x.name), sigBadge(x.code, x.label));
      var line = el('div', 'sig-line');
      line.append(el('span', 'pval pval-sm', num(x.price, x.dp) + (x.unit ? ' ' + x.unit : '')), el('span', 'pchg ' + dir(x.chg), pct(x.chg)));
      c.append(top, line, el('div', 'pmeta', 'Günlük skor ' + scoreTxt(x.ds) + '/' + x.dn + ' · kısa vade ' + (x.ss == null ? '—' : scoreTxt(x.ss) + '/' + x.sn) + ' · ' + (x.trend || '')));
      if (x.invalid) c.append(el('div', 'pmeta', (x.code === 'NOTR' ? 'Yön için: ' : 'Geçersiz kılan: ') + x.invalid));
      if (x.notes && x.notes.length) c.append(el('div', 'sig-note', x.notes[0]));
      if (x.stale) c.append(el('div', 'sig-note', 'Güncel veri alınamadı; önbellekteki veriyle hesaplandı.'));
      c.addEventListener('click', function () { openChart(x.key); });
      box.append(c);
    });
  }

  function openChart(key) {
    chartState.key = key;
    var a = GA && GA.assets && GA.assets[key];
    if (chartState.tf !== 'G' && !(a && a.intra)) chartState.tf = 'G';
    $('chart-sheet').hidden = false; $('chart-bg').hidden = false;
    document.body.classList.add('noscroll');
    drawChart();
  }
  function closeChart() { $('chart-sheet').hidden = true; $('chart-bg').hidden = true; document.body.classList.remove('noscroll'); chartState.key = null; }
  function lvl(o, lbl, kind) { return o && o.v != null ? { v: o.v, label: lbl, kind: kind, note: (o.labels || []).join(', ') } : null; }
  function drawChart() {
    var key = chartState.key; if (!key) return;
    var sig = rows('signals').filter(function (x) { return x.key === key; })[0];
    var t = rows('tech').filter(function (x) { return x.key === key; })[0];
    var a = (GA && GA.assets && GA.assets[key]) || {};
    var name = (sig && sig.name) || (t && t.name) || a.name || key, dp = sig ? sig.dp : (t ? t.dp : (a.dp || 2)), unit = sig ? sig.unit : (a.unit || '');
    $('ch-name').textContent = name;
    $('ch-sub').textContent = sig ? num(sig.price, dp) + (unit ? ' ' + unit : '') + ' · ' + pct(sig.chg) + ' · teknik sinyal: ' + sig.label : '';
    document.querySelectorAll('#ch-tf button').forEach(function (b) {
      var tf = b.getAttribute('data-tf'); b.setAttribute('aria-pressed', tf === chartState.tf ? 'true' : 'false');
      b.disabled = tf !== 'G' && !a.intra;
    });
    var labels = (window.GMICHART && GMICHART.SPAN_LABEL[chartState.tf]) || ['kısa', 'orta', 'uzun'];
    document.querySelectorAll('#ch-span button').forEach(function (b) {
      var i = +b.getAttribute('data-span'); b.textContent = labels[i]; b.setAttribute('aria-pressed', i === chartState.span ? 'true' : 'false');
    });
    var levels = [];
    if (sig) levels = [lvl(sig.s1, 'S1', 's'), lvl(sig.s2, 'S2', 's'), lvl(sig.r1, 'R1', 'r'), lvl(sig.r2, 'R2', 'r')].filter(Boolean);
    else if (t) levels = [['s1', 'S1', 's'], ['s2', 'S2', 's'], ['r1', 'R1', 'r'], ['r2', 'R2', 'r']].map(function (x) { return t[x[0]] != null ? { v: t[x[0]], label: x[1], kind: x[2] } : null; }).filter(Boolean);
    var ser = GA && GA.seriesFor ? GA.seriesFor(key) : null;
    var box = $('ch-box');
    if (!window.GMICHART || !ser || !ser.d) { clear(box).append(el('p', 'sub', 'Grafikler Android uygulamasında, veriler telefona çekildikten sonra görünür.')); }
    else GMICHART.render(box, { daily: ser.d, hourly: ser.h, tf: chartState.tf, span: chartState.span, dp: dp, unit: unit, name: name, levels: levels });
    renderSigDetail(sig);
  }
  function renderSigDetail(x) {
    var box = clear($('ch-sig'));
    if (!x) return;
    var h = el('div', 'sig-top'); h.append(el('strong', null, 'Teknik sinyal'), sigBadge(x.code, x.label)); box.append(h);
    box.append(el('p', 'sub', 'Günlük skor ' + scoreTxt(x.ds) + '/' + x.dn + ' (yedi göstergenin oyu), kısa vade ' + (x.ss == null ? 'hesaplanamadı' : scoreTxt(x.ss) + '/' + x.sn + ' (4 saat ve 1 saat)') +
      ' · RSI ' + num(x.rsi, 0) + ' (' + (x.rsiState || '—') + ') · ADX ' + num(x.adx, 0) + ' · ' + (x.trend || '')));
    var ul = el('ul', 'votes');
    (x.votes || []).forEach(function (v) { ul.append(el('li', v.ok ? 'up' : 'down', (v.ok ? '▲ ' : '▼ ') + v.txt)); });
    box.append(ul);
    (x.notes || []).forEach(function (n) { box.append(el('p', 'sig-note', n)); });
    var lv = [];
    if (x.s1) lv.push('S1 ' + num(x.s1.v, x.dp) + ' (' + x.s1.labels.join(', ') + ')');
    if (x.r1) lv.push('R1 ' + num(x.r1.v, x.dp) + ' (' + x.r1.labels.join(', ') + ')');
    if (lv.length) box.append(el('p', 'sub', 'Anlamlı seviyeler: ' + lv.join(' · ')));
    if (x.invalid) box.append(el('p', 'sub', (x.code === 'NOTR' ? 'Yön için: ' : 'Sinyali geçersiz kılan: ') + x.invalid + '.'));
    var st = statFor(x.code);
    box.append(el('p', 'sub', st ? 'Bu sinyal türünün bu telefondaki geçmiş isabeti: %' + num(st.rate, 0) + ' (' + st.n + ' değerlendirme, ' + st.flat + ' yatay).'
      : 'Bu sinyal türü için henüz yeterli geçmiş değerlendirme yok.'));
    box.append(el('p', 'sub', 'Sinyal göstergelerden kurala göre üretilir; kesin yön ya da fiyat hedefi değildir, yatırım tavsiyesi değildir. Karar sizindir.'));
  }
  function scoreCls(v) { return v == null ? '' : (v >= 3 ? 'up' : (v <= -3 ? 'down' : 'flat')); }

  function renderTech() {
    var tb = clear($('tech').tBodies[0]);
    rows('tech').slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (r) {
      var tr = el('tr');
      var sc = el('td'); if (r.signal) sc.append(sigBadge(r.signal_code, r.signal)); else sc.textContent = '—';
      tr.append(td(r.name), sc, td(scoreTxt(r.daily_score), scoreCls(r.daily_score)), td(scoreTxt(r.short_score), scoreCls(r.short_score)),
        td(num(r.rsi, 1)), td(num(r.s1, r.dp)), td(num(r.r1, r.dp)), td(r.trend || '—', 'wrap'));
      tr.className = 'tap'; tr.addEventListener('click', function () { openChart(r.key); });
      tb.append(tr);
    });
    var sb = clear($('scen').tBodies[0]);
    var prices = rows('prices');
    rows('scenarios').forEach(function (s) {
      var p = prices.filter(function (x) { return x.key === s.key; })[0];
      var price = p ? p.value : null, state_ = 'fiyat yok', cls = 'flat';
      if (price != null) {
        if (s.up_level != null && price > s.up_level) { state_ = 'yükseliş eşiğinin üstünde'; cls = 'up'; }
        else if (s.down_level != null && price < s.down_level) { state_ = 'düşüş eşiğinin altında'; cls = 'down'; }
        else state_ = 'eşikler arasında';
      }
      var tr = el('tr');
      tr.append(td(s.name), td(state_, cls + ' wrap'), td(num(price, s.dp)), td(num(s.down_level, s.dp)), td(num(s.up_level, s.dp)));
      sb.append(tr);
    });
  }

  function agendaItem(a) {
    var li = el('li', 'item');
    var top = el('div', 'item-top');
    top.append(el('span', null, a.when || ''));
    if (a.importance) top.append(el('span', 'badge' + (/yüksek/i.test(a.importance) ? ' hi' : ''), a.importance));
    li.append(top, el('div', 'item-title', a.title || ''));
    if (a.detail) li.append(el('p', 'item-detail', a.detail));
    var parts = [a.assets, a.impact, a.source].filter(function (x) { return x; });
    if (parts.length) li.append(el('div', 'pmeta', parts.join(' · ')));
    return li;
  }

  function renderAgenda() {
    var cutoff = Date.now() - 36e5;
    var cal = clear($('calendar'));
    rows('agenda').filter(function (a) { return a.kind === 'takvim' && (!a.sort || Date.parse(a.sort + ':00+03:00') >= cutoff); })
      .sort(function (a, b) { return String(a.sort || '').localeCompare(String(b.sort || '')); }).slice(0, 12)
      .forEach(function (a) { cal.append(agendaItem(a)); });
    var news = clear($('news'));
    rows('agenda').filter(function (a) { return a.kind === 'haber'; })
      .sort(function (a, b) { return String(b.sort || '').localeCompare(String(a.sort || '')); }).slice(0, 14)
      .forEach(function (a) { news.append(agendaItem(a)); });
  }

  function renderPerf() {
    var ss = clear($('sig-stats'));
    if (GA && GA.signalStats) {
      var by = GA.signalStats().by, codes = ['GAL', 'AL', 'SAT', 'GSAT'].filter(function (c) { return by[c]; });
      if (codes.length) {
        var tbl = el('table', 'tbl'), th = el('thead'), hr = el('tr');
        ['Sinyal', 'İsabet', 'Iska', 'Yatay', 'İsabet oranı'].forEach(function (h) { hr.append(el('th', null, h)); });
        th.append(hr); tbl.append(th);
        var tb2 = el('tbody');
        codes.forEach(function (c) {
          var b = by[c], n = (b.isabet || 0) + (b['ıska'] || 0), tr = el('tr'), sc = el('td');
          sc.append(sigBadge(c, GA.SIG_LABEL[c]));
          tr.append(sc, td(String(b.isabet || 0)), td(String(b['ıska'] || 0)), td(String(b.yatay || 0)), td(n ? '%' + num(100 * b.isabet / n, 0) : '—'));
          tb2.append(tr);
        });
        tbl.append(tb2);
        var w = el('div', 'tw'); w.append(tbl); ss.append(w);
      }
    }
    var p = rows('perf');
    $('perf-empty').hidden = p.length > 0;
    $('perf-body').hidden = p.length === 0;
    if (!p.length) return;
    function count(k) { return p.filter(function (r) { return (r.direction_hit || '') === k; }).length; }
    var hit = count('isabet'), miss = count('ıska'), flat = count('yatay');
    $('p-rate').textContent = (hit + miss) ? '%' + num(hit / (hit + miss) * 100, 1) : '—';
    $('p-n').textContent = String(p.length);
    $('p-split').textContent = hit + ' / ' + miss + ' / ' + flat;
    var tb = clear($('perf').tBodies[0]);
    p.slice(0, 40).forEach(function (r) {
      var cls = r.direction_hit === 'isabet' ? 'up' : (r.direction_hit === 'ıska' ? 'down' : 'flat');
      var tr = el('tr');
      tr.append(td(r.name || r.key), td(when(r.issued)), td(r.daily_bias || '—'), td(num(r.ref_price, r.dp)), td(num(r.actual_price, r.dp)),
        td(pct(r.chg_pct), dir(r.chg_pct)), td(r.direction_hit || '—', cls));
      tb.append(tr);
    });
  }

  /* ---------- sekmeler ---------- */
  function show(view) {
    if (VIEWS.indexOf(view) < 0) view = 'piyasa';
    document.querySelectorAll('.view').forEach(function (s) { s.hidden = s.getAttribute('data-view') !== view; });
    document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', t.getAttribute('data-tab') === view ? 'true' : 'false'); });
    if (view === 'altin') renderLadder();
  }
  function go(view) {
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    show(view);
    window.scrollTo(0, 0);
  }

  /* ---------- ayarlar, yükleme, bildirimler ---------- */
  function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
  function openSheet() {
    $('sheet').hidden = false; $('sheet-bg').hidden = false;
    if (NATIVE) { renderBgLog(); renderNt(); } else refreshPushStatus();
  }
  function renderBgLog() {
    if (!NATIVE) return;
    var j = {};
    try { j = JSON.parse(NATIVE.backgroundLog() || '{}'); } catch (e) { j = {}; }
    if (!j.time) { $('bg-log').textContent = 'Henüz arka plan kontrolü yapılmadı.'; return; }
    var px = j.prices || {}, parts = [];
    if (px.ons) parts.push('ons ' + px.ons);
    if (px.gram) parts.push('gram ' + px.gram);
    if (px.usdtry) parts.push('USD/TRY ' + px.usdtry);
    var txt = 'Son kontrol: ' + when(j.time) + (j.note ? ' · ' + j.note : '') + (parts.length ? ' · ' + parts.join(' · ') : '') + (j.new_alerts != null ? ' · yeni uyarı: ' + j.new_alerts : '');
    if (j.errors && j.errors.length) txt += ' · alınamayan veri: ' + j.errors.length;
    $('bg-log').textContent = txt;
  }
  function renderNt() {
    if (!NATIVE) return;
    var on = false; try { on = NATIVE.notificationsAllowed(); } catch (e) { on = false; }
    $('nt-status').textContent = on ? 'Bildirim izni açık.' : 'Bildirim izni kapalı. "Bildirim izni" düğmesine dokunun.';
  }
  function setupNative() {
    if (!NATIVE) { if ($('apk-link') && CFG.apkUrl) $('apk-link').href = CFG.apkUrl; return; }
    $('native-only').hidden = false; $('web-only').hidden = true;
    try { $('bg-toggle').checked = NATIVE.backgroundOn(); } catch (e) { /* yok say */ }
    $('bg-toggle').addEventListener('change', function () { NATIVE.setBackground(this.checked); renderBgLog(); });
    $('btn-check-now').addEventListener('click', function () {
      NATIVE.checkNow(); $('bg-log').textContent = 'Kontrol başlatıldı; sonuç birkaç saniye içinde burada görünür.';
      setTimeout(renderBgLog, 12000); setTimeout(renderBgLog, 30000);
    });
    $('btn-battery').addEventListener('click', function () { NATIVE.openBatterySettings(); });
    $('btn-nt').addEventListener('click', function () { NATIVE.requestNotifications(); setTimeout(renderNt, 2000); });
    $('btn-nt-test').addEventListener('click', function () { NATIVE.testNotification(); });
    try { $('ver').textContent = 'Sürüm ' + VERSION + ' · Android ' + NATIVE.version(); } catch (e) { /* yok say */ }
  }
  function closeSheet() { $('sheet').hidden = true; $('sheet-bg').hidden = true; }
  function doInstall() {
    if (!installEvt) return;
    installEvt.prompt();
    installEvt.userChoice.then(function () { installEvt = null; $('btn-install').hidden = true; renderBanner(); });
  }
  function b64uToU8(s) {
    var pad = '='.repeat((4 - s.length % 4) % 4);
    var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function pushSupported() { return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window); }
  function refreshPushStatus() {
    var st = $('push-status');
    if (!pushSupported()) { st.textContent = 'Bu tarayıcı bildirimleri desteklemiyor. Android\'de Chrome ile açıp uygulamayı yükleyin.'; return; }
    if (Notification.permission === 'denied') { st.textContent = 'Bildirim izni kapalı. Telefonun Ayarlar → Uygulamalar bölümünden bu uygulamaya bildirim izni verin.'; return; }
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (sub) {
        st.textContent = 'Bildirimler bu telefonda açık. Kodu GitHub\'a kaydettiyseniz uyarılar gelir.';
        var v = null;
        try { v = JSON.parse(localStorage.getItem('gmi-vapid') || 'null'); } catch (_) { v = null; }
        if (v) showCode(v, sub);
      } else {
        st.textContent = 'Bildirimler kapalı. Açmak için düğmeye dokunun.';
      }
    }).catch(function () { st.textContent = 'Bildirim durumu okunamadı.'; });
  }
  function u8ToB64u(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Bildirim anahtarları bu telefonda üretilir; özel anahtar yalnız sizin kopyaladığınız kodda ve GitHub'daki gizli değerde bulunur.
  function getVapid() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem('gmi-vapid') || 'null'); } catch (_) { v = null; }
    if (v && v.publicKey && v.privateKey) return Promise.resolve(v);
    return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']).then(function (kp) {
      return Promise.all([crypto.subtle.exportKey('raw', kp.publicKey), crypto.subtle.exportKey('jwk', kp.privateKey)]);
    }).then(function (res) {
      v = { publicKey: u8ToB64u(new Uint8Array(res[0])), privateKey: res[1].d };
      try { localStorage.setItem('gmi-vapid', JSON.stringify(v)); } catch (_) {}
      return v;
    });
  }
  function showCode(v, sub) {
    $('push-code').value = JSON.stringify({ v: 1, vapidPublicKey: v.publicKey, vapidPrivateKey: v.privateKey, subscription: sub.toJSON ? sub.toJSON() : sub });
    $('push-box').hidden = false;
  }
  function enablePush() {
    if (!pushSupported() || !(window.crypto && crypto.subtle)) { refreshPushStatus(); return; }
    var vapid = null;
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { refreshPushStatus(); return null; }
      return getVapid().then(function (v) {
        vapid = v;
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          var key = b64uToU8(vapid.publicKey);
          if (sub) {
            var cur = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
            var same = cur && cur.length === key.length && cur.every(function (b, i) { return b === key[i]; });
            if (same) return sub;
            return sub.unsubscribe().then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); });
          }
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        });
      });
    }).then(function (sub) {
      if (!sub) return;
      showCode(vapid, sub);
      refreshPushStatus();
    }).catch(function (e) { $('push-status').textContent = 'Bildirim açılamadı: ' + (e && e.message ? e.message : e); });
  }
  function testPush() {
    if (!pushSupported() || Notification.permission !== 'granted') { enablePush(); return; }
    navigator.serviceWorker.ready.then(function (reg) {
      reg.showNotification('GMI Piyasa', { body: 'Deneme: bildirimler bu telefonda görünüyor.', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'gmi-test' });
    });
  }
  function copyCode() {
    var t = $('push-code').value;
    if (!t) return;
    var done = function () { $('btn-copy').textContent = 'Kopyalandı'; setTimeout(function () { $('btn-copy').textContent = 'Kodu kopyala'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { $('push-code').select(); });
    else { $('push-code').select(); }
  }

  /* ---------- başlat ---------- */
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { go(t.getAttribute('data-tab')); }); });
  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
  window.addEventListener('online', function () { load(); });
  window.addEventListener('offline', function () { if (state.data) renderBanner(); });
  $('btn-refresh').addEventListener('click', load);
  $('btn-menu').addEventListener('click', openSheet);
  $('btn-close').addEventListener('click', closeSheet);
  $('sheet-bg').addEventListener('click', closeSheet);
  $('btn-install').addEventListener('click', doInstall);
  $('btn-push').addEventListener('click', enablePush);
  $('btn-test').addEventListener('click', testPush);
  $('btn-copy').addEventListener('click', copyCode);
  $('ch-close').addEventListener('click', closeChart);
  $('chart-bg').addEventListener('click', closeChart);
  document.querySelectorAll('#ch-tf button').forEach(function (b) { b.addEventListener('click', function () { if (b.disabled) return; chartState.tf = b.getAttribute('data-tf'); drawChart(); }); });
  document.querySelectorAll('#ch-span button').forEach(function (b) { b.addEventListener('click', function () { chartState.span = +b.getAttribute('data-span'); drawChart(); }); });
  $('ver').textContent = 'Sürüm ' + VERSION;
  setupNative();
  window.gmiOnResume = function () {
    if (!state.loading && Date.now() - state.fetchedAt > (CFG.autoRefreshMinutes || 5) * 6e4) load();
    else if (!$('sheet').hidden) renderBgLog();
  };
  if (isStandalone()) $('install-text').textContent = 'Uygulama bu telefonda yüklü.';

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); installEvt = e; $('btn-install').hidden = false; renderBanner();
  });
  window.addEventListener('appinstalled', function () { installEvt = null; $('btn-install').hidden = true; renderBanner(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - state.fetchedAt > (CFG.autoRefreshMinutes || 5) * 6e4) load();
  });
  var resizeT = null;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (!$('v-altin').hidden) renderLadder(); if (chartState.key) drawChart(); }, 200); });

  if (!NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  show(location.hash.slice(1));
  load();
})();
