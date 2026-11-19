/* Gelecek görünümü (olasılık): yön tahmini değil, olası fiyat aralığı.
   - Koni: son ~2 yılın h günlük getirilerinin dağılımı (ortanca + yüzdelikler), bugünkü oynaklığa göre ölçeklenir
     (son 20 günün gerçek aralığı / pencerenin ortalaması; 0,6–1,8 arası). Oynaklığın kümelenmesi ölçülebilen bir olgudur;
     yönün tahmini değildir. Orta çizgi geçmişteki eğilim sürerse nerede olacağını gösterir.
   - Ayar (kalibrasyon): geçmiş testte ham aralık %80 yerine örneğin %70 tuttuysa, aralık bu varlıkta %80 tutacak kadar
     genişletilir (k katsayısı). Bu düzeltmenin dürüst sınaması: her gün yalnız o güne kadar sonucu belli olmuş günlerle
     bulunan katsayıyla aralık kurulur ve tutma oranı ayrıca sayılır (b80k, b50k).
   - Seviyeye değme olasılığı: aynı pencereden, h gün içindeki en yüksek/en düşük fiyatlara göre.
   - Tahmin defteri: uygulama her gün ana varlıklar için aralığı kaydeder, vadesi gelince tutup tutmadığına bakar (Karne).
   GMITAHMIN.koni(bars, {kal}) · .degme(bars, seviye, h) · .test(bars) · .gunluk(liste) · .karne() · .yorum(bars, ctx) */
(function () {
  'use strict';
  var PENCERE = 504, LOG = 'gmi-tahmin-log', MAXLOG = 900;
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function q(sorted, p) {
    var pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function trAt(b, i) { return i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l; }
  // Oynaklık oranı: son 20 mumun ortalama gerçek aralığı (fiyata oranla) / pencerenin ortalaması
  function volOran(b, end, from) {
    var s20 = 0, n20 = 0, sw = 0, nw = 0, i;
    for (i = Math.max(from + 1, 1); i <= end; i++) {
      var r = trAt(b, i) / b[i - 1].c;
      sw += r; nw++;
      if (i > end - 20) { s20 += r; n20++; }
    }
    if (!nw || !n20) return 1;
    var v = (s20 / n20) / (sw / nw);
    return Math.max(0.6, Math.min(1.8, v));
  }
  // h günlük log getiriler (sıralı)
  function getiriler(c, from, end, h) {
    var r = [];
    for (var i = from; i + h <= end; i++) r.push(Math.log(c[i + h] / c[i]));
    return r.sort(function (a, z) { return a - z; });
  }

  // ayar katsayısı: 5 ve 20 gün için bulunan k değerleri arasında doğrusal geçiş
  function kAt(kal, h, ad) {
    if (!kal || !kal.h5 || !kal.h20 || !isNum(kal.h5[ad]) || !isNum(kal.h20[ad])) return 1;
    var a = kal.h5[ad], z = kal.h20[ad], w = Math.max(0, Math.min(1, (h - 5) / 15));
    return a + (z - a) * w;
  }
  function koni(b, opt) {
    opt = opt || {};
    var H = opt.H || 20, end = opt.end != null ? opt.end : b.length - 1, from = Math.max(0, end - PENCERE);
    if (end - from < 150) return null;
    var c = b.map(function (x) { return x.c; }), vr = volOran(b, end, from), px = c[end], son = [], kal = opt.kal;
    for (var h = 1; h <= H; h++) {
      var r = getiriler(c, from, end, h);
      if (r.length < 100) { son.push(null); continue; }
      var med = q(r, 0.5), k80 = kAt(kal, h, 'k80'), k50 = kAt(kal, h, 'k50');
      var d = function (p, k) { return med + (q(r, p) - med) * vr * k; };
      var z = { h: h, q10: px * Math.exp(d(0.1, k80)), q25: px * Math.exp(d(0.25, k50)), q50: px * Math.exp(med), q75: px * Math.exp(d(0.75, k50)), q90: px * Math.exp(d(0.9, k80)) };
      z.q25 = Math.max(z.q25, z.q10); z.q75 = Math.min(z.q75, z.q90);
      son.push(z);
    }
    return { fiyat: px, vr: vr, gun: end - from, son: son, H: H, ayarli: !!(kal && kal.h20 && isNum(kal.h20.k80)) };
  }

  // h gün içinde seviyeye en az bir kez değme olasılığı (geçmiş pencere, oynaklık oranıyla)
  function degme(b, seviye, h, opt) {
    opt = opt || {};
    var end = opt.end != null ? opt.end : b.length - 1, from = Math.max(1, end - PENCERE), px = b[end].c;
    if (!isNum(seviye) || end - from < 150) return null;
    var vr = volOran(b, end, from), hedef = Math.log(seviye / px) / vr, ok = 0, top = 0;
    for (var i = from; i + h <= end; i++) {
      var m = hedef > 0 ? -Infinity : Infinity;
      for (var j = i + 1; j <= i + h; j++) m = hedef > 0 ? Math.max(m, b[j].h) : Math.min(m, b[j].l);
      var x = Math.log(m / b[i].c);
      top++;
      if (hedef > 0 ? x >= hedef : x <= hedef) ok++;
    }
    return top ? ok / top : null;
  }

  // sıralı diziye ekleme
  function ekle(arr, v) { var lo = 0, hi = arr.length; while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } arr.splice(lo, 0, v); }
  // Az veride katsayı 1'e doğru çekilir: örtüşen h günlük pencerelerde bağımsız gözlem sayısı ≈ sayı × adım / h
  function kSinir(k, adet, adim, h) {
    var neff = adet * adim / h, w = neff / (neff + 8);
    return Math.max(0.6, Math.min(2.5, 1 + (k - 1) * w));
  }
  // Geçmiş test: koninin %80 ve %50 aralıkları gerçekten o sıklıkla tuttu mu? Ayar katsayıları ve ayarlı koninin
  // geleceği görmeden (yalnız o güne kadar sonucu belli olmuş günlerle) sınanmış tutma oranı.
  function test(b, opt) {
    opt = opt || {};
    var n = b.length, c = b.map(function (x) { return x.c; }), adim = opt.adim || (n > 1500 ? 3 : 1), out = {}, MIN = 60;
    [5, 20].forEach(function (h) {
      var t80 = 0, t50 = 0, top = 0, yonOk = 0, yonTop = 0, yukari = 0, s80 = [], s50 = [], bekle = [], k80ok = 0, k50ok = 0, kTop = 0;
      for (var t = 260; t + h < n; t += adim) {
        var from = Math.max(0, t - PENCERE), r = getiriler(c, from, t, h);
        if (r.length < 100) continue;
        // vadesi dolmuş skorlar artık bilinir
        while (bekle.length && bekle[0].t <= t) { var e = bekle.shift(); ekle(s80, e.a); ekle(s50, e.b); }
        var vr = volOran(b, t, from), med = q(r, 0.5);
        var u80 = (q(r, 0.9) - med) * vr, a80 = (med - q(r, 0.1)) * vr, u50 = (q(r, 0.75) - med) * vr, a50 = (med - q(r, 0.25)) * vr;
        var x = Math.log(c[t + h] / c[t]), dx = x - med;
        // skor: sapmanın aralığın yarı genişliğine oranı (1 ve altı: aralıkta)
        var sa = dx >= 0 ? dx / (u80 || 1e-12) : -dx / (a80 || 1e-12), sb = dx >= 0 ? dx / (u50 || 1e-12) : -dx / (a50 || 1e-12);
        if (!isNum(sa) || !isNum(sb)) continue;
        top++;
        if (sa <= 1) t80++;
        if (sb <= 1) t50++;
        if (s80.length >= MIN) { kTop++; if (sa <= kSinir(q(s80, 0.8), s80.length, adim, h)) k80ok++; if (sb <= kSinir(q(s50, 0.5), s50.length, adim, h)) k50ok++; }
        bekle.push({ t: t + h, a: sa, b: sb });
        if (x > 0) yukari++;
        if (Math.abs(med) > 1e-9) { yonTop++; if ((med > 0) === (x > 0)) yonOk++; }
      }
      bekle.forEach(function (e) { ekle(s80, e.a); ekle(s50, e.b); });
      out['h' + h] = top ? { n: top, b80: t80 / top, b50: t50 / top, yon: yonTop ? yonOk / yonTop : null, yukariOran: yukari / top,
        k80: s80.length >= MIN ? kSinir(q(s80, 0.8), s80.length, adim, h) : null, k50: s50.length >= MIN ? kSinir(q(s50, 0.5), s50.length, adim, h) : null,
        nk: kTop, b80k: kTop ? k80ok / kTop : null, b50k: kTop ? k50ok / kTop : null } : null;
    });
    out.bas = b.length > 260 ? b[260].t : null; out.son = b[n - 1].t;
    return out;
  }

  /* ---------------- tahmin defteri ---------------- */
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* yok say */ } }
  function gun(t) { return new Date((t + 10800) * 1000).toISOString().slice(0, 10); }

  // liste: [{ key, ad, bars }]. Her varlık için bugünün aralığını bir kez yazar, vadesi gelenleri değerlendirir.
  function gunluk(liste) {
    var log = lsGet(LOG, []), degisti = false;
    liste.forEach(function (x) {
      var b = x.bars;
      if (!b || b.length < 300) return;
      var d = gun(b[b.length - 1].t);
      // değerlendirme
      log.forEach(function (e) {
        if (e.k !== x.key || e.s) return;
        var i0 = -1;
        for (var i = b.length - 1; i >= 0; i--) { if (gun(b[i].t) === e.d) { i0 = i; break; } if (gun(b[i].t) < e.d) break; }
        if (i0 < 0 || i0 + e.h >= b.length) return;
        var y = b[i0 + e.h].c;
        e.s = { y: y, b80: y >= e.q10 && y <= e.q90, b50: y >= e.q25 && y <= e.q75 };
        degisti = true;
      });
      if (log.some(function (e) { return e.k === x.key && e.d === d; })) return;
      var kal = x.kal;
      if (!kal) { try { kal = test(b); } catch (e) { kal = null; } }
      var K = koni(b, { H: 20, kal: kal });
      if (!K) return;
      [5, 20].forEach(function (h) {
        var z = K.son[h - 1];
        if (!z) return;
        log.push({ k: x.key, ad: x.ad, d: d, h: h, c: K.fiyat, q10: z.q10, q25: z.q25, q75: z.q75, q90: z.q90 });
        degisti = true;
      });
    });
    if (degisti) lsSet(LOG, log.slice(-MAXLOG));
    return log;
  }
  function karne() {
    var log = lsGet(LOG, []), out = { h5: { n: 0, b80: 0, b50: 0 }, h20: { n: 0, b80: 0, b50: 0 }, bekleyen: 0, ilk: null, varlik: {} };
    log.forEach(function (e) {
      if (!out.ilk || e.d < out.ilk) out.ilk = e.d;
      if (!e.s) { out.bekleyen++; return; }
      var o = out['h' + e.h];
      if (!o) return;
      o.n++; if (e.s.b80) o.b80++; if (e.s.b50) o.b50++;
      var v = out.varlik[e.ad] || (out.varlik[e.ad] = { n: 0, b80: 0 });
      v.n++; if (e.s.b80) v.b80++;
    });
    return out;
  }

  /* ---------------- metin ---------------- */
  function yorum(b, ctx) {
    ctx = ctx || {};
    var T = ctx.test, K = koni(b, { H: 20, kal: T });
    if (!K) return null;
    var dp = ctx.dp == null ? 2 : ctx.dp, u = ctx.unit ? ' ' + ctx.unit : '', px = K.fiyat;
    function f(v) { return isNum(v) ? v.toLocaleString('tr-TR', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace('-', '−') + u : '—'; }
    function y(v) { return (v * 100).toLocaleString('tr-TR', { maximumFractionDigits: 0 }); }
    function pc(v) { var s = (v * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }); return (v > 0 ? '+%' : (v < 0 ? '−%' : '%')) + s.replace('-', ''); }
    var z5 = K.son[4], z20 = K.son[19], satir = [];
    if (z5) satir.push('5 işlem günü sonra: %80 olasılıkla ' + f(z5.q10) + ' – ' + f(z5.q90) + ' arası; %50 olasılıkla ' + f(z5.q25) + ' – ' + f(z5.q75) + '.');
    if (z20) satir.push('20 işlem günü sonra: %80 olasılıkla ' + f(z20.q10) + ' – ' + f(z20.q90) + ' arası; orta değer ' + f(z20.q50) + ' (' + pc(z20.q50 / px - 1) + ').');
    satir.push('Orta değer, son ' + Math.round(K.gun / 252 * 10) / 10 + ' yılın ortanca hareketi sürerse nerede olunacağını gösterir; yön tahmini değildir. Bugünkü oynaklık geçmiş ortalamanın ' +
      K.vr.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' katı; aralık buna göre ' + (K.vr > 1.05 ? 'genişletildi' : (K.vr < 0.95 ? 'daraltıldı' : 'olduğu gibi kullanıldı')) + '.');
    var seviyeler = (ctx.seviyeler || []).filter(function (s) { return isNum(s.v) && Math.abs(s.v / px - 1) > 0.002 && Math.abs(s.v / px - 1) < 0.25; });
    var dg = seviyeler.map(function (s) { var p = degme(b, s.v, 20); return p == null ? null : s.ad + ' ' + f(s.v) + ': %' + y(p); }).filter(Boolean);
    if (dg.length) satir.push('20 işlem günü içinde en az bir kez değme olasılığı (geçmiş hareketlere göre): ' + dg.join(' · ') + '.');
    if (T && T.h20) {
      var Z = T.h20, b80 = Z.b80, iyi = Math.abs(b80 - 0.8) <= 0.04, ks = function (k) { return k.toLocaleString('tr-TR', { maximumFractionDigits: 2 }); };
      var s = 'Geçmiş test (' + Z.n + ' gün, 20 gün sonrası): düzeltmesiz %80\'lik aralık gerçekte %' + y(b80) + ', %50\'lik aralık %' + y(Z.b50) + ' tuttu';
      if (K.ayarli && Z.k80 != null) {
        s += iyi && Math.abs(Z.k80 - 1) < 0.08 ? '; aralıklar zaten iyi ayarlıydı.' :
          '; bu yüzden aralık bu varlıkta ' + ks(Z.k80) + ' katına ' + (Z.k80 >= 1 ? 'genişletildi' : 'daraltıldı') + '.';
        if (Z.b80k != null && Z.nk >= 60) {
          s += ' Bu düzeltme geçmişte her gün yalnız o güne kadarki sonuçlarla yapılsaydı %80\'lik aralık %' + y(Z.b80k) + ', %50\'lik aralık %' + y(Z.b50k) + ' tutacaktı (' + Z.nk + ' gün).';
          if (Z.b80k < 0.7) s += ' Yani bu varlıkta aralıklara güvenilmemeli: fiyat geçmişte düzeltmeye rağmen sık sık aralığın dışına çıktı.';
        }
      } else s += iyi ? '; aralıklar iyi ayarlı.' : (b80 < 0.8 ? '; aralıklar olması gerekenden dar, gerçek risk daha geniş.' : '; aralıklar olması gerekenden geniş.');
      satir.push(s);
      if (Z.yon != null) {
        var hep = Math.max(Z.yukariOran, 1 - Z.yukariOran);
        satir.push('Orta değerin yönü geçmişte %' + y(Z.yon) + ' tuttu. Bu dönemde fiyatın 20 gün sonra daha yüksekte olma oranı %' + y(Z.yukariOran) + '; yani "hep ' + (Z.yukariOran >= 0.5 ? 'yükselir' : 'düşer') + '" demek %' + y(hep) + ' tutardı. ' +
          (Z.yon <= hep + 0.03 ? 'Orta değer bundan daha iyi değil; yön tahmini olarak kullanılmamalı.' : 'Orta değer bundan biraz iyi, ama bu fark tek bir dönemin sonucu olabilir; yön tahmini olarak güvenilmemeli.'));
      }
    }
    return { koni: K, satir: satir };
  }

  window.GMITAHMIN = { koni: koni, degme: degme, test: test, gunluk: gunluk, karne: karne, yorum: yorum };
})();
