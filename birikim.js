/* Birikim sekmesi: birikim takibi ve düzenli alım hesabı.
   Birikim: kullanıcının girdiği varlıklar, yalnız bu telefonda (localStorage 'gmi-birikim').
     Bugünkü değer piyasanın alış fiyatıyla (altında Truncgil, dövizde serbest piyasa) hesaplanır; kuyumcu fiyat defterinde
     aynı ürün için kayıt varsa kuyumcunun alışıyla tahmini değer de gösterilir.
   Düzenli alım: Yahoo aylık verisiyle her ayın ilk işlem günü açılışından alım; alış-satış farkı bir kez düşülür.
     Enflasyon karşılaştırması TCMB'nin yayımladığı TÜFE aylık değişim tablosundan (TÜİK verisi). */
(function () {
  'use strict';
  var KEY = 'gmi-birikim', OZ = 31.1034768;
  var TURLER = ['GRAM', 'CEYREK', 'YARIM', 'TAM', 'ATA', 'GUMUS_TL', 'USD', 'EUR'];
  function A() { return window.GMIAPP; }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function num(v, dp) { return A().num(v, dp); }
  function tl(v) { return num(v, 2) + ' TL'; }
  function pct(v) { return A().pct(v, 2); }
  function dirCls(v) { return v > 0.005 ? 'up' : (v < -0.005 ? 'down' : 'flat'); }
  function tarihTxt(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? (+m[3]) + ' ' + A().MON[+m[2] - 1] + ' ' + m[1] : '';
  }

  /* ---------------- birikim ---------------- */
  function liste() { return A().lsGet(KEY, []); }
  function kaydet(l) { A().lsSet(KEY, l); }
  function miktarBirimi(tur) { return (A().VARLIK[tur] || {}).miktar || ''; }

  // Satarken alınacak birim fiyat (piyasa alışı)
  function birimDeger(tur) {
    var f = A().fiyat(tur, 'alis');
    if (!f) return null;
    return { v: f.alis != null ? f.alis : f.v, src: f.src, time: f.time };
  }

  function renderListe() {
    var ol = $('bk-list'), ozet = $('bk-ozet'), l = liste();
    A().clear(ol); A().clear(ozet);
    if (!l.length) {
      ozet.append(el('div', 'card bk-bos', 'Henüz kayıt yok. Aşağıdaki "Varlık ekle" ile elindeki altını ya da dövizi gir.'));
      return;
    }
    var top = 0, topMal = 0, topMalDeger = 0, malYok = 0, degerYok = 0, kaynak = {};
    l.forEach(function (x) {
      var V = A().VARLIK[x.tur] || { ad: x.tur }, bd = birimDeger(x.tur), li = el('li', 'item bk-item');
      var deger = bd ? bd.v * x.miktar : null, mal = x.maliyet ? x.maliyet * x.miktar : null;
      var head = el('div', 'bk-top');
      head.append(el('strong', null, V.ad), el('span', 'pmeta', num(x.miktar, x.miktar % 1 ? 2 : 0) + ' ' + miktarBirimi(x.tur) + (x.not ? ' · ' + x.not : '')));
      li.append(head);
      if (deger != null) {
        top += deger;
        kaynak[bd.src.replace(/^alış · /, '') + (bd.time ? ' ' + bd.time : '')] = 1;
        li.append(el('div', 'bk-deger', tl(deger)));
        li.append(el('div', 'pmeta', 'Birim ' + num(bd.v, x.tur === 'USD' || x.tur === 'EUR' ? 4 : 2) + ' TL (' + bd.src + ')'));
      } else {
        degerYok++;
        li.append(el('div', 'pmeta', 'Bugünkü fiyat alınamadı; değer hesaplanamadı.'));
      }
      if (mal != null) {
        var line = el('div', 'item-detail', 'Alış: ' + num(x.maliyet, 2) + ' TL × ' + num(x.miktar, x.miktar % 1 ? 2 : 0) + ' = ' + tl(mal) + (x.tarih ? ' (' + tarihTxt(x.tarih) + ')' : ''));
        li.append(line);
        if (deger != null) {
          topMal += mal; topMalDeger += deger;
          var kz = deger - mal, kzEl = el('div', 'bk-kz ' + dirCls(kz), (kz >= 0 ? 'Kâr ' : 'Zarar ') + A().sign(kz) + tl(Math.abs(kz)) + ' (' + pct(100 * (deger / mal - 1)) + ')');
          li.append(kzEl);
        }
      } else malYok++;
      var D = window.GMIDEFTER && window.GMIDEFTER.oran ? window.GMIDEFTER.oran(x.tur) : null;
      if (D && deger != null) {
        li.append(el('div', 'pmeta', 'Kuyumcuna satarsan yaklaşık ' + tl(deger * D.oran) + ' (fiyat defteri: ' + D.ad + ', ' + tarihTxt(D.t) + '; piyasa alışının ' + pct(100 * (D.oran - 1)) + ' farkla).'));
      }
      var row = el('div', 'btn-row'), sil = el('button', 'btn btn-sm btn-ghost', 'Sil');
      sil.type = 'button';
      sil.addEventListener('click', function () {
        if (sil.dataset.onay !== '1') { sil.dataset.onay = '1'; sil.textContent = 'Silmek için yeniden dokun'; return; }
        kaydet(liste().filter(function (y) { return y.id !== x.id; }));
        render();
      });
      row.append(sil);
      li.append(row);
      ol.append(li);
    });
    var card = el('div', 'card bk-ozet');
    card.append(el('div', 'pmeta', 'Toplam bugünkü değer'), el('div', 'bk-toplam', tl(top)));
    var usd = A().fiyat('USD', 'satis');
    if (usd && usd.v) card.append(el('div', 'pmeta', '≈ ' + num(top / (usd.satis || usd.v), 0) + ' $ (dolar satış fiyatıyla)'));
    if (topMal > 0) {
      var kz = topMalDeger - topMal;
      card.append(el('div', 'bk-kz ' + dirCls(kz), 'Alış fiyatı girilen kayıtlarda: maliyet ' + tl(topMal) + ' → ' + ((kz >= 0) ? 'kâr ' : 'zarar ') + A().sign(kz) + tl(Math.abs(kz)) + ' (' + pct(100 * (topMalDeger / topMal - 1)) + ')'));
    }
    var notlar = [];
    if (malYok) notlar.push(malYok + ' kayıtta alış fiyatı yok; kâr/zarara katılmadı');
    if (degerYok) notlar.push(degerYok + ' kaydın bugünkü fiyatı alınamadı');
    if (Object.keys(kaynak).length) notlar.push('fiyatlar: ' + Object.keys(kaynak).join('; '));
    if (notlar.length) card.append(el('div', 'pmeta', notlar.join(' · ') + '.'));
    ozet.append(card);
  }

  function formHazirla() {
    var sel = $('bk-tur');
    TURLER.forEach(function (k) { var o = el('option', null, A().VARLIK[k].ad); o.value = k; sel.append(o); });
    var lbl = function () { $('bk-miktar-lbl').textContent = 'Miktar (' + miktarBirimi(sel.value) + ')'; };
    sel.addEventListener('change', lbl); lbl();
    $('bk-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var P = A().parseTr, mik = P($('bk-miktar').value), mal = P($('bk-maliyet').value), msg = $('bk-msg');
      if (!mik || mik <= 0) { msg.textContent = 'Miktarı yaz (ör. 10).'; return; }
      if ($('bk-maliyet').value.trim() && (!mal || mal <= 0)) { msg.textContent = 'Birim alış fiyatını sayı olarak yaz ya da boş bırak.'; return; }
      var bd = birimDeger(sel.value);
      if (mal && bd && (mal / bd.v > 3 || mal / bd.v < 0.05)) { msg.textContent = 'Birim alış fiyatı bugünkü fiyattan çok farklı (' + num(bd.v, 2) + ' TL). Toplam tutarı değil, bir birimin fiyatını yaz.'; return; }
      var l = liste();
      l.push({ id: 'b' + Date.now().toString(36), tur: sel.value, miktar: mik, maliyet: mal || null, tarih: $('bk-tarih').value || '', not: $('bk-not').value.trim() });
      kaydet(l);
      ['bk-miktar', 'bk-maliyet', 'bk-tarih', 'bk-not'].forEach(function (id) { $(id).value = ''; });
      msg.textContent = 'Eklendi.';
      render();
    });
  }

  /* ---------------- düzenli alım hesabı ---------------- */
  var DCA = {
    GRAM: { syms: ['GC=F', 'TRY=X'], f: function (g, u) { return g * u / OZ; }, ad: 'gram altın', kaynak: 'COMEX vadeli ons × USD/TRY (Yahoo, teorik gram)', fark: 1.5, mk: true },
    USD: { syms: ['TRY=X'], f: function (u) { return u; }, ad: 'dolar', kaynak: 'USD/TRY (Yahoo)', fark: 0.5 },
    EUR: { syms: ['EURTRY=X'], f: function (e) { return e; }, ad: 'euro', kaynak: 'EUR/TRY (Yahoo)', fark: 0.5 },
    GUMUS: { syms: ['SI=F', 'TRY=X'], f: function (s, u) { return s * u / OZ; }, ad: 'gram gümüş', kaynak: 'COMEX vadeli gümüş × USD/TRY (Yahoo, teorik gram)', fark: 3 },
    BIST: { syms: ['XU100.IS'], f: function (x) { return x; }, ad: 'BIST 100 endeksi', kaynak: 'BIST 100 fiyat endeksi (Yahoo); temettüler dahil değil', fark: 0.2 }
  };
  function ayKey(t) { var d = new Date((t + 43200) * 1000); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2); }
  function ayTxt(k) { var p = k.split('-'); return A().MON[+p[1] - 1] + ' ' + p[0]; }

  async function aylik(sym) {
    var k = 'gmi-aylik:' + sym, c = A().lsGet(k, null);
    if (c && Date.now() - c.at < 2 * 864e5 && c.b && c.b.length) return c.b;
    var G = window.GMIA;
    if (!G || !G.chart) throw new Error('veri modülü yok');
    var r = await G.chart(sym, '10y', '1mo');
    if (!r || r.err || !r.bars || r.bars.length < 13) {
      if (c && c.b) return c.b;
      throw new Error(sym + ': ' + ((r && r.err) || 'veri yok'));
    }
    var m = {}, order = [];
    r.bars.forEach(function (x) {
      var key = ayKey(x.t);
      if (!m[key]) { m[key] = [key, x.o, x.c]; order.push(key); } else m[key][2] = x.c;
    });
    var b = order.map(function (key) { return m[key]; });
    var lp = r.meta && r.meta.regularMarketPrice;
    if (lp > 0 && b.length) b[b.length - 1][2] = lp;
    A().lsSet(k, { at: Date.now(), b: b });
    return b;
  }

  async function tufe() {
    var c = A().lsGet('gmi-tufe', null);
    if (c && Date.now() - c.at < 5 * 864e5 && c.m) return c;
    var G = window.GMIA;
    try {
      var r = await G.get('https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/Enflasyon+Verileri/Tuketici+Fiyatlari', 20000);
      if (r.status !== 200) return c || null;
      var text = String(r.body).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
      var re = /\b(\d{2})-(\d{4})\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)/g, mm, out = {};
      while ((mm = re.exec(text))) out[mm[2] + '-' + mm[1]] = parseFloat(mm[4].replace(',', '.'));
      var keys = Object.keys(out).sort();
      if (keys.length < 24) return c || null;
      var res = { at: Date.now(), m: out, son: keys[keys.length - 1] };
      A().lsSet('gmi-tufe', res);
      return res;
    } catch (e) { return c || null; }
  }

  async function seri(kod) {
    var D = DCA[kod], parts = [];
    for (var i = 0; i < D.syms.length; i++) parts.push(await aylik(D.syms[i]));
    var maps = parts.map(function (b) { var m = {}; b.forEach(function (x) { m[x[0]] = x; }); return m; });
    var out = [];
    parts[0].forEach(function (x) {
      var row = maps.map(function (m) { return m[x[0]]; });
      if (row.some(function (r) { return !r; })) return;
      var o = D.f.apply(null, row.map(function (r) { return r[1]; })), c = D.f.apply(null, row.map(function (r) { return r[2]; }));
      if (o > 0 && c > 0) out.push({ k: x[0], o: o, c: c });
    });
    return out;
  }

  function hesap(s, ay, tutar, fark, T) {
    var bas = Math.max(0, s.length - ay), P = s[s.length - 1].c, k = 1 - fark / 100;
    var adet = 0, yat = 0, nokta = [];
    // enflasyon: ayın başında yatırılan paranın bugünkü karşılığı = tutar × Π(1 + aylık TÜFE) (o aydan son yayımlanan aya kadar)
    var enfK = null, enfTam = !!T;
    if (T) {
      var keys = Object.keys(T.m).sort(), cum = {}, prod = 1;
      for (var j = keys.length - 1; j >= 0; j--) { prod *= 1 + T.m[keys[j]] / 100; cum[keys[j]] = prod; }
      enfK = function (ayk) {
        if (ayk > T.son) return 1;
        if (cum[ayk] == null) { enfTam = false; return null; }
        return cum[ayk];
      };
    }
    var enfToplam = 0;
    for (var i = bas; i < s.length; i++) {
      adet += tutar / s[i].o; yat += tutar;
      var e = enfK ? enfK(s[i].k) : null;
      if (e != null) enfToplam += tutar * e;
      nokta.push({ k: s[i].k, yat: yat, deger: adet * s[i].c * k });
    }
    return { yat: yat, deger: adet * P * k, tek: yat / s[bas].o * P * k, ay: s.length - bas, bas: s[bas].k, son: s[s.length - 1].k, nokta: nokta,
      enf: enfK && enfTam ? enfToplam : null };
  }

  function cizim(n) {
    var W = 340, H = 150, L = 6, R = 6, Tp = 10, B = 18, ns = 'http://www.w3.org/2000/svg';
    var max = 0;
    n.forEach(function (p) { max = Math.max(max, p.yat, p.deger); });
    if (!(max > 0)) return null;
    var x = function (i) { return L + (W - L - R) * (n.length < 2 ? 0 : i / (n.length - 1)); }, y = function (v) { return Tp + (H - Tp - B) * (1 - v / max); };
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'dca-svg'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Yatırılan tutar ve birikimin değeri, aylara göre');
    function path(key, cls) {
      var d = n.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[key]).toFixed(1); }).join(' ');
      var pe = document.createElementNS(ns, 'path'); pe.setAttribute('d', d); pe.setAttribute('class', cls); svg.append(pe);
    }
    path('yat', 'dca-yat'); path('deger', 'dca-deger');
    [[0, 'start'], [n.length - 1, 'end']].forEach(function (q) {
      var t = document.createElementNS(ns, 'text'); t.setAttribute('x', x(q[0])); t.setAttribute('y', H - 4); t.setAttribute('text-anchor', q[1]); t.setAttribute('class', 'dca-lbl');
      t.textContent = ayTxt(n[q[0]].k); svg.append(t);
    });
    return svg;
  }

  async function dcaHesapla(e) {
    if (e) e.preventDefault();
    var kod = $('dca-varlik').value, D = DCA[kod], P = A().parseTr, msg = $('dca-msg'), out = $('dca-sonuc');
    var tutar = P($('dca-tutar').value), yil = +$('dca-yil').value, fark = $('dca-fark').value.trim() ? P($('dca-fark').value) : D.fark;
    if (!tutar || tutar <= 0) { msg.textContent = 'Aylık tutarı yaz (ör. 2.000).'; return; }
    if (fark == null || fark < 0 || fark > 20) { msg.textContent = 'Alış-satış farkını %0 ile %20 arasında yaz.'; return; }
    msg.textContent = 'Geçmiş fiyatlar alınıyor…';
    A().clear(out);
    var s, T = null;
    try { s = await seri(kod); } catch (err) { msg.textContent = 'Geçmiş fiyatlar alınamadı: ' + (err && err.message ? err.message : err) + '. İnternet bağlantısını kontrol edip yeniden dene.'; return; }
    if (!s || s.length < 13) { msg.textContent = 'Yeterli geçmiş veri yok.'; return; }
    try { T = await tufe(); } catch (err) { T = null; }
    msg.textContent = '';
    var ay = yil * 12, h = hesap(s, ay, tutar, fark, T), card = el('div', 'card dca-card');
    card.append(el('div', 'pname', 'Her ay ' + num(tutar, 0) + ' TL ile ' + D.ad + ' alsaydın (başlangıç ' + ayTxt(h.bas) + ', ' + h.ay + ' alım)'));
    if (h.ay < ay) card.append(el('div', 'pmeta', 'Bu varlık için ' + yil + ' yıllık veri yok; ' + h.ay + ' ay hesaplandı.'));
    var g = 100 * (h.deger / h.yat - 1);
    var grid = el('div', 'dca-grid');
    [['Yatırdığın', tl(h.yat), ''], ['Bugünkü değeri', tl(h.deger), dirCls(g)], ['Getiri', pct(g), dirCls(g)],
      ['Tek seferde başta yatırsaydın', tl(h.tek) + ' (' + pct(100 * (h.tek / h.yat - 1)) + ')', '']].forEach(function (r) {
      var c = el('div', 'dca-cell'); c.append(el('span', 'pmeta', r[0]), el('strong', r[2] ? 'dca-v ' + r[2] : 'dca-v', r[1])); grid.append(c);
    });
    card.append(grid);
    if (h.enf) {
      var fe = 100 * (h.deger / h.enf - 1);
      card.append(el('div', 'item-detail', 'Enflasyona göre: yatırdığın paranın bugünkü karşılığı ' + tl(h.enf) + ' (TÜFE, son yayımlanan ay ' + ayTxt(T.son) + '). Birikimin bunun ' +
        (fe >= 0 ? pct(fe) + ' üstünde: alım gücünü korumuş.' : pct(fe) + ' altında: alım gücünü korumamış.')));
    } else {
      card.append(el('div', 'pmeta', 'Enflasyon karşılaştırması yapılamadı: TÜFE verisi (TCMB) ' + (T ? 'bu dönemin tamamı için bulunamadı.' : 'alınamadı.')));
    }
    var svg = cizim(h.nokta);
    if (svg) {
      card.append(svg);
      var lg = el('div', 'dca-lg');
      lg.append(el('span', 'dca-k dca-k-yat', 'Yatırılan'), el('span', 'dca-k dca-k-deger', 'Birikimin değeri'));
      card.append(lg);
    }
    card.append(el('div', 'pmeta', 'Her ayın ilk işlem günündeki açılış fiyatından alındı; bugünkü değerden alış-satış farkı %' + num(fark, 2) + ' bir kez düşüldü. Fiyat: ' + D.kaynak +
      '. Vergi, komisyon ve saklama masrafı dahil değil. Geçmiş sonuç geleceği göstermez; bu bir hesaptır, öneri değildir.'));
    out.append(card);
  }

  var farkElle = false;
  function farkVarsayilan() {
    if (farkElle) return;
    var kod = $('dca-varlik').value, D = DCA[kod], mk = A().makasGet && A().makasGet();
    var v = D.mk && mk && mk.kayip ? mk.kayip : D.fark;
    $('dca-fark').value = num(v, 2);
    $('dca-fark').title = D.mk && mk && mk.kayip ? 'Alış-satış farkı hesabından (' + mk.tarih + ')' : 'Varsayılan tahmin; kendi bankanın ya da kuyumcunun farkını yaz';
  }

  function render() { if (A() && $('bk-list')) renderListe(); }

  function init() {
    if (!$('bk-form') || !A()) return;
    formHazirla();
    $('dca-form').addEventListener('submit', dcaHesapla);
    $('dca-varlik').addEventListener('change', function () { farkElle = false; farkVarsayilan(); });
    $('dca-fark').addEventListener('input', function () { farkElle = true; });
    document.addEventListener('gmi:makas', farkVarsayilan);
    farkVarsayilan();
    render();
    document.addEventListener('gmi:data', render);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.GMIBIRIKIM = { render: render, hesap: hesap, tufe: tufe, seri: seri };
})();
