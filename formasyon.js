/* Grafik analizi (kural tabanlı, telefonda):
   - salınım noktaları (zigzag: fiyat k×ATR dönünce tepe/dip kesinleşir)
   - tüm destek/direnç bölgeleri (salınım noktalarının kümeleri; dokunma sayısıyla güç)
   - trend çizgileri ve kanal
   - formasyonlar: ikili tepe/dip, omuz-baş-omuz (OBO) ve ters OBO (TOBO), yükselen/alçalan/simetrik üçgen,
     yükselen/alçalan takoz, dikdörtgen, yükselen/düşen kanal, bayrak
   - mum formasyonları, Fibonacci düzeltmesi, RSI/MACD uyumsuzlukları, genişletilmiş gösterge tablosu
   - geçmiş: bu varlıkta her formasyonun onaylandıktan sonra hedefe mi zarar-kes seviyesine mi önce gittiği,
     aynı mesafeler için rastgele günlerle karşılaştırmalı
   Formasyon hedefi klasik "ölçüm hedefi"dir (formasyon yüksekliği kırılım noktasına eklenir); gerçekleşme garantisi yoktur.
   GMIFORM.analyze(bars) → sonuç · GMIFORM.gecmis(bars) → geçmiş sonuçlar · GMIFORM.yorum(sonuç, bağlam) → cümleler */
(function () {
  'use strict';
  var K_ZZ = 1.6, K_BUYUK = 3.2, UFUK = 60;
  var AD = {
    ikili_dip: 'İkili dip', ikili_tepe: 'İkili tepe', tobo: 'Ters omuz-baş-omuz (TOBO)', obo: 'Omuz-baş-omuz (OBO)',
    yukselen_ucgen: 'Yükselen üçgen', alcalan_ucgen: 'Alçalan üçgen', simetrik_ucgen: 'Simetrik üçgen',
    yukselen_takoz: 'Yükselen takoz', alcalan_takoz: 'Alçalan takoz', dikdortgen: 'Dikdörtgen (yatay bant)',
    yukselen_kanal: 'Yükselen kanal', dusen_kanal: 'Düşen kanal', boga_bayragi: 'Boğa bayrağı', ayi_bayragi: 'Ayı bayrağı'
  };
  // Klasik okumada beklenen yön (+1 yukarı, −1 aşağı, 0 iki yöne de açık)
  var KLASIK = { ikili_dip: 1, ikili_tepe: -1, tobo: 1, obo: -1, yukselen_ucgen: 1, alcalan_ucgen: -1, simetrik_ucgen: 0, yukselen_takoz: -1,
    alcalan_takoz: 1, dikdortgen: 0, yukselen_kanal: 1, dusen_kanal: -1, boga_bayragi: 1, ayi_bayragi: -1 };

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function ENG() { return window.GMI || (typeof GMI !== 'undefined' ? GMI : null); }

  /* ---------------- temel diziler ---------------- */
  function atrArr(b, n) {
    n = n || 14;
    var out = new Array(b.length), prev = null, sum = 0, i;
    for (i = 0; i < b.length; i++) {
      var tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l;
      if (i < n) { sum += tr; prev = sum / (i + 1); } else prev = (prev * (n - 1) + tr) / n;
      out[i] = prev > 0 ? prev : Math.abs(b[i].c) * 0.01 || 1e-9;
    }
    return out;
  }
  function sma(a, n) {
    var out = new Array(a.length).fill(null), s = 0;
    for (var i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  }
  function ema(a, n) {
    var out = new Array(a.length).fill(null), k = 2 / (n + 1), p = null;
    for (var i = 0; i < a.length; i++) {
      if (i === n - 1) { var s = 0; for (var j = 0; j < n; j++) s += a[j]; p = s / n; out[i] = p; }
      else if (i >= n) { p = a[i] * k + p * (1 - k); out[i] = p; }
    }
    return out;
  }
  function hh(b, from, to) { var m = -Infinity; for (var i = Math.max(0, from); i <= to; i++) if (b[i].h > m) m = b[i].h; return m; }
  function ll(b, from, to) { var m = Infinity; for (var i = Math.max(0, from); i <= to; i++) if (b[i].l < m) m = b[i].l; return m; }

  /* ---------------- salınım noktaları ---------------- */
  // Her nokta: i (mum), p (fiyat), t ('H' tepe, 'L' dip), ci (kesinleştiği mum)
  function zigzag(b, atr, k) {
    var piv = [], dir = 0, hiI = 0, loI = 0;
    for (var i = 1; i < b.length; i++) {
      var th = k * atr[i];
      if (dir >= 0 && b[i].h >= b[hiI].h) hiI = i;
      if (dir <= 0 && b[i].l <= b[loI].l) loI = i;
      if (dir === 0) {
        if (hiI < i && b[hiI].h - b[i].l >= th) { piv.push({ i: hiI, p: b[hiI].h, t: 'H', ci: i }); dir = -1; loI = i; }
        else if (loI < i && b[i].h - b[loI].l >= th) { piv.push({ i: loI, p: b[loI].l, t: 'L', ci: i }); dir = 1; hiI = i; }
      } else if (dir === 1) {
        if (hiI < i && b[hiI].h - b[i].l >= th) { piv.push({ i: hiI, p: b[hiI].h, t: 'H', ci: i }); dir = -1; loI = i; }
      } else if (loI < i && b[i].h - b[loI].l >= th) { piv.push({ i: loI, p: b[loI].l, t: 'L', ci: i }); dir = 1; hiI = i; }
    }
    return piv;
  }
  // t anında bilinen noktalar: kesinleşmiş olanlar + son kesinleşmiş noktadan sonraki uç (geçici)
  function noktalar(piv, b, t, max) {
    var P = [], k;
    for (k = 0; k < piv.length && piv[k].ci <= t; k++) P.push(piv[k]);
    if (P.length) {
      var son = P[P.length - 1], ei = son.i + 1;
      if (ei <= t) {
        if (son.t === 'H') { for (var j = ei; j <= t; j++) if (b[j].l <= b[ei].l) ei = j; P.push({ i: ei, p: b[ei].l, t: 'L', gecici: true }); }
        else { for (j = ei; j <= t; j++) if (b[j].h >= b[ei].h) ei = j; P.push({ i: ei, p: b[ei].h, t: 'H', gecici: true }); }
      }
    }
    return max ? P.slice(-max) : P;
  }

  /* ---------------- destek/direnç bölgeleri ---------------- */
  function bolgeler(piv, b, atrNow, price, from) {
    var pts = piv.filter(function (p) { return p.i >= from; }).map(function (p) { return { v: p.p, i: p.i }; }).sort(function (a, z) { return a.v - z.v; });
    var tol = 0.6 * atrNow, out = [], cur = null;
    pts.forEach(function (p) {
      // bölge en fazla 1,2 ATR kalınlığında olabilir; yoksa yoğun bir aralığın tamamı tek bölgeye dönüşür
      if (cur && p.v - cur.hi <= tol && p.v - cur.lo <= 1.2 * atrNow) { cur.hi = p.v; cur.top += p.v; cur.n++; cur.son = Math.max(cur.son, p.i); }
      else { cur = { lo: p.v, hi: p.v, top: p.v, n: 1, son: p.i }; out.push(cur); }
    });
    out.forEach(function (z) {
      z.mid = z.top / z.n; delete z.top;
      if (z.hi - z.lo < 0.3 * atrNow) { z.lo = z.mid - 0.15 * atrNow; z.hi = z.mid + 0.15 * atrNow; }
      z.tur = z.lo > price ? 'r' : (z.hi < price ? 's' : 'k');
      z.guc = Math.min(3, z.n);
    });
    return out;
  }

  /* ---------------- trend çizgileri ---------------- */
  // tür 'L': dipleri birleştiren destek çizgisi, 'H': tepeleri birleştiren direnç çizgisi
  function trendCizgisi(b, P, tur, atrNow, end) {
    var pts = P.filter(function (p) { return p.t === tur && !p.gecici && p.i >= end - 140; }).slice(-7), tol = 0.35 * atrNow, best = null, px = b[end].c;
    for (var a = 0; a < pts.length; a++) {
      for (var c = a + 1; c < pts.length; c++) {
        var p1 = pts[a], p2 = pts[c];
        if (p2.i - p1.i < 6) continue;
        var m = (p2.p - p1.p) / (p2.i - p1.i), ok = true, j;
        for (j = p1.i; j <= p2.i; j++) {
          var lv = p1.p + m * (j - p1.i);
          if (tur === 'L' ? b[j].c < lv - tol : b[j].c > lv + tol) { ok = false; break; }
        }
        if (!ok) continue;
        var dok = 0;
        pts.forEach(function (q) { if (q.i >= p1.i && Math.abs(q.p - (p1.p + m * (q.i - p1.i))) <= tol) dok++; });
        var kir = null;
        // kırılım ölçütü formasyonlardakiyle aynı: 0,25 ATR öteye kapanış
        for (j = p2.i + 1; j <= end; j++) {
          var lv2 = p1.p + m * (j - p1.i);
          if (tur === 'L' ? b[j].c < lv2 - 0.25 * atrNow : b[j].c > lv2 + 0.25 * atrNow) { kir = j; break; }
        }
        var simdi = p1.p + m * (end - p1.i);
        if (kir == null && Math.abs(simdi - px) > 7 * atrNow) continue;
        // yeni kırılmış çizgi önemli bilgidir; yalnız eskiden kırılmış çizgiler geri plana itilir
        var puan = dok * 10 + 6 * (p2.i / end) - (kir == null ? 0 : (kir < end - 10 ? 9 : 4)) + (p2.i - p1.i) / 60;
        if (!best || puan > best.puan) best = { i1: p1.i, p1: p1.p, i2: p2.i, p2: p2.p, m: m, dok: dok, kirildi: kir, puan: puan, tur: tur };
      }
    }
    if (best) best.simdi = best.p1 + best.m * (end - best.i1);
    return best;
  }
  function egimTxt(m, atrNow) { var g = m / atrNow; return Math.abs(g) < 0.02 ? 'yatay' : (g > 0 ? 'yükselen' : 'düşen'); }

  /* ---------------- formasyonlar ---------------- */
  // Kırılım (onay), bozulma ve hedef: f(j) sınır çizgisi, d beklenen kırılım yönü, yuk formasyon yüksekliği
  function sonuc(pt, b, end, tol) {
    var j, d = pt.d;
    pt.onay = null; pt.durum = 'oluşuyor';
    for (j = pt.ara; j <= end; j++) {
      if (d > 0 ? b[j].c < pt.iptal - tol : b[j].c > pt.iptal + tol) { pt.durum = 'bozuldu'; pt.bitis = j; break; }
      var v = pt.f(j);
      if (d > 0 ? b[j].c > v + tol : b[j].c < v - tol) { pt.onay = j; break; }
    }
    var kv = pt.f(pt.onay != null ? pt.onay : end);
    pt.hedef = kv + d * pt.yuk;
    pt.stop = pt.iptal;
    if (pt.onay == null) { pt.onaySeviye = kv; return pt; }
    pt.durum = 'onaylandı';
    for (j = pt.onay + 1; j <= end; j++) {
      if (d > 0 ? b[j].h >= pt.hedef : b[j].l <= pt.hedef) { pt.durum = 'hedefe ulaştı'; pt.bitis = j; break; }
      if (d > 0 ? b[j].c < pt.stop - tol : b[j].c > pt.stop + tol) { pt.durum = 'bozuldu'; pt.bitis = j; break; }
    }
    return pt;
  }

  function ikili(P, b, atr, end) {
    var out = [];
    for (var k = P.length - 1; k >= 2 && k >= P.length - 3; k--) {
      var a = P[k - 2], m = P[k - 1], c = P[k];
      if (c.gecici || a.t !== c.t || m.t === a.t) continue;
      var dip = a.t === 'L', at = atr[c.i], yuk = dip ? m.p - Math.min(a.p, c.p) : Math.max(a.p, c.p) - m.p;
      if (yuk < 2 * at || c.i - a.i < 8 || c.i - a.i > 120) continue;
      if (Math.abs(a.p - c.p) > Math.max(0.6 * at, 0.12 * yuk)) continue;
      var boyun = m.p;
      var pt = { tip: dip ? 'ikili_dip' : 'ikili_tepe', d: dip ? 1 : -1, f: function () { return boyun; }, yuk: (dip ? boyun - (a.p + c.p) / 2 : (a.p + c.p) / 2 - boyun),
        iptal: dip ? Math.min(a.p, c.p) : Math.max(a.p, c.p), ara: c.i + 1, bas: a.i, son: c.i, anahtar: a.i + '-' + m.i + '-' + c.i,
        noktalar: [{ i: a.i, p: a.p, e: dip ? 'Dip 1' : 'Tepe 1' }, { i: m.i, p: m.p, e: 'Boyun' }, { i: c.i, p: c.p, e: dip ? 'Dip 2' : 'Tepe 2' }],
        cizgiler: [{ i1: a.i, p1: boyun, i2: end, p2: boyun, tur: 'boyun' }, { i1: a.i, p1: a.p, i2: m.i, p2: m.p, tur: 'iz' }, { i1: m.i, p1: m.p, i2: c.i, p2: c.p, tur: 'iz' }] };
      out.push(sonuc(pt, b, end, 0.25 * at));
      break;
    }
    return out;
  }

  function obo(P, b, atr, end) {
    var out = [];
    for (var k = P.length - 1; k >= 4 && k >= P.length - 3; k--) {
      var s1 = P[k - 4], n1 = P[k - 3], bas = P[k - 2], n2 = P[k - 1], s2 = P[k];
      if (s2.gecici || s1.t !== bas.t || bas.t !== s2.t) continue;
      var tepe = s1.t === 'H', at = atr[s2.i], m = (n2.p - n1.p) / (n2.i - n1.i);
      var boyun = function (j) { return n1.p + m * (j - n1.i); };
      var basY = tepe ? bas.p - boyun(bas.i) : boyun(bas.i) - bas.p;
      if (basY < 2 * at || s2.i - s1.i < 12 || s2.i - s1.i > 160) continue;
      if (tepe ? (bas.p < s1.p + 0.5 * at || bas.p < s2.p + 0.5 * at) : (bas.p > s1.p - 0.5 * at || bas.p > s2.p - 0.5 * at)) continue;
      if (Math.abs(s1.p - s2.p) > Math.max(1.0 * at, 0.35 * basY)) continue;
      var pt = { tip: tepe ? 'obo' : 'tobo', d: tepe ? -1 : 1, f: boyun, yuk: basY, iptal: s2.p, ara: s2.i + 1, bas: s1.i, son: s2.i,
        anahtar: [s1.i, n1.i, bas.i, n2.i, s2.i].join('-'),
        noktalar: [{ i: s1.i, p: s1.p, e: 'Sol omuz' }, { i: bas.i, p: bas.p, e: 'Baş' }, { i: s2.i, p: s2.p, e: 'Sağ omuz' }],
        cizgiler: [{ i1: n1.i, p1: n1.p, i2: end, p2: boyun(end), tur: 'boyun' },
          { i1: s1.i, p1: s1.p, i2: n1.i, p2: n1.p, tur: 'iz' }, { i1: n1.i, p1: n1.p, i2: bas.i, p2: bas.p, tur: 'iz' },
          { i1: bas.i, p1: bas.p, i2: n2.i, p2: n2.p, tur: 'iz' }, { i1: n2.i, p1: n2.p, i2: s2.i, p2: s2.p, tur: 'iz' }] };
      out.push(sonuc(pt, b, end, 0.25 * at));
      break;
    }
    return out;
  }

  // Üçgen, takoz, dikdörtgen ve kanal: son tepeler ve diplerden geçen iki sınır çizgisi
  function sinirlar(P, b, atr, end) {
    var C = P.filter(function (p) { return !p.gecici && p.i >= end - 110; });
    var H = C.filter(function (p) { return p.t === 'H'; }).slice(-3), L = C.filter(function (p) { return p.t === 'L'; }).slice(-3);
    if (H.length < 2 || L.length < 2) return [];
    var at = atr[end], i0 = Math.min(H[0].i, L[0].i), ilk = Math.max(H[H.length - 1].i, L[L.length - 1].i);
    if (ilk - i0 < 15 || end - ilk > 30) return [];
    function hat(arr) {
      var a = arr[0], z = arr[arr.length - 1], m = (z.p - a.p) / (z.i - a.i);
      var f = function (j) { return a.p + m * (j - a.i); };
      var sapma = arr.reduce(function (s, q) { return Math.max(s, Math.abs(q.p - f(q.i))); }, 0);
      return { f: f, m: m, sapma: sapma, a: a, z: z };
    }
    var u = hat(H), l = hat(L);
    if (u.sapma > 0.7 * at || l.sapma > 0.7 * at) return [];
    for (var j = i0; j <= ilk; j++) if (b[j].c > u.f(j) + 0.4 * at || b[j].c < l.f(j) - 0.4 * at) return [];
    var w0 = u.f(i0) - l.f(i0), wI = u.f(ilk) - l.f(ilk);
    if (!(w0 > 3 * at) || wI <= 0.15 * w0) return [];
    var genis = ilk - i0, duzU = Math.abs(u.m) * genis <= 0.8 * at, duzL = Math.abs(l.m) * genis <= 0.8 * at;
    var yak = wI < 0.78 * w0, par = Math.abs(wI - w0) <= 0.22 * w0, tip = null;
    if (duzU && !duzL && l.m > 0 && yak) tip = 'yukselen_ucgen';
    else if (duzL && !duzU && u.m < 0 && yak) tip = 'alcalan_ucgen';
    else if (!duzU && !duzL && u.m < 0 && l.m > 0 && yak) tip = 'simetrik_ucgen';
    else if (!duzU && !duzL && u.m > 0 && l.m > 0 && yak && l.m > u.m) tip = 'yukselen_takoz';
    else if (!duzU && !duzL && u.m < 0 && l.m < 0 && yak && u.m < l.m) tip = 'alcalan_takoz';
    else if (duzU && duzL && par) tip = 'dikdortgen';
    else if (par && !duzU && !duzL && u.m > 0 && l.m > 0) tip = 'yukselen_kanal';
    else if (par && !duzU && !duzL && u.m < 0 && l.m < 0) tip = 'dusen_kanal';
    if (!tip) return [];
    // iki yöne kırılım: önce hangisi olursa
    var tol = 0.25 * at, kj = null, kd = 0;
    for (j = ilk + 1; j <= end; j++) {
      if (u.f(j) - l.f(j) <= 0) break;
      if (b[j].c > u.f(j) + tol) { kj = j; kd = 1; break; }
      if (b[j].c < l.f(j) - tol) { kj = j; kd = -1; break; }
    }
    if (kj == null && u.f(end) - l.f(end) <= 0.1 * w0) return [];
    var pt = { tip: tip, d: kd || KLASIK[tip] || 1, bas: i0, son: ilk, anahtar: H.concat(L).map(function (q) { return q.i; }).join('-'), yuk: w0,
      noktalar: H.map(function (q) { return { i: q.i, p: q.p, e: '' }; }).concat(L.map(function (q) { return { i: q.i, p: q.p, e: '' }; })),
      cizgiler: [{ i1: i0, p1: u.f(i0), i2: end, p2: u.f(end), tur: 'ust' }, { i1: i0, p1: l.f(i0), i2: end, p2: l.f(end), tur: 'alt' }],
      ustF: u.f, altF: l.f, onay: kj };
    if (kj != null) {
      var sinir = kd > 0 ? u.f(kj) : l.f(kj);
      pt.hedef = sinir + kd * w0; pt.stop = kd > 0 ? l.f(kj) : u.f(kj); pt.durum = 'onaylandı';
      for (j = kj + 1; j <= end; j++) {
        if (kd > 0 ? b[j].h >= pt.hedef : b[j].l <= pt.hedef) { pt.durum = 'hedefe ulaştı'; pt.bitis = j; break; }
        if (kd > 0 ? b[j].c < pt.stop - tol : b[j].c > pt.stop + tol) { pt.durum = 'bozuldu'; pt.bitis = j; break; }
      }
    } else {
      pt.durum = 'oluşuyor';
      pt.yukari = { sinir: u.f(end), hedef: u.f(end) + w0 };
      pt.asagi = { sinir: l.f(end), hedef: l.f(end) - w0 };
      pt.hedef = KLASIK[tip] >= 0 ? pt.yukari.hedef : pt.asagi.hedef;
      pt.stop = KLASIK[tip] >= 0 ? l.f(end) : u.f(end);
    }
    return [pt];
  }

  // Bayrak: kısa sürede güçlü hareket (direk) ve ardından dar, hafif ters eğimli dinlenme
  function bayrak(P, b, atr, end) {
    var C = P.filter(function (p) { return !p.gecici; }), A = null, B = null, at, direk, d, k;
    for (k = C.length - 1; k >= 1 && k >= C.length - 4; k--) {
      var a0 = C[k - 1], b0 = C[k], at0 = atr[b0.i];
      if (a0.t !== b0.t && Math.abs(b0.p - a0.p) >= 4 * at0 && b0.i - a0.i <= 15 && end - b0.i >= 4 && end - b0.i <= 25) { A = a0; B = b0; break; }
    }
    if (!A) return [];
    at = atr[B.i]; direk = B.p - A.p; d = direk > 0 ? 1 : -1;
    var ust = hh(b, B.i + 1, end), alt = ll(b, B.i + 1, end);
    if (ust - alt > 0.55 * Math.abs(direk)) return [];
    if (d > 0 ? alt < B.p - 0.5 * direk : ust > B.p - 0.5 * direk) return [];
    // kırılım: dinlenmenin önceki uçlarının ötesinde kapanış
    var tol = 0.2 * at, kj = null, j;
    for (j = B.i + 3; j <= end; j++) {
      var u = hh(b, B.i + 1, j - 1), l = ll(b, B.i + 1, j - 1);
      if (d > 0 ? b[j].c > u + tol : b[j].c < l - tol) { kj = j; break; }
      if (d > 0 ? b[j].c < l - tol && j - B.i > 3 && b[j].c < B.p - 0.5 * direk : b[j].c > u + tol && b[j].c > B.p - 0.5 * direk) break;
    }
    var pt = { tip: d > 0 ? 'boga_bayragi' : 'ayi_bayragi', d: d, bas: A.i, son: B.i, anahtar: A.i + '-' + B.i, yuk: Math.abs(direk), onay: kj,
      noktalar: [{ i: A.i, p: A.p, e: 'Direk' }, { i: B.i, p: B.p, e: '' }],
      cizgiler: [{ i1: A.i, p1: A.p, i2: B.i, p2: B.p, tur: 'iz' }, { i1: B.i, p1: ust, i2: end, p2: ust, tur: 'ust' }, { i1: B.i, p1: alt, i2: end, p2: alt, tur: 'alt' }] };
    if (kj != null) {
      var kv = d > 0 ? hh(b, B.i + 1, kj - 1) : ll(b, B.i + 1, kj - 1);
      pt.hedef = kv + d * Math.abs(direk); pt.stop = d > 0 ? ll(b, B.i + 1, kj) : hh(b, B.i + 1, kj); pt.durum = 'onaylandı';
      for (j = kj + 1; j <= end; j++) {
        if (d > 0 ? b[j].h >= pt.hedef : b[j].l <= pt.hedef) { pt.durum = 'hedefe ulaştı'; pt.bitis = j; break; }
        if (d > 0 ? b[j].c < pt.stop - tol : b[j].c > pt.stop + tol) { pt.durum = 'bozuldu'; pt.bitis = j; break; }
      }
    } else {
      pt.durum = 'oluşuyor'; pt.onaySeviye = d > 0 ? ust : alt; pt.hedef = pt.onaySeviye + d * Math.abs(direk); pt.stop = d > 0 ? alt : ust;
    }
    return [pt];
  }

  function formasyonlar(P, b, atr, end) {
    return [].concat(obo(P, b, atr, end), ikili(P, b, atr, end), sinirlar(P, b, atr, end), bayrak(P, b, atr, end))
      .map(function (pt) { pt.ad = AD[pt.tip]; pt.klasik = KLASIK[pt.tip]; return pt; });
  }

  /* ---------------- mum formasyonları ---------------- */
  function mumlar(b, atr, end) {
    var out = [];
    for (var i = Math.max(3, end - 9); i <= end; i++) {
      var x = b[i], p = b[i - 1], q = b[i - 2], at = atr[i], rng = x.h - x.l;
      if (rng < 0.35 * at) continue;
      var body = Math.abs(x.c - x.o), pbody = Math.abs(p.c - p.o), qbody = Math.abs(q.c - q.o);
      var ust = x.h - Math.max(x.o, x.c), alt = Math.min(x.o, x.c) - x.l, oncesi = b[i - 1].c - b[Math.max(0, i - 6)].c;
      var ad = null, yon = 0;
      if (q.c < q.o && qbody > 0.6 * at && pbody < 0.35 * qbody && x.c > x.o && x.c > (q.o + q.c) / 2) { ad = 'Sabah yıldızı'; yon = 1; }
      else if (q.c > q.o && qbody > 0.6 * at && pbody < 0.35 * qbody && x.c < x.o && x.c < (q.o + q.c) / 2) { ad = 'Akşam yıldızı'; yon = -1; }
      else if (p.c < p.o && x.c > x.o && x.c >= p.o && x.o <= p.c && body > pbody) { ad = 'Yutan boğa'; yon = 1; }
      else if (p.c > p.o && x.c < x.o && x.o >= p.c && x.c <= p.o && body > pbody) { ad = 'Yutan ayı'; yon = -1; }
      else if (alt >= 2 * body && ust <= Math.max(body, 0.12 * rng) && oncesi < 0) { ad = 'Çekiç'; yon = 1; }
      else if (ust >= 2 * body && alt <= Math.max(body, 0.12 * rng) && oncesi > 0) { ad = 'Kayan yıldız'; yon = -1; }
      else if (body <= 0.1 * rng) { ad = 'Doji'; yon = 0; }
      if (ad) out.push({ i: i, ad: ad, yon: yon });
    }
    return out;
  }

  /* ---------------- Fibonacci ---------------- */
  function fibo(b, atr, end) {
    var P = noktalar(zigzag(b, atr, K_BUYUK), b, end);
    if (P.length < 2) return null;
    var A = P[P.length - 2], B = P[P.length - 1];
    if (B.i - A.i < 5) return null;
    var yukari = B.p > A.p, r = Math.abs(B.p - A.p);
    return { i1: A.i, p1: A.p, i2: B.i, p2: B.p, yukari: yukari, seviye: [0.236, 0.382, 0.5, 0.618, 0.786].map(function (k) { return { k: k, v: yukari ? B.p - r * k : B.p + r * k }; }) };
  }

  /* ---------------- uyumsuzluk ---------------- */
  function uyumsuzluk(P, b, rsi, macd, end) {
    var out = [];
    ['H', 'L'].forEach(function (t) {
      var Q = P.filter(function (p) { return p.t === t; }).slice(-2);
      if (Q.length < 2) return;
      var a = Q[0], c = Q[1];
      if (c.i < end - 15 || c.i - a.i < 5) return;
      [['RSI', rsi, 2], ['MACD', macd, 0]].forEach(function (g) {
        var x1 = g[1][a.i], x2 = g[1][c.i];
        if (!isNum(x1) || !isNum(x2)) return;
        var esik = g[0] === 'MACD' ? Math.abs(x1) * 0.1 : g[2];
        if (t === 'H' && c.p > a.p && x2 < x1 - esik) out.push({ gosterge: g[0], tur: 'negatif', i1: a.i, i2: c.i, p1: a.p, p2: c.p, v1: x1, v2: x2 });
        if (t === 'L' && c.p < a.p && x2 > x1 + esik) out.push({ gosterge: g[0], tur: 'pozitif', i1: a.i, i2: c.i, p1: a.p, p2: c.p, v1: x1, v2: x2 });
      });
    });
    return out;
  }

  /* ---------------- genişletilmiş gösterge tablosu ---------------- */
  function gostergeler(b, atr) {
    var E = ENG(), n = b.length, L = n - 1, c = b.map(function (x) { return x.c; }), rows = [], px = c[L];
    if (!E || n < 60) return null;
    function row(grp, ad, deger, okuma, yon) { rows.push({ grp: grp, ad: ad, deger: deger, okuma: okuma, yon: yon }); }
    function f(v, dp) { return isNum(v) ? v.toLocaleString('tr-TR', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace('-', '−') : '—'; }
    var dpx = px >= 1000 ? 0 : (px >= 10 ? 2 : 4);
    [20, 50, 200].forEach(function (k) {
      var s = sma(c, k)[L];
      if (isNum(s)) row('Trend', 'SMA ' + k, f(s, dpx), px > s ? 'fiyat üstünde' : 'fiyat altında', px > s ? 1 : -1);
    });
    var e9 = ema(c, 9)[L], e21 = ema(c, 21)[L];
    if (isNum(e9) && isNum(e21)) row('Trend', 'EMA 9 / 21', f(e9, dpx) + ' / ' + f(e21, dpx), e9 > e21 ? 'kısa ortalama üstte' : 'kısa ortalama altta', e9 > e21 ? 1 : -1);
    var md = E.macd(c);
    if (isNum(md.m[L]) && isNum(md.s[L])) row('Trend', 'MACD (12, 26, 9)', f(md.h[L], dpx > 2 ? 4 : 2), md.m[L] > md.s[L] ? 'sinyal çizgisinin üstünde' : 'sinyal çizgisinin altında', md.m[L] > md.s[L] ? 1 : -1);
    var ax = E.adx(b);
    if (isNum(ax.adx[L])) {
      var up = ax.pdi[L] > ax.mdi[L], g = ax.adx[L];
      row('Trend', 'ADX (14)', f(g, 1), (g >= 25 ? 'güçlü trend, ' : (g < 20 ? 'trend zayıf, ' : 'orta, ')) + (up ? '+DI önde' : '−DI önde'), g < 20 ? 0 : (up ? 1 : -1));
    }
    var ps = E.psar(b)[L];
    if (ps) row('Trend', 'Parabolic SAR', f(ps.sar, dpx), ps.up ? 'fiyatın altında (yükseliş)' : 'fiyatın üstünde (düşüş)', ps.up ? 1 : -1);
    if (n >= 78) {
      var ten = (hh(b, L - 8, L) + ll(b, L - 8, L)) / 2, kij = (hh(b, L - 25, L) + ll(b, L - 25, L)) / 2;
      var k0 = L - 26, spanA = ((hh(b, k0 - 8, k0) + ll(b, k0 - 8, k0)) / 2 + (hh(b, k0 - 25, k0) + ll(b, k0 - 25, k0)) / 2) / 2, spanB = (hh(b, k0 - 51, k0) + ll(b, k0 - 51, k0)) / 2;
      var bu = Math.max(spanA, spanB), ba = Math.min(spanA, spanB), y = px > bu ? 1 : (px < ba ? -1 : 0);
      row('Trend', 'Ichimoku bulutu', f(ba, dpx) + '–' + f(bu, dpx), (y > 0 ? 'fiyat bulutun üstünde' : (y < 0 ? 'fiyat bulutun altında' : 'fiyat bulutun içinde')) + (ten > kij ? ', Tenkan > Kijun' : ', Tenkan < Kijun'), y);
    }
    // Supertrend (10, 3)
    var a10 = atrArr(b, 10), stUp = true, upB = null, dnB = null;
    for (var i = 1; i < n; i++) {
      var m = (b[i].h + b[i].l) / 2, bu2 = m + 3 * a10[i], bd2 = m - 3 * a10[i];
      upB = upB == null || bu2 < upB || b[i - 1].c > upB ? bu2 : upB;
      dnB = dnB == null || bd2 > dnB || b[i - 1].c < dnB ? bd2 : dnB;
      if (stUp && b[i].c < dnB) stUp = false; else if (!stUp && b[i].c > upB) stUp = true;
    }
    row('Trend', 'Supertrend (10, 3)', f(stUp ? dnB : upB, dpx), stUp ? 'yükseliş modunda' : 'düşüş modunda', stUp ? 1 : -1);
    var r = E.rsi(c, 14)[L];
    if (isNum(r)) row('Momentum', 'RSI (14)', f(r, 1), r >= 70 ? 'aşırı alım bölgesi' : (r <= 30 ? 'aşırı satım bölgesi' : (r >= 55 ? 'alıcılar güçlü' : (r <= 45 ? 'satıcılar güçlü' : 'dengede'))),
      r >= 70 || r <= 30 ? 0 : (r >= 55 ? 1 : (r <= 45 ? -1 : 0)));
    var st = E.stoch(b), K = st.K[L], D = st.D[L];
    if (isNum(K) && isNum(D)) row('Momentum', 'Stokastik (14, 3, 3)', f(K, 1) + ' / ' + f(D, 1), (K >= 80 ? 'aşırı alım, ' : (K <= 20 ? 'aşırı satım, ' : '')) + (K > D ? '%K yukarıda' : '%K aşağıda'),
      K >= 80 || K <= 20 ? 0 : (K > D ? 1 : -1));
    var cc = E.cci(b, 20)[L];
    if (isNum(cc)) row('Momentum', 'CCI (20)', f(cc, 0), cc > 100 ? 'güçlü yukarı' : (cc < -100 ? 'güçlü aşağı' : 'normal aralıkta'), cc > 100 ? 1 : (cc < -100 ? -1 : 0));
    var hh14 = hh(b, L - 13, L), ll14 = ll(b, L - 13, L), wr = hh14 > ll14 ? -100 * (hh14 - px) / (hh14 - ll14) : -50;
    row('Momentum', 'Williams %R (14)', f(wr, 1), wr > -20 ? 'aşırı alım' : (wr < -80 ? 'aşırı satım' : (wr > -50 ? 'üst yarıda' : 'alt yarıda')), wr > -20 || wr < -80 ? 0 : (wr > -50 ? 1 : -1));
    if (n > 13) { var roc = 100 * (px / c[L - 12] - 1); row('Momentum', 'ROC (12)', f(roc, 2) + '%', roc > 0 ? '12 mumda yükseliş' : '12 mumda düşüş', roc > 0 ? 1 : -1); }
    var bb = E.boll(c, 20, 2);
    if (bb) row('Oynaklık', 'Bollinger %B', f(bb.pctb, 2), bb.pctb > 1 ? 'üst bandın dışında' : (bb.pctb < 0 ? 'alt bandın dışında' : (bb.pctb > 0.5 ? 'orta çizginin üstünde' : 'orta çizginin altında')), 0);
    var e20 = ema(c, 20)[L], a10L = a10[L];
    if (isNum(e20)) row('Oynaklık', 'Keltner (20, 2×ATR)', f(e20 - 2 * a10L, dpx) + '–' + f(e20 + 2 * a10L, dpx), px > e20 + 2 * a10L ? 'üst kanalın dışında' : (px < e20 - 2 * a10L ? 'alt kanalın dışında' : 'kanalın içinde'), 0);
    var dH = hh(b, L - 20, L - 1), dL = ll(b, L - 20, L - 1);
    row('Oynaklık', 'Donchian (20)', f(dL, dpx) + '–' + f(dH, dpx), px > dH ? '20 mumun zirvesini aştı' : (px < dL ? '20 mumun dibini kırdı' : 'aralığın içinde'), px > dH ? 1 : (px < dL ? -1 : 0));
    row('Oynaklık', 'ATR (14)', f(atr[L], dpx) + ' (%' + f(100 * atr[L] / px, 2) + ')', 'ortalama mum aralığı', 0);
    var hacim = b.slice(-20).some(function (x) { return x.v > 0; });
    if (hacim) {
      var ob = E.obv(b);
      row('Hacim', 'OBV', ob.up ? 'ortalamasının üstünde' : 'ortalamasının altında', ob.up ? 'hacim yükselişi destekliyor' : 'hacim düşüşü destekliyor', ob.up ? 1 : -1);
      var pos = 0, neg = 0;
      for (i = L - 13; i <= L; i++) {
        var tp = (b[i].h + b[i].l + b[i].c) / 3, tp0 = (b[i - 1].h + b[i - 1].l + b[i - 1].c) / 3;
        if (tp > tp0) pos += tp * b[i].v; else if (tp < tp0) neg += tp * b[i].v;
      }
      var mfi = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
      row('Hacim', 'MFI (14)', f(mfi, 1), mfi >= 80 ? 'aşırı alım' : (mfi <= 20 ? 'aşırı satım' : (mfi > 50 ? 'para girişi ağır basıyor' : 'para çıkışı ağır basıyor')), mfi >= 80 || mfi <= 20 ? 0 : (mfi > 50 ? 1 : -1));
    }
    var y2 = rows.filter(function (x) { return x.yon > 0; }).length, a2 = rows.filter(function (x) { return x.yon < 0; }).length;
    return { rows: rows, yukari: y2, asagi: a2, notr: rows.length - y2 - a2, hacim: hacim };
  }

  /* ---------------- tam analiz ---------------- */
  function analyze(b, opt) {
    opt = opt || {};
    if (!b || b.length < 60) return null;
    var end = b.length - 1, atr = atrArr(b, 14), at = atr[end], px = b[end].c, E = ENG();
    var piv = zigzag(b, atr, K_ZZ), P = noktalar(piv, b, end);
    var from = Math.max(0, end - (opt.bak || 260));
    var c = b.map(function (x) { return x.c; });
    var rsi = E ? E.rsi(c, 14) : [], md = E ? E.macd(c) : { m: [] };
    var up = trendCizgisi(b, P, 'L', at, end), dn = trendCizgisi(b, P, 'H', at, end), kanal = null;
    if (up && dn && up.kirildi == null && dn.kirildi == null) {
      var w0 = (dn.p1 + dn.m * (Math.min(up.i1, dn.i1) - dn.i1)) - (up.p1 + up.m * (Math.min(up.i1, dn.i1) - up.i1));
      if (w0 > 0 && Math.abs(up.m - dn.m) * (end - Math.min(up.i1, dn.i1)) <= 0.25 * w0) kanal = { egim: egimTxt((up.m + dn.m) / 2, at), alt: up, ust: dn };
    }
    var pats = formasyonlar(P, b, atr, end).filter(function (pt) {
      var son = pt.bitis != null ? pt.bitis : (pt.onay != null ? pt.onay : pt.son);
      return son >= end - 45 && !(pt.durum === 'bozuldu' && pt.bitis < end - 10);
    });
    return {
      end: end, atr: at, fiyat: px, noktalar: P.filter(function (p) { return p.i >= from; }),
      bolgeler: bolgeler(piv, b, at, px, from), trend: { yukari: up, asagi: dn, kanal: kanal },
      formasyonlar: pats, mumlar: mumlar(b, atr, end), fib: fibo(b, atr, end), uyumsuzluk: uyumsuzluk(P, b, rsi, md.m, end),
      gostergeler: opt.tablo === false ? null : gostergeler(b, atr)
    };
  }

  /* ---------------- geçmiş: formasyonlar onaylandıktan sonra ne oldu? ---------------- */
  // Her onay günü: önce hedefe mi (başarılı) yoksa zarar-kes seviyesine mi (başarısız) gidildi, UFUK mum içinde.
  // Taban: aynı yüzdesel hedef ve zarar-kes mesafeleriyle, rastgele günlerde önce hedefe ulaşma oranı.
  function gecmis(b) {
    if (!b || b.length < 300) return null;
    var atr = atrArr(b, 14), piv = zigzag(b, atr, K_ZZ), seen = {}, olay = [], t;
    for (t = 120; t < b.length; t++) {
      var P = noktalar(piv, b, t, 12);
      formasyonlar(P, b, atr, t).forEach(function (pt) {
        if (pt.onay !== t || !isNum(pt.hedef) || !isNum(pt.stop)) return;
        var key = pt.tip + ':' + pt.anahtar;
        if (seen[key]) return;
        seen[key] = 1;
        olay.push({ tip: pt.tip, d: pt.d, t: t, giris: b[t].c, hedef: pt.hedef, stop: pt.stop });
      });
    }
    function kosu(i, d, hedef, stop) {
      for (var j = i + 1; j <= Math.min(b.length - 1, i + UFUK); j++) {
        if (d > 0 ? b[j].h >= hedef : b[j].l <= hedef) return { s: 1, gun: j - i };
        if (d > 0 ? b[j].c < stop : b[j].c > stop) return { s: -1, gun: j - i };
      }
      return { s: i + UFUK < b.length ? 0 : null };
    }
    var tipler = {};
    olay.forEach(function (o) {
      if (!((o.d > 0 && o.hedef > o.giris && o.stop < o.giris) || (o.d < 0 && o.hedef < o.giris && o.stop > o.giris))) return;
      var r = kosu(o.t, o.d, o.hedef, o.stop);
      if (r.s == null) return;
      var T = tipler[o.tip] || (tipler[o.tip] = { n: 0, hedef: 0, stop: 0, acik: 0, gun: 0, taban: 0, tabanN: 0 });
      T.n++;
      if (r.s > 0) { T.hedef++; T.gun += r.gun; } else if (r.s < 0) T.stop++; else T.acik++;
      // aynı mesafeler, rastgele günler
      var dT = o.hedef / o.giris, dS = o.stop / o.giris, ok = 0, top = 0;
      for (var i = 20; i + UFUK < b.length; i += 3) {
        var q = kosu(i, o.d, b[i].c * dT, b[i].c * dS);
        if (q.s == null) continue;
        top++; if (q.s > 0) ok++;
      }
      if (top) { T.taban += ok / top; T.tabanN++; }
    });
    Object.keys(tipler).forEach(function (k) {
      var T = tipler[k];
      T.oran = T.hedef + T.stop ? T.hedef / (T.hedef + T.stop) : null;
      T.tabanOran = T.tabanN ? T.taban / T.tabanN : null;
      T.ortGun = T.hedef ? Math.round(T.gun / T.hedef) : null;
      delete T.taban; delete T.tabanN; delete T.gun;
    });
    var yil = (b[b.length - 1].t - b[120].t) / (365.25 * 86400);
    return { yil: Math.round(yil * 10) / 10, ufuk: UFUK, tipler: tipler };
  }

  /* ---------------- grafiksel yorum ---------------- */
  function yorum(R, ctx) {
    if (!R) return [];
    ctx = ctx || {};
    var dp = ctx.dp == null ? 2 : ctx.dp, u = ctx.unit ? ' ' + ctx.unit : '', out = [], G = ctx.gecmis;
    function f(v) { return isNum(v) ? v.toLocaleString('tr-TR', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace('-', '−') + u : '—'; }
    function yuzde(v) { return (v * 100).toLocaleString('tr-TR', { maximumFractionDigits: 0 }); }
    var px = R.fiyat;
    // trend çizgileri
    var T = R.trend;
    if (T.kanal) out.push('Fiyat ' + T.kanal.egim + ' bir kanalın içinde: alt sınır şu an ' + f(T.kanal.alt.simdi) + ', üst sınır ' + f(T.kanal.ust.simdi) + '. Kanal kırılmadıkça hareket bu iki çizgi arasında gidip gelme eğiliminde.');
    else {
      var buyuk = function (t) { return t.replace(/^./, function (c) { return c.toUpperCase(); }); };
      if (T.yukari) out.push(T.yukari.kirildi != null ? 'Dipleri birleştiren ' + egimTxt(T.yukari.m, R.atr) + ' destek çizgisi aşağı kırıldı (çizgi şu an ' + f(T.yukari.simdi) + ').' :
        buyuk(egimTxt(T.yukari.m, R.atr)) + ' destek çizgisi (' + T.yukari.dok + ' dokunuş) şu an ' + f(T.yukari.simdi) + ' seviyesinde' + (px < T.yukari.simdi ? '; fiyat çizginin hemen altında, kırılım henüz netleşmedi.' : '.'));
      if (T.asagi) out.push(T.asagi.kirildi != null ? 'Tepeleri birleştiren ' + egimTxt(T.asagi.m, R.atr) + ' direnç çizgisi yukarı kırıldı (çizgi şu an ' + f(T.asagi.simdi) + ').' :
        buyuk(egimTxt(T.asagi.m, R.atr)) + ' direnç çizgisi (' + T.asagi.dok + ' dokunuş) şu an ' + f(T.asagi.simdi) + ' seviyesinde' + (px > T.asagi.simdi ? '; fiyat çizginin hemen üstünde, kırılım henüz netleşmedi.' : '.'));
    }
    // formasyonlar
    var NO = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
    R.formasyonlar.forEach(function (pt, k) {
      var s = (ctx.numara ? (NO[k] || (k + 1) + '.') + ' ' : '') + pt.ad + ' (' + pt.durum + ')';
      if (pt.durum === 'oluşuyor') {
        if (pt.yukari) s += ': yukarı kırılırsa (' + f(pt.yukari.sinir) + ' üstünde kapanış) ölçüm hedefi ' + f(pt.yukari.hedef) + ', aşağı kırılırsa (' + f(pt.asagi.sinir) + ' altı) ' + f(pt.asagi.hedef) + '.';
        else s += ': onay için ' + f(pt.onaySeviye) + ' ' + (pt.d > 0 ? 'üstünde' : 'altında') + ' kapanış gerekir; o zaman ölçüm hedefi ' + f(pt.hedef) + '. ' + f(pt.stop) + ' ' + (pt.d > 0 ? 'altına' : 'üstüne') + ' kapanış formasyonu bozar.';
      } else if (pt.durum === 'onaylandı') {
        s += ': kırılım gerçekleşti; ölçüm hedefi ' + f(pt.hedef) + ' (fiyat ' + f(px) + '), bozulma seviyesi ' + f(pt.stop) + '.';
      } else if (pt.durum === 'hedefe ulaştı') {
        s += ': ölçüm hedefi ' + f(pt.hedef) + ' görüldü; formasyonun hesabı tamamlandı.';
      } else {
        s += ': fiyat ' + f(pt.stop) + ' ' + (pt.d > 0 ? 'altına' : 'üstüne') + ' kapanarak formasyonu bozdu; beklenen yön tutmadı.';
      }
      var g = G && G.tipler && G.tipler[pt.tip];
      if (g && g.n) {
        s += ' Bu varlıkta ' + (G.etiket || ('son ' + G.yil.toLocaleString('tr-TR') + ' yılda')) + ' ' + g.n + ' kez onaylandı; ' + G.ufuk + ' ' + (G.birim || 'işlem günü') + ' içinde önce hedefe ulaşan ' + g.hedef +
          ', önce bozulma seviyesine dönen ' + g.stop + (g.acik ? ', ikisine de ulaşmayan ' + g.acik : '') + '.';
        if (g.oran != null && g.tabanOran != null) {
          var fark = g.oran - g.tabanOran;
          s += g.hedef + g.stop < 8 ? ' Örnek az, sonuç güvenilir değil.' :
            (' Hedefe önce ulaşma %' + yuzde(g.oran) + '; aynı mesafeler için rastgele günlerde %' + yuzde(g.tabanOran) + '. ' + (Math.abs(fark) < 0.07 ? 'Yani bu formasyon burada rastgele bir günden belirgin biçimde daha iyi sonuç vermemiş.' : (fark > 0 ? 'Rastgele günlerden daha iyi sonuç vermiş.' : 'Rastgele günlerden daha kötü sonuç vermiş.')));
        }
      } else if (G) s += ' Bu varlığın geçmişinde bu formasyonun onaylandığı örnek bulunamadı.';
      out.push(s);
    });
    // bölgeler
    function yakin(tur, guclu) {
      return R.bolgeler.filter(function (z) { return z.tur === tur && (!guclu || z.n >= 2); }).sort(function (a, z) { return tur === 'r' ? a.mid - z.mid : z.mid - a.mid; })[0];
    }
    function bTxt(z) { return f(z.lo) + '–' + f(z.hi) + ' (' + z.n + ' dokunuş)'; }
    var icinde = R.bolgeler.filter(function (z) { return z.tur === 'k'; })[0];
    if (icinde) out.push('Fiyat ' + f(icinde.lo) + '–' + f(icinde.hi) + ' bölgesinin içinde; bu bölge geçmişte ' + icinde.n + ' kez dönüş noktası oldu.');
    ['s', 'r'].forEach(function (tur) {
      var z = yakin(tur), g = yakin(tur, true), ad = tur === 's' ? 'destek' : 'direnç';
      if (!z) { out.push('Görünür alanda ' + ad + ' bölgesi yok.'); return; }
      out.push('En yakın ' + ad + ' bölgesi ' + bTxt(z) + (g && g !== z ? '; daha çok sınanmış ' + ad + ' ' + bTxt(g) : '') + '.');
    });
    // Fibonacci
    if (R.fib) {
      var F = R.fib, yakin = F.seviye.slice().sort(function (a, z) { return Math.abs(a.v - px) - Math.abs(z.v - px); })[0];
      out.push('Son büyük ' + (F.yukari ? 'yükselişin' : 'düşüşün') + ' (' + f(F.p1) + ' → ' + f(F.p2) + ') Fibonacci düzeltmesinde fiyata en yakın seviye %' + (yakin.k * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ': ' + f(yakin.v) + '.');
    }
    // uyumsuzluk
    R.uyumsuzluk.forEach(function (d) {
      out.push(d.gosterge + ' ' + d.tur + ' uyumsuzluk: fiyat ' + (d.tur === 'negatif' ? 'daha yüksek tepe yaptı ama ' + d.gosterge + ' daha düşük' : 'daha düşük dip yaptı ama ' + d.gosterge + ' daha yüksek') + '. Bu, hareketin gücünün azaldığını gösterebilir; tek başına dönüş sinyali değildir.');
    });
    // mumlar
    var son = R.mumlar.filter(function (m) { return m.i >= R.end - 2; });
    if (son.length) out.push('Son mumlarda ' + son.map(function (m) { return m.ad.toLocaleLowerCase('tr-TR'); }).join(', ') + ' görüldü. Tek mum formasyonları zayıf işaretlerdir; başka göstergelerle birlikte okunmalı.');
    return out;
  }

  window.GMIFORM = { analyze: analyze, gecmis: gecmis, yorum: yorum, zigzag: zigzag, atr: atrArr, gostergeler: gostergeler, AD: AD, KLASIK: KLASIK, _formasyonlar: formasyonlar, _noktalar: noktalar };
})();
