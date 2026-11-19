/* GMI teknik grafik: mum grafiği, hareketli ortalamalar, Bollinger bandı, destek/direnç çizgileri, RSI ve MACD panelleri;
   katmanlar: tüm destek/direnç bölgeleri, trend çizgileri, formasyonlar (hedef ve bozulma seviyesiyle), Fibonacci,
   mum formasyonları, uyumsuzluklar ve günlük grafikte sağda 20 günlük olasılık konisi.
   Kullanım: GMICHART.render(kutu, { daily, hourly, tf: 'G'|'4S'|'1S', span: 0|1|2, dp, unit, name, levels: [{ v, label, kind: 's'|'r' }],
     katman: { sr, trend, form, fib, mum, koni }, kalib: GMITAHMIN.test sonucu (koni ayarı), gorunum, onView, yukseklik, tamEkran, tamMi })
   Yakınlaştırma: iki parmak, −/+ düğmeleri; kaydırma: tek parmak yatay; çift dokunma ya da ⟲: sıfırla.
   Dönüş: son mumun göstergeleri, görünen aralığın özeti, formasyon analizi (form) ve koni (koni) ya da veri yoksa null. */
(function () {
  'use strict';
  var NUMARA = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
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

  // Analiz önbelleği: yakınlaştırma ve kaydırma sırasında göstergeler, formasyonlar ve koni yeniden hesaplanmaz
  var ONB = { key: null };
  function hazirla(o) {
    var all = seriesFor(o);
    if (!all || all.length < 30) return { all: all };
    var L = all.length - 1, k = o.kalib && o.kalib.h5 && o.kalib.h20 ? [o.kalib.h5.k80, o.kalib.h5.k50, o.kalib.h20.k80, o.kalib.h20.k50].join('/') : '-';
    var key = [o.name || '', o.tf, all.length, all[0].t, all[L].t, all[L].c, k].join('|');
    if (ONB.key === key) return ONB;
    ONB = { key: key, all: all, ind: indicators(all), form: window.GMIFORM ? window.GMIFORM.analyze(all) : null,
      koni: o.tf === 'G' && window.GMITAHMIN ? window.GMITAHMIN.koni(all, { H: 20, kal: o.kalib }) : null };
    return ONB;
  }
  // görünen sürenin kısa adı (hazır aralık dışında yakınlaştırılınca)
  function sureAd(bars) {
    var d = (bars[bars.length - 1].t - bars[0].t) / 86400;
    if (d >= 330) return '≈' + num(d / 365.25, 1) + ' yıl';
    if (d >= 45) return '≈' + Math.round(d / 30.44) + ' ay';
    if (d >= 14) return '≈' + Math.round(d / 7) + ' hafta';
    return '≈' + Math.max(1, Math.round(d)) + ' gün';
  }
  function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  /* o.gorunum: { n: görünen mum sayısı, geri: en son mumdan kaç mum geride bitiyor } (yoksa hazır aralık)
     o.onView(gorunum|null, ozet): yakınlaştırma/kaydırma bitince
     o.yukseklik: tam ekranda toplam çizim yüksekliği; o.tamEkran: tam ekran düğmesinin işlevi, o.tamMi */
  function render(box, o) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var tools = o.araclar || null;   // araç düğmeleri uygulamanın verdiği kutuya (tam ekranda üst satıra) yerleşebilir
    if (tools) while (tools.firstChild) tools.removeChild(tools.firstChild);
    var PR = hazirla(o), all = PR.all;
    if (!all || all.length < 30) {
      box.appendChild(h('p', 'sub', o.tf === 'G' ? 'Grafik için yeterli günlük veri yok.' : 'Bu varlık için saatlik veri yok; günlük grafiğe bakın.'));
      return null;
    }
    var ind = PR.ind, FORM = PR.form, KONI = PR.koni, KAT = o.katman || {}, dp = o.dp == null ? 2 : o.dp;
    var L = all.length - 1, hazir = SPANS[o.tf][o.span == null ? 1 : o.span];
    var NMIN = Math.min(20, all.length), NMAX = Math.min(all.length, 600);
    var G0 = o.gorunum || null, view = { n: G0 && G0.n ? G0.n : hazir, geri: G0 && G0.geri ? G0.geri : 0 };
    function sinirla() {
      view.n = Math.round(Math.max(NMIN, Math.min(NMAX, view.n)));
      view.geri = Math.round(Math.max(0, Math.min(L - (view.n - 1), view.geri)));
    }
    sinirla();

    var W = Math.max(300, Math.round(box.clientWidth || 340));
    var padL = 4, padR = 56, gap = 12, xlab = 18, H1, H2 = 64, H3 = 74;
    if (o.yukseklik) {
      var Hall = Math.max(180, Math.round(o.yukseklik));
      if (Hall < 400) { H2 = 0; H3 = 0; } else if (Hall < 560) { H2 = 50; H3 = 0; }
      H1 = Hall - xlab - (H2 ? gap + H2 : 0) - (H3 ? gap + H3 : 0);
    } else H1 = Math.max(220, Math.min(380, Math.round(W * 0.66)));
    var Ht = H1 + (H2 ? gap + H2 : 0) + (H3 ? gap + H3 : 0) + xlab;
    var cw = W - padL - padR;
    var P20 = periodOf(all, 20, o.tf), P50 = periodOf(all, 50, o.tf), P200 = periodOf(all, 200, o.tf);

    // kalıcı parçalar: araç çubuğu, bilgi satırı, çizim alanı (dokunmalar burada yakalanır), formasyon listesi, lejant
    if (!tools) { tools = h('div', 'gc-tools'); box.appendChild(tools); }
    var info = h('div', 'gc-info'), wrap = h('div', 'gc-wrap');
    function dugme(txt, ad, fn, cls) {
      var b = h('button', 'gc-btn' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; b.title = ad; b.setAttribute('aria-label', ad);
      b.addEventListener('click', fn); return b;
    }
    tools.appendChild(dugme('−', 'Uzaklaştır', function () { yakinlas(1.5); }));
    tools.appendChild(dugme('+', 'Yakınlaştır', function () { yakinlas(1 / 1.5); }));
    tools.appendChild(dugme('⟲', 'Sıfırla: bugüne ve hazır aralığa dön', sifirla));
    if (o.tamEkran) tools.appendChild(dugme(o.tamMi ? '✕ Çık' : '⛶ Tam ekran', o.tamMi ? 'Tam ekrandan çık' : 'Grafiği tam ekranda ve yatay aç', o.tamEkran, 'gc-btn-tam'));
    tools.appendChild(h('span', 'gc-ipucu', 'İki parmakla büyüt/küçült · sağa kaydır: geçmiş · çift dokun: sıfırla'));
    box.appendChild(info); box.appendChild(wrap);

    var D = null, sonOzet = null;
    function ozet(bars, sonda) {
      var son = bars[bars.length - 1], hazirMi = sonda && view.n === hazir;
      return {
        tf: o.tf, t: all[L].t, c: all[L].c, first: bars[0].c, firstT: bars[0].t, gc: son.c, gT: son.t, sonda: sonda,
        hiV: Math.max.apply(null, bars.map(function (b) { return b.h; })), loV: Math.min.apply(null, bars.map(function (b) { return b.l; })),
        spanLabel: hazirMi ? SPAN_LABEL[o.tf][o.span == null ? 1 : o.span] : (sonda ? 'son ' + sureAd(bars) : dateLabel(bars[0].t, o.tf, true) + ' – ' + dateLabel(son.t, o.tf, true)),
        sma20: ind.sma20[L], sma50: ind.sma50[L], sma200: ind.sma200[L], rsi: ind.rsi[L], rsiPrev: ind.rsi[L - 1],
        macd: ind.macd[L], sig: ind.sig[L], hist: ind.hist[L], histPrev: ind.hist[L - 1], bbU: ind.bb.u[L], bbL: ind.bb.l[L],
        per: { 20: P20, 50: P50, 200: P200 }, form: FORM, koni: KONI, seri: all, gorunum: hazirMi ? null : { n: view.n, geri: view.geri }
      };
    }

    function ciz() {
      var end = L - view.geri, n = view.n, start = end - n + 1, sonda = view.geri === 0;
      var bars = all.slice(start, end + 1);
      function cut(a) { return a.slice(start, end + 1); }
      var S20 = cut(ind.sma20), S50 = cut(ind.sma50), S200 = cut(ind.sma200), BU = cut(ind.bb.u), BL = cut(ind.bb.l);
      var RSI = cut(ind.rsi), MACD = cut(ind.macd), SIG = cut(ind.sig), HIST = cut(ind.hist);
      var FUT = KONI && KAT.koni !== false && sonda ? 20 : 0;
      // gelecek alanı en az çizim genişliğinin %18'i: uzun aralıklarda 20 gün birkaç piksele sıkışmasın (zaman ölçeği orada ayrıdır)
      var fw = FUT ? Math.max(cw * FUT / (n + FUT), cw * 0.18) : 0, bw = (cw - fw) / n, fdw = FUT ? fw / FUT : bw;
      var xFut = padL + n * bw;
      function X(i) { return i < n ? padL + (i + 0.5) * bw : xFut + (i - n + 0.5) * fdw; }
      function XA(a) { return X(a - start); }   // tüm serideki mum sırasından x

      // fiyat ekseni: mumlar + bantlar; yakın seviyeler de sığsın
      var lo = Infinity, hi = -Infinity;
      bars.forEach(function (b, i) {
        lo = Math.min(lo, b.l); hi = Math.max(hi, b.h);
        if (isNum(BL[i])) lo = Math.min(lo, BL[i]);
        if (isNum(BU[i])) hi = Math.max(hi, BU[i]);
      });
      var rng = hi - lo || Math.abs(hi) * 0.01 || 1;
      var ekle = (o.levels || []).map(function (Lv) { return Lv.v; });
      if (FUT) KONI.son.forEach(function (z) { if (z) ekle.push(z.q10, z.q90); });
      if (FORM && KAT.form !== false && sonda) FORM.formasyonlar.forEach(function (pt) { ekle.push(pt.hedef, pt.stop); if (pt.yukari) ekle.push(pt.yukari.hedef, pt.asagi.hedef); });
      ekle.forEach(function (v) { if (isNum(v) && v > lo - rng * 0.35 && v < hi + rng * 0.35) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      rng = hi - lo || rng; lo -= rng * 0.04; hi += rng * 0.04;
      function Y(v) { return 6 + (hi - v) / (hi - lo) * (H1 - 12); }

      var last = bars[n - 1];
      var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + Ht, width: '100%', height: Ht, role: 'img',
        'aria-label': (o.name || '') + ' grafiği; ' + (sonda ? 'son fiyat ' : 'görünen son kapanış ') + num(last.c, dp) + (o.unit ? ' ' + o.unit : '') }, 'gc');

      // yatay ızgara ve sağ eksen
      for (var g = 0; g <= 4; g++) {
        var v = lo + (hi - lo) * g / 4, yy = Y(v);
        svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy }, 'gc-grid'));
        var tx = s('text', { x: W - padR + 4, y: yy + 4 }, 'gc-ax'); tx.textContent = num(v, dp); svg.appendChild(tx);
      }
      // gelecek alanı
      if (FUT) {
        svg.appendChild(s('rect', { x: xFut, y: 0, width: W - padR - xFut, height: H1 }, 'gc-fut'));
        var ft = s('text', { x: xFut + 3, y: H1 - 5 }, 'gc-fut-t'); ft.textContent = 'gelecek'; svg.appendChild(ft);
      }
      function yIn(v) { return isNum(v) && v >= lo && v <= hi; }
      function clampY(v) { return Y(Math.max(lo, Math.min(hi, v))); }
      // destek/direnç bölgeleri: çok sınanmış olanlar ve fiyata en yakın destek ile direnç
      var yakinS = null, yakinR = null;
      if (FORM) FORM.bolgeler.forEach(function (z) {
        if (z.tur === 's' && (!yakinS || z.mid > yakinS.mid)) yakinS = z;
        if (z.tur === 'r' && (!yakinR || z.mid < yakinR.mid)) yakinR = z;
      });
      if (FORM && KAT.sr !== false) FORM.bolgeler.forEach(function (z) {
        if (z.hi < lo || z.lo > hi) return;
        if (z.n < 2 && z !== yakinS && z !== yakinR && z.tur !== 'k') return;
        var y1 = clampY(z.hi), y2 = clampY(z.lo);
        svg.appendChild(s('rect', { x: padL, y: y1, width: W - padR - padL, height: Math.max(1.5, y2 - y1) }, 'gc-zone gc-zone-' + z.tur + ' gc-zone-g' + z.guc));
      });
      // Bollinger bandı
      var bandTop = [], bandBot = [], i;
      for (i = 0; i < n; i++) if (isNum(BU[i]) && isNum(BL[i])) { bandTop.push(X(i).toFixed(1) + ',' + Y(BU[i]).toFixed(1)); bandBot.unshift(X(i).toFixed(1) + ',' + Y(BL[i]).toFixed(1)); }
      if (bandTop.length > 1) svg.appendChild(s('polygon', { points: bandTop.concat(bandBot).join(' ') }, 'gc-band'));
      // seviyeler
      var vis = (o.levels || []).filter(function (Lv) { return isNum(Lv.v) && Lv.v >= lo && Lv.v <= hi; }).map(function (Lv) { return { L: Lv, y: Y(Lv.v) }; })
        .sort(function (a, b) { return a.y - b.y; });
      var prevY = -Infinity;
      vis.forEach(function (z) {
        svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: z.y, y2: z.y }, 'gc-lvl ' + (z.L.kind === 'r' ? 'gc-r' : 'gc-s')));
        z.ly = Math.min(H1 - 4, Math.max(z.y - 4, prevY + 13, 12)); prevY = z.ly;
      });
      // olasılık konisi
      if (FUT) {
        var cx0 = X(n - 1), cy0 = Y(last.c);
        var band = function (a, z, cls) {
          var top = [cx0.toFixed(1) + ',' + cy0.toFixed(1)], bot = [];
          KONI.son.forEach(function (q, k) { if (!q) return; var xx = X(n + k).toFixed(1); top.push(xx + ',' + clampY(q[z]).toFixed(1)); bot.unshift(xx + ',' + clampY(q[a]).toFixed(1)); });
          svg.appendChild(s('polygon', { points: top.concat(bot).join(' ') }, cls));
        };
        band('q10', 'q90', 'gc-koni80'); band('q25', 'q75', 'gc-koni50');
        var md2 = 'M' + cx0.toFixed(1) + ' ' + cy0.toFixed(1);
        KONI.son.forEach(function (q, k) { if (q) md2 += 'L' + X(n + k).toFixed(1) + ' ' + clampY(q.q50).toFixed(1); });
        svg.appendChild(s('path', { d: md2 }, 'gc-koni-m'));
      }
      // Fibonacci
      if (FORM && FORM.fib && KAT.fib && Math.min(FORM.fib.i1, FORM.fib.i2) <= end) {
        var F = FORM.fib, fx0 = Math.max(padL, XA(Math.min(F.i1, F.i2)));
        F.seviye.forEach(function (lv) {
          if (!yIn(lv.v)) return;
          svg.appendChild(s('line', { x1: fx0, x2: W - padR, y1: Y(lv.v), y2: Y(lv.v) }, 'gc-fib'));
          var t = s('text', { x: xFut - 3, y: Y(lv.v) - 2, 'text-anchor': 'end' }, 'gc-fib-t');
          t.textContent = '%' + num(lv.k * 100, lv.k === 0.5 ? 0 : 1); svg.appendChild(t);
        });
      }
      // uzatılmış çizgi: a1→a2 doğrusu, görünür pencereye kırpılmış, istenirse geleceğe uzatılır
      // gelecek alanında zaman ölçeği farklı olduğundan çizgi son mumda kırılarak devam eder
      function cizgi(i1, p1, i2, p2, cls, uzat) {
        var m = (p2 - p1) / ((i2 - i1) || 1), a0 = Math.max(i1, start), aL = end, a1 = uzat ? aL + FUT : Math.min(i2, aL);
        if (a1 < start || a0 > a1) return;
        var v0 = p1 + m * (a0 - i1), v1 = p1 + m * (a1 - i1);
        if ((v0 < lo && v1 < lo) || (v0 > hi && v1 > hi)) return;
        var d = 'M' + XA(a0).toFixed(1) + ' ' + clampY(v0).toFixed(1);
        if (a1 > aL && a0 < aL) d += 'L' + XA(aL).toFixed(1) + ' ' + clampY(p1 + m * (aL - i1)).toFixed(1);
        d += 'L' + XA(a1).toFixed(1) + ' ' + clampY(v1).toFixed(1);
        svg.appendChild(s('path', { d: d }, cls));
      }
      // trend çizgileri
      if (FORM && KAT.trend !== false) {
        [FORM.trend.yukari, FORM.trend.asagi].forEach(function (T) {
          if (!T) return;
          cizgi(T.i1, T.p1, T.i2, T.p2, 'gc-tl ' + (T.tur === 'L' ? 'gc-tl-s' : 'gc-tl-r') + (T.kirildi != null ? ' gc-tl-kir' : ''), true);
        });
      }
      // formasyonlar: çizgiler, nokta adları, numara; hedef ve bozulma seviyeleri (yalnız bugünü gösterirken) sağ eksende etiket
      var etiket = [];
      if (FORM && KAT.form !== false) {
        FORM.formasyonlar.forEach(function (pt, k) {
          if (pt.bas > end) return;
          var bit = pt.durum === 'bozuldu' || pt.durum === 'hedefe ulaştı';
          pt.cizgiler.forEach(function (c) {
            cizgi(c.i1, c.p1, c.i2, c.p2, 'gc-pf gc-pf-' + c.tur + (bit ? ' gc-pf-bitti' : ''), c.tur === 'boyun' || c.tur === 'ust' || c.tur === 'alt' ? !bit : false);
          });
          pt.noktalar.forEach(function (q) {
            if (q.i < start || q.i > end || !q.e) return;
            var t = s('text', { x: XA(q.i), y: clampY(q.p) + (q.p >= (pt.d > 0 ? pt.stop : pt.hedef) ? -6 : 13), 'text-anchor': 'middle' }, 'gc-pf-t'); t.textContent = q.e; svg.appendChild(t);
          });
          // numara: formasyonun en yüksek noktasının üstünde (sığmazsa en düşüğün altında)
          var pmax = -Infinity, pmin = Infinity, ib = Math.max(pt.bas, start);
          pt.noktalar.forEach(function (q) { pmax = Math.max(pmax, q.p); pmin = Math.min(pmin, q.p); });
          var ny = clampY(pmax) - 16;
          if (ny < 10) ny = clampY(pmin) + 16;
          svg.appendChild(s('circle', { cx: XA(ib), cy: ny, r: 7.5 }, 'gc-pf-no ' + (bit ? 'gc-pf-bitti' : '')));
          var nt = s('text', { x: XA(ib), y: ny + 3.5, 'text-anchor': 'middle' }, 'gc-pf-no-t'); nt.textContent = String(k + 1); svg.appendChild(nt);
          if (bit || !sonda) return;
          var xh = pt.onay != null ? XA(pt.onay) : X(n - 1);
          var hedefCiz = function (v, tur) {
            if (!isNum(v)) return;
            var yy2 = clampY(v);
            svg.appendChild(s('line', { x1: xh, x2: W - padR, y1: yy2, y2: yy2 }, 'gc-pf-' + tur));
            etiket.push({ y: yy2, v: v, tur: tur, dis: v > hi ? 1 : (v < lo ? -1 : 0) });
          };
          if (pt.yukari) { hedefCiz(pt.yukari.hedef, 'hedef'); hedefCiz(pt.asagi.hedef, 'hedef'); }
          else { hedefCiz(pt.hedef, 'hedef'); hedefCiz(pt.stop, 'stop'); }
        });
        // uyumsuzluk: fiyat üzerinde iki tepe/dip arasında kesik çizgi
        FORM.uyumsuzluk.forEach(function (d) {
          if (d.i1 < start || d.i2 > end) return;
          svg.appendChild(s('line', { x1: XA(d.i1), y1: clampY(d.p1), x2: XA(d.i2), y2: clampY(d.p2) }, 'gc-uy ' + (d.tur === 'pozitif' ? 'gc-uy-p' : 'gc-uy-n')));
        });
      }
      // mumlar
      var bodyW = Math.max(1, Math.min(16, bw * 0.7));
      bars.forEach(function (b, j) {
        var up = b.c >= b.o, x = X(j), cls = up ? 'gc-up' : 'gc-dn';
        svg.appendChild(s('line', { x1: x, x2: x, y1: Y(b.h), y2: Y(b.l) }, 'gc-wick ' + cls));
        var y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
        svg.appendChild(s('rect', { x: x - bodyW / 2, y: y1, width: bodyW, height: Math.max(1, y2 - y1) }, 'gc-body ' + cls));
      });
      // mum formasyonu işaretleri
      var mumAd = {};
      if (FORM && KAT.mum !== false) FORM.mumlar.forEach(function (m) {
        if (m.i < start || m.i > end) return;
        var bb = all[m.i], ust = m.yon < 0 || (m.yon === 0 && bb.c >= bb.o), y = ust ? Y(bb.h) - 5 : Y(bb.l) + 11;
        var t = s('text', { x: XA(m.i), y: y, 'text-anchor': 'middle' }, 'gc-mum ' + (m.yon > 0 ? 'gc-mum-up' : (m.yon < 0 ? 'gc-mum-dn' : 'gc-mum-n')));
        t.textContent = m.yon > 0 ? '▲' : (m.yon < 0 ? '▼' : '◆'); svg.appendChild(t);
        mumAd[m.i - start] = m.ad;
      });
      // ortalamalar
      function path(arr, y, cls) {
        var d = '', pen = false;
        for (var j = 0; j < n; j++) {
          if (!isNum(arr[j])) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + X(j).toFixed(1) + ' ' + y(arr[j]).toFixed(1); pen = true;
        }
        if (d) svg.appendChild(s('path', { d: d }, cls));
      }
      path(S20, Y, 'gc-ma gc-ma20'); path(S50, Y, 'gc-ma gc-ma50'); path(S200, Y, 'gc-ma gc-ma200');
      // seviye etiketleri mumların üstünde okunur kalsın
      vis.forEach(function (z) {
        var t = s('text', { x: padL + 4, y: z.ly }, 'gc-lvl-t ' + (z.L.kind === 'r' ? 'gc-r-t' : 'gc-s-t'));
        t.textContent = z.L.label + ' ' + num(z.L.v, dp); svg.appendChild(t);
      });
      // son fiyat etiketi (yalnız bugünü gösterirken)
      var dolu = [];
      if (sonda) {
        var ly = Y(last.c);
        svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: ly, y2: ly }, 'gc-last'));
        svg.appendChild(s('rect', { x: W - padR + 1, y: ly - 9, width: padR - 2, height: 18, rx: 4 }, 'gc-last-bg'));
        var lt = s('text', { x: W - padR + 4, y: ly + 4 }, 'gc-last-t'); lt.textContent = num(last.c, dp); svg.appendChild(lt);
        dolu.push(ly);
      }
      // hedef/bozulma etiketleri: sağ eksende, birbirinin ve son fiyat etiketinin üstüne binmeden
      etiket.sort(function (a, z) { return a.y - z.y; });
      etiket.forEach(function (e) {
        var ty = Math.max(8, Math.min(H1 - 8, e.y)), dene = 0, yon = dolu.length && e.y < dolu[0] ? -1 : 1;
        while (dene++ < 40 && dolu.some(function (u) { return Math.abs(u - ty) < 16; })) ty += yon * 4;
        ty = Math.max(8, Math.min(H1 - 8, ty)); dolu.push(ty);
        svg.appendChild(s('rect', { x: W - padR + 1, y: ty - 8, width: padR - 2, height: 16, rx: 3 }, 'gc-tag gc-tag-' + e.tur));
        var tt = s('text', { x: W - padR + 4, y: ty + 3.5 }, 'gc-tag-t'); tt.textContent = (e.dis > 0 ? '↑' : (e.dis < 0 ? '↓' : '')) + num(e.v, dp); svg.appendChild(tt);
      });

      // RSI paneli
      var r0 = H1 + gap;
      if (H2) {
        var YR = function (v) { return r0 + 4 + (100 - v) / 100 * (H2 - 8); };
        svg.appendChild(s('rect', { x: padL, y: r0, width: cw, height: H2 }, 'gc-panel'));
        [30, 50, 70].forEach(function (lv) {
          svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: YR(lv), y2: YR(lv) }, lv === 50 ? 'gc-grid' : 'gc-rsi-band'));
          var t = s('text', { x: W - padR + 4, y: YR(lv) + 4 }, 'gc-ax'); t.textContent = lv; svg.appendChild(t);
        });
        path(RSI, YR, 'gc-rsi');
        if (FORM && KAT.form !== false) FORM.uyumsuzluk.forEach(function (d) {
          if (d.gosterge !== 'RSI' || d.i1 < start || d.i2 > end) return;
          svg.appendChild(s('line', { x1: XA(d.i1), y1: YR(d.v1), x2: XA(d.i2), y2: YR(d.v2) }, 'gc-uy ' + (d.tur === 'pozitif' ? 'gc-uy-p' : 'gc-uy-n')));
        });
        var rl = s('text', { x: padL + 4, y: r0 + 13 }, 'gc-lbl'); rl.textContent = 'RSI 14 · ' + num(RSI[n - 1], 0); svg.appendChild(rl);
      }

      // MACD paneli
      if (H3) {
        var m0 = (H2 ? r0 + H2 + gap : r0), mlo = 0, mhi = 0;
        for (i = 0; i < n; i++) [MACD[i], SIG[i], HIST[i]].forEach(function (x) { if (isNum(x)) { mlo = Math.min(mlo, x); mhi = Math.max(mhi, x); } });
        var mr = (mhi - mlo) || 1;
        var YM = function (v) { return m0 + 4 + (mhi - v) / mr * (H3 - 8); };
        svg.appendChild(s('rect', { x: padL, y: m0, width: cw, height: H3 }, 'gc-panel'));
        svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: YM(0), y2: YM(0) }, 'gc-grid'));
        var hw = Math.max(1, Math.min(14, bw * 0.6));
        for (i = 0; i < n; i++) {
          if (!isNum(HIST[i])) continue;
          var a = YM(Math.max(0, HIST[i])), bb2 = YM(Math.min(0, HIST[i]));
          svg.appendChild(s('rect', { x: X(i) - hw / 2, y: a, width: hw, height: Math.max(0.5, bb2 - a) }, 'gc-hist ' + (HIST[i] >= 0 ? 'gc-up' : 'gc-dn')));
        }
        path(MACD, YM, 'gc-macd'); path(SIG, YM, 'gc-sig');
        var mlbl = s('text', { x: padL + 4, y: m0 + 13 }, 'gc-lbl'); mlbl.textContent = 'MACD (12, 26, 9)'; svg.appendChild(mlbl);
      }

      // tarih ekseni
      var ticks = Math.max(3, Math.min(Math.max(3, Math.floor(W / 160)), Math.floor((xFut - padL) / 80)));
      for (var k = 0; k <= ticks; k++) {
        var idx = Math.round((n - 1) * k / ticks), t = s('text', { x: Math.min(W - padR - 2, Math.max(padL + 2, X(idx) + (k === ticks && FUT ? bw / 2 : 0))), y: Ht - 4, 'text-anchor': k === 0 ? 'start' : (k === ticks ? 'end' : 'middle') }, 'gc-ax');
        t.textContent = dateLabel(bars[idx].t, o.tf); svg.appendChild(t);
      }
      if (FUT) { var tf2 = s('text', { x: W - padR - 2, y: Ht - 4, 'text-anchor': 'end' }, 'gc-ax'); tf2.textContent = '+20 gün'; svg.appendChild(tf2); }

      // dokununca değerler için dikey çizgi
      var cross = s('line', { x1: 0, x2: 0, y1: 0, y2: Ht - xlab }, 'gc-cross'); cross.style.display = 'none'; svg.appendChild(cross);
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(svg);
      D = { svg: svg, X: X, n: n, FUT: FUT, xFut: xFut, bw: bw, fdw: fdw, bars: bars, RSI: RSI, MACD: MACD, mumAd: mumAd, cross: cross, sonda: sonda };
      bilgiSifirla();
      sonOzet = ozet(bars, sonda);
      return sonOzet;
    }

    function showAt(clientX) {
      if (!D) return;
      var r = D.svg.getBoundingClientRect(), xx = (clientX - r.left) * (W / r.width);
      var i = xx < D.xFut ? Math.floor((xx - padL) / D.bw) : D.n + Math.floor((xx - D.xFut) / D.fdw);
      i = Math.max(0, Math.min(D.n - 1 + D.FUT, i));
      D.cross.setAttribute('x1', D.X(i)); D.cross.setAttribute('x2', D.X(i)); D.cross.style.display = '';
      if (i >= D.n) {
        var q = KONI.son[i - D.n];
        info.textContent = q ? '+' + (i - D.n + 1) + ' işlem günü · %80 olasılıkla ' + num(q.q10, dp) + '–' + num(q.q90, dp) + ' · %50: ' + num(q.q25, dp) + '–' + num(q.q75, dp) + ' · orta ' + num(q.q50, dp) : '';
        return;
      }
      var b = D.bars[i];
      info.textContent = dateLabel(b.t, o.tf, true) + ' · A ' + num(b.o, dp) + ' · Y ' + num(b.h, dp) + ' · D ' + num(b.l, dp) + ' · K ' + num(b.c, dp) +
        (H2 ? ' · RSI ' + num(D.RSI[i], 0) : '') + (H3 ? ' · MACD ' + num(D.MACD[i], dp > 2 ? dp : 2) : '') + (D.mumAd[i] ? ' · ' + D.mumAd[i] : '');
    }
    function bilgiSifirla() {
      if (!D) return;
      D.cross.style.display = 'none';
      var son = D.bars[D.bars.length - 1];
      info.textContent = D.sonda ?
        'Son: ' + dateLabel(son.t, o.tf, true) + ' · K ' + num(son.c, dp) + (o.unit ? ' ' + o.unit : '') + ' · dokun: o günün değerleri' + (D.FUT ? ' · sağdaki mavi alan: gelecek 20 günün olasılık aralığı' : '') :
        'Geçmiş görünüyor: ' + dateLabel(D.bars[0].t, o.tf, true) + ' – ' + dateLabel(son.t, o.tf, true) + ' · bugüne dönmek için ⟲ ya da çift dokun';
    }

    // çizim isteği: kare başına en çok bir kez; hareket bitince uygulamaya bildirilir
    var bekliyor = false, bildirBekle = false;
    function istek(bitti) {
      if (bitti) bildirBekle = true;
      if (bekliyor) return;
      bekliyor = true;
      (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
        bekliyor = false;
        ciz();
        if (bildirBekle) { bildirBekle = false; if (o.onView) o.onView(sonOzet.gorunum, sonOzet); }
      });
    }
    function yakinlas(f) { view.n = Math.round(view.n * f); sinirla(); istek(true); }
    function sifirla() { view.n = hazir; view.geri = 0; sinirla(); istek(true); }

    // dokunma hareketleri: iki parmak büyüt/küçült, tek parmak yatay kaydır, dokun değer, basılı tut ve gezdir, çift dokun sıfırla
    var ptr = {}, jest = null, uzunT = null, sonTik = { t: 0, x: 0 };
    function svgX(clientX) { var r = D.svg.getBoundingClientRect(); return (clientX - r.left) * (W / r.width); }
    function kesir(sx) { return Math.max(0, Math.min(1, (sx - padL) / Math.max(1, D.xFut - padL))); }
    function capa(clientX) { var f = kesir(svgX(clientX)); return { f: f, i: (L - view.geri - view.n + 1) + f * view.n }; }
    wrap.addEventListener('pointerdown', function (e) {
      if (!D || (e.pointerType === 'mouse' && e.button !== 0)) return;
      try { wrap.setPointerCapture(e.pointerId); } catch (x) { /* yok say */ }
      ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptr);
      clearTimeout(uzunT);
      if (ids.length === 1) {
        jest = { tur: 'bekle', x0: e.clientX, y0: e.clientY, geri0: view.geri };
        if (e.pointerType !== 'mouse') uzunT = setTimeout(function () { if (jest && jest.tur === 'bekle') { jest.tur = 'tara'; showAt(jest.x0); } }, 380);
      } else if (ids.length === 2) {
        var a = ptr[ids[0]], b = ptr[ids[1]], c = capa((a.x + b.x) / 2);
        // bugünü gösterirken sağ tarafta yapılan hareket en son mumu sağda tutar; yoksa parmakların arasındaki yer sabit kalır
        jest = { tur: 'sikistir', d0: Math.max(30, Math.hypot(a.x - b.x, a.y - b.y)), n0: view.n, capa: c.i, sag: view.geri === 0 && c.f >= 0.6 };
        bilgiSifirla();
      }
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!D) return;
      var p = ptr[e.pointerId];
      if (!p) { if (e.pointerType === 'mouse' && !e.buttons) showAt(e.clientX); return; }
      p.x = e.clientX; p.y = e.clientY;
      if (!jest) return;
      if (jest.tur === 'sikistir') {
        var ids = Object.keys(ptr); if (ids.length < 2) return;
        var a = ptr[ids[0]], b = ptr[ids[1]], d = Math.max(30, Math.hypot(a.x - b.x, a.y - b.y));
        var yeniN = Math.round(Math.max(NMIN, Math.min(NMAX, jest.n0 * jest.d0 / d))), f = kesir(svgX((a.x + b.x) / 2));
        if (jest.sag) { view.n = yeniN; view.geri = 0; }
        else { var bas = Math.round(jest.capa - f * yeniN); view.n = yeniN; view.geri = L - (bas + yeniN - 1); }
        sinirla(); istek(false);
        if (e.cancelable) e.preventDefault();
        return;
      }
      var dx = e.clientX - jest.x0, dy = e.clientY - jest.y0;
      if (jest.tur === 'bekle') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        clearTimeout(uzunT);
        jest.tur = Math.abs(dx) >= Math.abs(dy) ? 'kaydir' : 'yok';
      }
      if (jest.tur === 'tara') { showAt(e.clientX); return; }
      if (jest.tur === 'kaydir') {
        var r = D.svg.getBoundingClientRect();
        view.geri = Math.round(jest.geri0 + dx * (W / r.width) / D.bw); sinirla(); istek(false);
      }
    });
    function birak(e) {
      if (!ptr[e.pointerId]) return;
      delete ptr[e.pointerId];
      var ids = Object.keys(ptr);
      clearTimeout(uzunT);
      if (!jest) return;
      if (jest.tur === 'sikistir') {
        // bir parmak kaldıysa kaydırmayla devam
        if (ids.length === 1) { var q = ptr[ids[0]]; jest = { tur: 'kaydir', x0: q.x, y0: q.y, geri0: view.geri }; istek(true); }
        else if (!ids.length) { jest = null; istek(true); }
        return;
      }
      if (ids.length) return;
      var j = jest; jest = null;
      if (j.tur === 'kaydir') { istek(true); return; }
      if (j.tur === 'bekle' && e.type === 'pointerup') {
        var simdi = Date.now();
        if (simdi - sonTik.t < 350 && Math.abs(e.clientX - sonTik.x) < 30) { sonTik.t = 0; sifirla(); return; }
        sonTik = { t: simdi, x: e.clientX };
        showAt(e.clientX);
      }
    }
    wrap.addEventListener('pointerup', birak);
    wrap.addEventListener('pointercancel', birak);
    wrap.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !ptr[e.pointerId]) bilgiSifirla(); });
    // bilgisayarda: Ctrl + tekerlek ya da dokunmatik yüzeyde iki parmak
    wrap.addEventListener('wheel', function (e) {
      if (!D || !e.ctrlKey) return;
      e.preventDefault();
      var c = capa(e.clientX), yeniN = Math.round(Math.max(NMIN, Math.min(NMAX, view.n * (e.deltaY > 0 ? 1.15 : 1 / 1.15))));
      var bas = Math.round(c.i - c.f * yeniN); view.n = yeniN; view.geri = L - (bas + yeniN - 1); sinirla(); istek(true);
    }, { passive: false });

    var st = ciz();

    // formasyon listesi ve lejant
    var formEt = FORM && KAT.form !== false ? FORM.formasyonlar : [];
    if (formEt.length) {
      var fl = h('div', 'gc-forms');
      formEt.forEach(function (pt, k) {
        fl.appendChild(h('span', 'gc-form ' + (pt.durum === 'bozuldu' || pt.durum === 'hedefe ulaştı' ? 'gc-form-bitti' : (pt.d > 0 ? 'up' : 'down')), (NUMARA[k] || String(k + 1)) + ' ' + pt.ad + ' · ' + pt.durum));
      });
      box.appendChild(fl);
    }
    var legend = h('div', 'gc-legend');
    var lj = [['gc-k-ma20', 'SMA 20 (' + P20.txt + ')'], ['gc-k-ma50', 'SMA 50 (' + P50.txt + ')'], ['gc-k-ma200', 'SMA 200 (' + P200.txt + ')'],
      ['gc-k-band', 'Bollinger (20, 2)'], ['gc-k-s', 'destek'], ['gc-k-r', 'direnç']];
    if (FORM && KAT.sr !== false) lj.push(['gc-k-zone', 'destek/direnç bölgesi (koyu = çok sınanmış)']);
    if (FORM && KAT.trend !== false && (FORM.trend.yukari || FORM.trend.asagi)) lj.push(['gc-k-tl', 'trend çizgisi']);
    if (formEt.length) lj.push(['gc-k-pf', 'formasyon; sağdaki turuncu etiket hedef, gri etiket bozulma seviyesi']);
    if (KONI && KAT.koni !== false) lj.push(['gc-k-koni', 'olasılık konisi: koyu %50, açık %80']);
    lj.forEach(function (x) {
      var sp = h('span'), sw = h('i', x[0]); sp.appendChild(sw); sp.appendChild(document.createTextNode(x[1])); legend.appendChild(sp);
    });
    box.appendChild(legend);
    return st;
  }

  window.GMICHART = { render: render, SPAN_LABEL: SPAN_LABEL, periodOf: periodOf };
})();
