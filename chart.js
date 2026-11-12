/* GMI teknik grafik: mum grafiği, hareketli ortalamalar, Bollinger bandı, destek/direnç çizgileri, RSI ve MACD panelleri.
   Kullanım: GMICHART.render(kutu, { daily, hourly, tf: 'G'|'4S'|'1S', span: 0|1|2, dp, unit, name, levels: [{ v, label, kind: 's'|'r' }] })
   Dönüş: son mumun göstergeleri (yorum motoru için) ya da veri yoksa null. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  var SPANS = { G: [63, 126, 252], '4S': [60, 120, 240], '1S': [72, 150, 300] };
  var SPAN_LABEL = { G: ['3 ay', '6 ay', '1 yıl'], '4S': ['≈2 hafta', '≈1 ay', '≈2 ay'], '1S': ['≈3 gün', '≈1 hafta', '≈2 hafta'] };

  function s(tag, a, cls) {
    var e = document.createElementNS(NS, tag);
    if (a) Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); });
    if (cls) e.setAttribute('class', cls);
    return e;
  }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function num(v, dp) {
    if (!isNum(v)) return '—';
    return v.toLocaleString('tr-TR', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace('-', '−');
  }
  function trtParts(t) { var d = new Date((t + 10800) * 1000); return { d: d.getUTCDate(), m: d.getUTCMonth(), y: d.getUTCFullYear(), hh: ('0' + d.getUTCHours()).slice(-2), mm: ('0' + d.getUTCMinutes()).slice(-2) }; }
  function dateLabel(t, tf, long) {
    var p = trtParts(t);
    if (tf === 'G') return p.d + ' ' + MON[p.m] + (long ? ' ' + p.y : '');
    return p.d + ' ' + MON[p.m] + ' ' + p.hh + ':' + p.mm;
  }

  // ---- göstergeler (tüm seri üzerinde hesaplanır, sonra görünür pencere kesilir)
  function sma(c, n) {
    var out = new Array(c.length).fill(null), sum = 0;
    for (var i = 0; i < c.length; i++) { sum += c[i]; if (i >= n) sum -= c[i - n]; if (i >= n - 1) out[i] = sum / n; }
    return out;
  }
  function boll(c, n, k) {
    var m = sma(c, n), u = new Array(c.length).fill(null), l = new Array(c.length).fill(null);
    for (var i = n - 1; i < c.length; i++) {
      var v = 0;
      for (var j = i - n + 1; j <= i; j++) v += (c[j] - m[i]) * (c[j] - m[i]);
      var sd = Math.sqrt(v / n); u[i] = m[i] + k * sd; l[i] = m[i] - k * sd;
    }
    return { m: m, u: u, l: l };
  }
  function indicators(bars) {
    var c = bars.map(function (b) { return b.c; });
    var E = window.GMI || (typeof GMI !== 'undefined' ? GMI : null);
    var rsi = E ? E.rsi(c, 14) : new Array(c.length).fill(null);
    var md = E ? E.macd(c) : { m: [], s: [], h: [] };
    return { sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200), bb: boll(c, 20, 2), rsi: rsi, macd: md.m, sig: md.s, hist: md.h };
  }

  // Bir ortalamanın kaç mumu ve yaklaşık ne kadar takvim süresini kapsadığı (zaman damgalarından)
  function periodOf(all, N, tf) {
    var unit = tf === 'G' ? N + ' gün' : (tf === '4S' ? N + '×4 saat' : N + ' saat');
    if (!all || all.length <= N) return { txt: unit + ', veri yetmiyor', days: null, ok: false };
    var d = (all[all.length - 1].t - all[all.length - 1 - N].t) / 86400, ap = '';
    if (tf === 'G') { if (d >= 45) ap = '≈ ' + num(d / 30.44, d >= 300 ? 0 : 1) + ' ay'; }
    else if (tf === '4S' || d >= 1.5) ap = d >= 45 ? '≈ ' + num(d / 30.44, 1) + ' ay' : '≈ ' + num(d, d >= 10 ? 0 : 1) + ' gün';
    return { txt: unit + (ap ? ' ' + ap : ''), days: d, ok: true };
  }

  function seriesFor(o) {
    var E = window.GMI || (typeof GMI !== 'undefined' ? GMI : null);
    if (o.tf === 'G') return o.daily || [];
    if (!o.hourly || !o.hourly.length) return [];
    if (o.tf === '4S') return E && E.resample ? E.resample(o.hourly, 14400) : [];
    return o.hourly;
  }

  function render(box, o) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var all = seriesFor(o);
    if (!all || all.length < 30) {
      var p = document.createElement('p'); p.className = 'sub';
      p.textContent = o.tf === 'G' ? 'Grafik için yeterli günlük veri yok.' : 'Bu varlık için saatlik veri yok; günlük grafiğe bakın.';
      box.appendChild(p); return null;
    }
    var ind = indicators(all);
    var span = SPANS[o.tf][o.span == null ? 1 : o.span];
    var start = Math.max(0, all.length - span), bars = all.slice(start), n = bars.length;
    function cut(a) { return a.slice(start); }
    var S20 = cut(ind.sma20), S50 = cut(ind.sma50), S200 = cut(ind.sma200), BU = cut(ind.bb.u), BL = cut(ind.bb.l);
    var RSI = cut(ind.rsi), MACD = cut(ind.macd), SIG = cut(ind.sig), HIST = cut(ind.hist);
    var dp = o.dp == null ? 2 : o.dp;

    var W = Math.max(300, Math.round(box.clientWidth || 340));
    var padL = 4, padR = 56, H1 = Math.max(220, Math.min(380, Math.round(W * 0.66))), gap = 12, H2 = 64, H3 = 74, xlab = 18;
    var Ht = H1 + gap + H2 + gap + H3 + xlab;
    var cw = W - padL - padR, bw = cw / n;
    function X(i) { return padL + (i + 0.5) * bw; }

    // fiyat ekseni: mumlar + bantlar; yakın seviyeler de sığsın
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b, i) {
      lo = Math.min(lo, b.l); hi = Math.max(hi, b.h);
      if (isNum(BL[i])) lo = Math.min(lo, BL[i]);
      if (isNum(BU[i])) hi = Math.max(hi, BU[i]);
    });
    var rng = hi - lo || Math.abs(hi) * 0.01 || 1;
    (o.levels || []).forEach(function (L) { if (isNum(L.v) && L.v > lo - rng * 0.35 && L.v < hi + rng * 0.35) { lo = Math.min(lo, L.v); hi = Math.max(hi, L.v); } });
    rng = hi - lo || rng; lo -= rng * 0.04; hi += rng * 0.04;
    function Y(v) { return 6 + (hi - v) / (hi - lo) * (H1 - 12); }

    var last = bars[n - 1];
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + Ht, width: '100%', height: Ht, role: 'img',
      'aria-label': (o.name || '') + ' grafiği; son fiyat ' + num(last.c, dp) + (o.unit ? ' ' + o.unit : '') }, 'gc');

    // yatay ızgara ve sağ eksen
    for (var g = 0; g <= 4; g++) {
      var v = lo + (hi - lo) * g / 4, yy = Y(v);
      svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy }, 'gc-grid'));
      var tx = s('text', { x: W - padR + 4, y: yy + 4 }, 'gc-ax'); tx.textContent = num(v, dp); svg.appendChild(tx);
    }
    // Bollinger bandı
    var bandTop = [], bandBot = [];
    for (var i = 0; i < n; i++) if (isNum(BU[i]) && isNum(BL[i])) { bandTop.push(X(i).toFixed(1) + ',' + Y(BU[i]).toFixed(1)); bandBot.unshift(X(i).toFixed(1) + ',' + Y(BL[i]).toFixed(1)); }
    if (bandTop.length > 1) svg.appendChild(s('polygon', { points: bandTop.concat(bandBot).join(' ') }, 'gc-band'));
    // seviyeler
    var vis = (o.levels || []).filter(function (L) { return isNum(L.v) && L.v >= lo && L.v <= hi; }).map(function (L) { return { L: L, y: Y(L.v) }; })
      .sort(function (a, b) { return a.y - b.y; });
    var prevY = -Infinity;
    vis.forEach(function (z) {
      svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: z.y, y2: z.y }, 'gc-lvl ' + (z.L.kind === 'r' ? 'gc-r' : 'gc-s')));
      z.ly = Math.min(H1 - 4, Math.max(z.y - 4, prevY + 13, 12)); prevY = z.ly;
    });
    // mumlar
    var bodyW = Math.max(1, Math.min(9, bw * 0.66));
    bars.forEach(function (b, i) {
      var up = b.c >= b.o, x = X(i), cls = up ? 'gc-up' : 'gc-dn';
      svg.appendChild(s('line', { x1: x, x2: x, y1: Y(b.h), y2: Y(b.l) }, 'gc-wick ' + cls));
      var y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
      svg.appendChild(s('rect', { x: x - bodyW / 2, y: y1, width: bodyW, height: Math.max(1, y2 - y1) }, 'gc-body ' + cls));
    });
    // ortalamalar
    function path(arr, y, cls) {
      var d = '', pen = false;
      for (var i = 0; i < n; i++) {
        if (!isNum(arr[i])) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + y(arr[i]).toFixed(1); pen = true;
      }
      if (d) svg.appendChild(s('path', { d: d }, cls));
    }
    path(S20, Y, 'gc-ma gc-ma20'); path(S50, Y, 'gc-ma gc-ma50'); path(S200, Y, 'gc-ma gc-ma200');
    // seviye etiketleri mumların üstünde okunur kalsın
    vis.forEach(function (z) {
      var t = s('text', { x: padL + 4, y: z.ly }, 'gc-lvl-t ' + (z.L.kind === 'r' ? 'gc-r-t' : 'gc-s-t'));
      t.textContent = z.L.label + ' ' + num(z.L.v, dp); svg.appendChild(t);
    });
    // son fiyat etiketi
    var ly = Y(last.c);
    svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: ly, y2: ly }, 'gc-last'));
    svg.appendChild(s('rect', { x: W - padR + 1, y: ly - 9, width: padR - 2, height: 18, rx: 4 }, 'gc-last-bg'));
    var lt = s('text', { x: W - padR + 4, y: ly + 4 }, 'gc-last-t'); lt.textContent = num(last.c, dp); svg.appendChild(lt);

    // RSI paneli
    var r0 = H1 + gap;
    function YR(v) { return r0 + 4 + (100 - v) / 100 * (H2 - 8); }
    svg.appendChild(s('rect', { x: padL, y: r0, width: cw, height: H2 }, 'gc-panel'));
    [30, 50, 70].forEach(function (lv) {
      svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: YR(lv), y2: YR(lv) }, lv === 50 ? 'gc-grid' : 'gc-rsi-band'));
      var t = s('text', { x: W - padR + 4, y: YR(lv) + 4 }, 'gc-ax'); t.textContent = lv; svg.appendChild(t);
    });
    path(RSI, YR, 'gc-rsi');
    var rl = s('text', { x: padL + 4, y: r0 + 13 }, 'gc-lbl'); rl.textContent = 'RSI 14 · ' + num(RSI[n - 1], 0); svg.appendChild(rl);

    // MACD paneli
    var m0 = r0 + H2 + gap, mlo = 0, mhi = 0;
    for (i = 0; i < n; i++) [MACD[i], SIG[i], HIST[i]].forEach(function (x) { if (isNum(x)) { mlo = Math.min(mlo, x); mhi = Math.max(mhi, x); } });
    var mr = (mhi - mlo) || 1;
    function YM(v) { return m0 + 4 + (mhi - v) / mr * (H3 - 8); }
    svg.appendChild(s('rect', { x: padL, y: m0, width: cw, height: H3 }, 'gc-panel'));
    svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: YM(0), y2: YM(0) }, 'gc-grid'));
    var hw = Math.max(1, bw * 0.6);
    for (i = 0; i < n; i++) {
      if (!isNum(HIST[i])) continue;
      var a = YM(Math.max(0, HIST[i])), bb = YM(Math.min(0, HIST[i]));
      svg.appendChild(s('rect', { x: X(i) - hw / 2, y: a, width: hw, height: Math.max(0.5, bb - a) }, 'gc-hist ' + (HIST[i] >= 0 ? 'gc-up' : 'gc-dn')));
    }
    path(MACD, YM, 'gc-macd'); path(SIG, YM, 'gc-sig');
    var mlbl = s('text', { x: padL + 4, y: m0 + 13 }, 'gc-lbl'); mlbl.textContent = 'MACD (12, 26, 9)'; svg.appendChild(mlbl);

    // tarih ekseni
    var ticks = Math.max(3, Math.min(5, Math.floor(cw / 80)));
    for (var k = 0; k <= ticks; k++) {
      var idx = Math.round((n - 1) * k / ticks), t = s('text', { x: Math.min(W - padR - 2, Math.max(padL + 2, X(idx))), y: Ht - 4, 'text-anchor': k === 0 ? 'start' : (k === ticks ? 'end' : 'middle') }, 'gc-ax');
      t.textContent = dateLabel(bars[idx].t, o.tf); svg.appendChild(t);
    }

    // dokununca değerler
    var cross = s('line', { x1: 0, x2: 0, y1: 0, y2: Ht - xlab }, 'gc-cross'); cross.style.display = 'none'; svg.appendChild(cross);
    var hit = s('rect', { x: padL, y: 0, width: cw, height: Ht - xlab, fill: 'transparent' }); svg.appendChild(hit);
    var info = document.createElement('div'); info.className = 'gc-info';
    function showAt(clientX) {
      var r = svg.getBoundingClientRect(), xx = (clientX - r.left) * (W / r.width);
      var i = Math.max(0, Math.min(n - 1, Math.floor((xx - padL) / bw))), b = bars[i];
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.style.display = '';
      info.textContent = dateLabel(b.t, o.tf, true) + ' · A ' + num(b.o, dp) + ' · Y ' + num(b.h, dp) + ' · D ' + num(b.l, dp) + ' · K ' + num(b.c, dp) +
        ' · RSI ' + num(RSI[i], 0) + ' · MACD ' + num(MACD[i], dp > 2 ? dp : 2);
    }
    function resetInfo() {
      cross.style.display = 'none';
      info.textContent = 'Son: ' + dateLabel(last.t, o.tf, true) + ' · K ' + num(last.c, dp) + (o.unit ? ' ' + o.unit : '') + ' · grafiğe dokunarak gün/saat değerlerini görün';
    }
    hit.addEventListener('pointerdown', function (e) { showAt(e.clientX); });
    hit.addEventListener('pointermove', function (e) { if (e.buttons || e.pointerType === 'touch') showAt(e.clientX); });
    resetInfo();

    var P20 = periodOf(all, 20, o.tf), P50 = periodOf(all, 50, o.tf), P200 = periodOf(all, 200, o.tf);
    var legend = document.createElement('div'); legend.className = 'gc-legend';
    [['gc-k-ma20', 'SMA 20 (' + P20.txt + ')'], ['gc-k-ma50', 'SMA 50 (' + P50.txt + ')'], ['gc-k-ma200', 'SMA 200 (' + P200.txt + ')'],
      ['gc-k-band', 'Bollinger (20, 2)'], ['gc-k-s', 'destek'], ['gc-k-r', 'direnç']].forEach(function (x) {
      var sp = document.createElement('span'); var sw = document.createElement('i'); sw.className = x[0]; sp.appendChild(sw); sp.appendChild(document.createTextNode(x[1])); legend.appendChild(sp);
    });
    box.appendChild(info); box.appendChild(svg); box.appendChild(legend);
    box.setAttribute('data-span-label', SPAN_LABEL[o.tf][o.span == null ? 1 : o.span]);

    // yorum için son mumun göstergeleri (seçili zaman diliminde)
    var L = all.length - 1;
    return {
      tf: o.tf, t: all[L].t, c: all[L].c, first: bars[0].c, firstT: bars[0].t, hiV: Math.max.apply(null, bars.map(function (b) { return b.h; })),
      loV: Math.min.apply(null, bars.map(function (b) { return b.l; })), spanLabel: SPAN_LABEL[o.tf][o.span == null ? 1 : o.span],
      sma20: ind.sma20[L], sma50: ind.sma50[L], sma200: ind.sma200[L], rsi: ind.rsi[L], rsiPrev: ind.rsi[L - 1],
      macd: ind.macd[L], sig: ind.sig[L], hist: ind.hist[L], histPrev: ind.hist[L - 1], bbU: ind.bb.u[L], bbL: ind.bb.l[L],
      per: { 20: P20, 50: P50, 200: P200 }
    };
  }

  window.GMICHART = { render: render, SPAN_LABEL: SPAN_LABEL, periodOf: periodOf };
})();
