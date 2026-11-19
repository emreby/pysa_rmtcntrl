/* Kuyumcu fiyat defteri (İller sekmesi): kullanıcının kuyumculardan öğrendiği alış ve satış fiyatları.
   Kayıt anındaki piyasa fiyatı (Truncgil) da saklanır; böylece kuyumcunun farkı hem kendi içinde hem piyasaya göre görülür.
   Yalnız bu telefonda (localStorage 'gmi-defter'). Birikim sekmesi, kuyumcuya satıştaki tahmini değer için son kaydı kullanır. */
(function () {
  'use strict';
  var LS = 'gmi-defter', MAX = 300;
  var TURLER = [['GRAM', 'Gram altın (24 ayar)'], ['CEYREK', 'Çeyrek altın'], ['YARIM', 'Yarım altın'], ['TAM', 'Tam altın'], ['ATA', 'Cumhuriyet (Ata) altını'], ['B22', '22 ayar bilezik (gram)']];
  var AD = {};
  TURLER.forEach(function (t) { AD[t[0]] = t[1]; });
  function A() { return window.GMIAPP; }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function num(v, dp) { return A().num(v, dp); }
  function liste() { return A().lsGet(LS, []); }
  function kaydet(l) { A().lsSet(LS, l.slice(-MAX)); }
  function zaman() {
    var d = new Date(), p = function (x) { return ('0' + x).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fark(x) { return 100 * (x.satis - x.alis) / x.satis; }

  // Birikim sekmesi için: bu üründe son kaydın kuyumcu alışı / o anki piyasa alışı
  function oran(tur) {
    var l = liste().filter(function (x) { return x.tur === tur && x.piyasa && x.piyasa.alis > 0; });
    if (!l.length) return null;
    var x = l[l.length - 1];
    return { oran: x.alis / x.piyasa.alis, ad: x.ad, t: x.t };
  }

  function renderOzet() {
    var box = $('df-ozet'), l = liste();
    A().clear(box);
    if (!l.length) return;
    var card = el('div', 'card df-ozet'), any = false;
    TURLER.forEach(function (t) {
      var son = {};
      l.forEach(function (x) { if (x.tur === t[0]) son[x.ad.toLocaleLowerCase('tr-TR')] = x; });
      var arr = Object.keys(son).map(function (k) { return son[k]; }).sort(function (a, b) { return fark(a) - fark(b); });
      if (!arr.length) return;
      any = true;
      var line = el('div', 'df-oz-satir');
      line.append(el('strong', null, t[1] + ': '));
      line.append(document.createTextNode(arr.map(function (x) { return x.ad + ' %' + num(fark(x), 2) + ' (' + A().when(x.t).replace(/ \d{2}:\d{2}$/, '') + ')'; }).join(' · ')));
      if (arr.length > 1) line.append(el('div', 'pmeta', 'En düşük fark: ' + arr[0].ad));
      card.append(line);
    });
    if (any) { card.prepend(el('div', 'pmeta', 'Her kuyumcunun son kaydındaki alış-satış farkı (kuyumcunun satışı ile alışı arasındaki boşluk; düşük olan daha az kaybettirir):')); box.append(card); }
  }

  function renderListe() {
    var ol = $('df-list'), l = liste();
    A().clear(ol);
    l.slice().reverse().slice(0, 50).forEach(function (x) {
      var li = el('li', 'item df-item');
      li.append(el('div', 'pmeta', A().when(x.t) + ' · ' + (AD[x.tur] || x.tur)));
      li.append(el('strong', null, x.ad));
      li.append(el('div', 'item-detail', 'Alış ' + num(x.alis, 2) + ' · Satış ' + num(x.satis, 2) + ' TL · fark %' + num(fark(x), 2)));
      if (x.piyasa && x.piyasa.alis && x.piyasa.satis) {
        li.append(el('div', 'pmeta', 'Kayıt anında piyasaya göre (Truncgil ' + (x.piyasa.time || '') + '): alış ' + A().pct(100 * (x.alis / x.piyasa.alis - 1), 2) +
          ', satış ' + A().pct(100 * (x.satis / x.piyasa.satis - 1), 2)));
      }
      if (x.not) li.append(el('div', 'pmeta', x.not));
      var row = el('div', 'btn-row');
      if (x.tur === 'GRAM') {
        var mk = el('button', 'btn btn-sm', 'Alış-satış farkı hesabına aktar');
        mk.type = 'button';
        mk.addEventListener('click', function () { A().makasKaydet(x.alis, x.satis, 'defter: ' + x.ad); $('df-msg').textContent = 'Gram altın alış-satış farkı hesabına aktarıldı (Altın sekmesi).'; });
        row.append(mk);
      }
      var sil = el('button', 'btn btn-sm btn-ghost', 'Sil');
      sil.type = 'button';
      sil.addEventListener('click', function () { kaydet(liste().filter(function (y) { return y.id !== x.id; })); render(); });
      row.append(sil);
      li.append(row);
      ol.append(li);
    });
    var dl = $('df-adlar');
    A().clear(dl);
    var seen = {};
    l.forEach(function (x) { var k = x.ad.toLocaleLowerCase('tr-TR'); if (!seen[k]) { seen[k] = 1; var o = document.createElement('option'); o.value = x.ad; dl.append(o); } });
  }

  function render() { if ($('df-list') && A()) { renderOzet(); renderListe(); } }

  function ekle(e) {
    e.preventDefault();
    var P = A().parseTr, ad = $('df-ad').value.trim(), tur = $('df-tur').value, a = P($('df-alis').value), s = P($('df-satis').value), msg = $('df-msg');
    if (!ad) { msg.textContent = 'Kuyumcunun adını yaz.'; return; }
    if (!a || !s || a <= 0 || s <= 0) { msg.textContent = 'Alış ve satış fiyatını yaz (ör. 5.420 ve 5.560).'; return; }
    if (s < a) { msg.textContent = 'Satış fiyatı alış fiyatından düşük olamaz; yerlerini kontrol et.'; return; }
    if ((s - a) / s > 0.2) { msg.textContent = 'Fark %20\'den büyük çıktı; fiyatları kontrol et.'; return; }
    var f = tur === 'B22' ? null : A().fiyat(tur, 'alis');
    if (f && f.alis && (a / f.alis > 1.5 || a / f.alis < 0.5)) { msg.textContent = 'Fiyat piyasadan çok farklı (piyasa alışı ' + num(f.alis, 2) + ' TL). Ürünü ve fiyatı kontrol et.'; return; }
    var l = liste();
    l.push({ id: 'd' + Date.now().toString(36), t: zaman(), ad: ad, tur: tur, alis: a, satis: s, piyasa: f ? { alis: f.alis, satis: f.satis, time: f.time || '' } : null, not: $('df-not').value.trim() });
    kaydet(l);
    ['df-alis', 'df-satis', 'df-not'].forEach(function (id) { $(id).value = ''; });
    msg.textContent = 'Kaydedildi: fark %' + num(100 * (s - a) / s, 2) + '.';
    render();
    if (window.GMIBIRIKIM) window.GMIBIRIKIM.render();
  }

  function init() {
    if (!$('df-form') || !A()) return;
    var sel = $('df-tur');
    TURLER.forEach(function (t) { var o = el('option', null, t[1]); o.value = t[0]; sel.append(o); });
    $('df-form').addEventListener('submit', ekle);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.GMIDEFTER = { oran: oran, render: render, liste: liste };
})();
