/* İller sekmesi: konumu Google Haritalar'da gösterir, çevredeki kuyumcuları arar ve bulunulan ilin kuyumcular odasını eşler.
   Harita: Google Haritalar'ın "Haritayı yerleştir" biçimi (API anahtarı gerektirmez). Kuyumcuların adı, saati ve
   yorumları Google'dan gelir; uygulama bunları okumaz ya da saklamaz.
   İl ve ilçe: telefonun adres servisi (Android Geocoder; Google hizmetli telefonlarda Google).
   Konum yalnız kullanıcı düğmeye basınca alınır ve saklanmaz; Google'a ~100 m'ye yuvarlanmış konum gider. */
(function () {
  'use strict';
  var S = { pos: null, place: null, z: 9000, busy: false, geoSeq: 0 };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function link(url, text, cls) { var a = el('a', cls || 'btn btn-sm btn-ghost', text + ' ↗'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function trNum(v, dp) { return v.toLocaleString('tr-TR', { maximumFractionDigits: dp, minimumFractionDigits: 0 }); }
  function fmtDist(m) { return m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : trNum(m / 1000, m < 10000 ? 1 : 0) + ' km'; }
  function bare(s) { return String(s || '').replace(/\s+(İli|ili|Province)$/, '').trim(); }
  function norm(s) {
    return bare(s).toLocaleLowerCase('tr-TR')
      .replace(/[âà]/g, 'a').replace(/[îıì]/g, 'i').replace(/[ûü]/g, 'u').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ş/g, 's')
      .replace(/[^a-z]/g, '');
  }

  // Google Haritalar'ın kendi "Haritayı yerleştir" özelliğinin ürettiği biçim: arama ("kuyumcu"), merkez ve görüş mesafesi (m).
  function embedUrl(lat, lon, dist) {
    return 'https://www.google.com/maps/embed?pb=!1m16!1m12!1m3!1d' + dist + '!2d' + r3(lon) + '!3d' + r3(lat) +
      '!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!2m1!1skuyumcu!5e0!3m2!1str!2str!4v' + Date.now() + '!5m2!1str!2str';
  }
  function searchUrl(lat, lon) { return 'https://www.google.com/maps/search/kuyumcu/@' + r3(lat) + ',' + r3(lon) + ',15z'; }

  // ilk basışta bir dakikalık kayıtlı konum yeter; "Konumu yenile" her zaman taze konum ister
  function locate(fresh) {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) { rej({ code: 0 }); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy });
      }, rej, { enableHighAccuracy: true, timeout: 20000, maximumAge: fresh ? 0 : 60000 });
    });
  }
  function locErr(e) {
    var c = e && e.code;
    if (c === 1) return 'Konum izni verilmedi. Telefonun ayarlarında bu uygulamaya konum izni verip yeniden dene.';
    if (c === 2) return 'Konum bulunamadı. Telefonun konum (GPS) ayarı açık mı?';
    if (c === 3) return 'Konum zamanında alınamadı. Konum ayarı açıkken, mümkünse açık bir yerde yeniden dene.';
    return 'Bu cihazda konum alınamıyor.';
  }

  // il ve ilçe: telefonun adres servisi (yalnız Android uygulamasında)
  var geoWait = {};
  window.__gmiGeo = function (id, o) { var cb = geoWait[id]; if (cb) { delete geoWait[id]; cb(o); } };
  function geocode(lat, lon) {
    var N = window.GMI_NATIVE;
    if (!N || typeof N.geocode !== 'function') return Promise.resolve(null);
    return new Promise(function (res) {
      var id = 'g' + (++S.geoSeq);
      geoWait[id] = function (o) { res(o && o.ok && o.il ? { il: bare(o.il), ilce: o.ilce ? bare(o.ilce) : null } : null); };
      try { N.geocode(id, lat, lon); } catch (e) { delete geoWait[id]; res(null); return; }
      setTimeout(function () { if (geoWait[id]) { delete geoWait[id]; res(null); } }, 15000);
    });
  }

  function chamberFor(il) {
    var L = window.GMIILLER, k = norm(il), out = { o: null, kind: null, iko: false };
    if (!L || !k) return out;
    [['yayinlayan', 'yayin'], ['uygulama', 'app'], ['bulunamayan', 'yok']].forEach(function (g) {
      (L[g[0]] || []).forEach(function (o) { if (!out.o && norm(o.il) === k) { out.o = o; out.kind = g[1]; } });
    });
    out.iko = !!(L.ikoEkran && L.ikoEkran.iller.some(function (x) { return norm(x) === k; }));
    return out;
  }

  function status(t, denied) {
    $('yk-durum').textContent = t || '';
    var b = $('yk-ayar'), N = window.GMI_NATIVE;
    b.hidden = !(denied && N && typeof N.openAppSettings === 'function');
  }

  function renderPlace() {
    var box = $('yk-il');
    box.innerHTML = '';
    if (!S.place || !S.place.il) return;
    var P = S.place, c = chamberFor(P.il), card = el('div', 'card yk-ilcard'), row = el('div', 'btn-row');
    card.append(el('div', 'pname', 'Bulunduğun yer: ' + P.il + (P.ilce && norm(P.ilce) !== norm(P.il) ? ', ' + P.ilce : '')));
    if (c.kind === 'yayin') {
      card.append(el('div', 'item-detail', c.o.oda + ' günlük tavsiye fiyat listesini internette yayımlıyor. Fiyatlar uygulamaya çekilmez; resmî sayfa tarayıcıda açılır.'));
      row.append(link(c.o.url, c.o.urlTxt || 'Fiyatları aç', 'btn btn-sm'));
    } else if (c.kind === 'app') {
      card.append(el('div', 'item-detail', c.o.oda + ' fiyatları kendi mobil uygulamalarında gösteriyor.'));
      (c.o.ek || []).forEach(function (e) { row.append(link(e.url, e.t)); });
    } else if (c.kind === 'yok') {
      card.append(el('div', 'item-detail', 'Bu ilde ' + c.o.oda + ' var, ancak internette yayımladığı bir fiyat listesi bulunamadı. Fiyatı kuyumcuya sormak gerekiyor; sorduğun fiyatları aşağıdaki fiyat defterine kaydedebilirsin.'));
    } else {
      card.append(el('div', 'item-detail', P.il + ' için kuyumcular odası fiyat bilgisi bu listede yok. Fiyatı kuyumcuya sormak gerekiyor; sorduğun fiyatları aşağıdaki fiyat defterine kaydedebilirsin.'));
    }
    if (c.iko) card.append(el('div', 'pmeta', 'Bu ildeki bazı kuyumcular İKO fiyat ekranını kullanıyor (Anadolu Ajansı, 2023; güncel olmayabilir).'));
    if (row.firstChild) card.append(row);
    box.append(card);
  }

  function drawMap() {
    var P = S.pos, box = $('yk-map');
    if (!P) return;
    box.hidden = false;
    var f = box.querySelector('iframe');
    if (!f) {
      f = document.createElement('iframe');
      f.title = 'Google Haritalar: yakındaki kuyumcular';
      f.setAttribute('loading', 'lazy');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      box.append(f);
    }
    f.src = embedUrl(P.lat, P.lon, S.z);
    var links = $('yk-links');
    links.innerHTML = '';
    links.append(link(searchUrl(P.lat, P.lon), 'Google Haritalar\'da aç', 'btn btn-sm'));
  }

  async function show(relocate) {
    if (S.busy) return;
    S.busy = true;
    var btn = $('yk-btn');
    btn.disabled = true;
    try {
      if (relocate || !S.pos) {
        status('Konum alınıyor…');
        try { S.pos = await locate(!!S.pos); } catch (e) { status(locErr(e), e && e.code === 1); return; }
        S.place = null;
      }
      var P = S.pos;
      $('yk-z').hidden = false;
      drawMap();
      var acc = P.acc ? 'Konum doğruluğu ±' + fmtDist(P.acc) + '.' : '';
      if (P.acc > 1000) acc += ' Konum yaklaşık; daha doğru sonuç için uygulamanın konum izninde "tam konum"u aç.';
      status('Harita, bu konumun çevresinde Google Haritalar\'ın "kuyumcu" aramasını gösterir; bir işarete dokununca adı, saati ve yol tarifi çıkar. Harita yüklenmezse "Google Haritalar\'da aç" düğmesini kullan. ' + acc);
      if (!S.place) {
        S.place = await geocode(P.lat, P.lon);
        renderPlace();
      }
    } finally {
      S.busy = false;
      btn.disabled = false;
      btn.textContent = S.pos ? 'Konumu yenile' : 'Konumumu göster';
    }
  }

  function init() {
    if (!$('yk-btn')) return;
    $('yk-btn').addEventListener('click', function () { show(true); });
    $('yk-ayar').addEventListener('click', function () { try { window.GMI_NATIVE.openAppSettings(); } catch (e) { /* eski sürüm */ } });
    var chips = document.querySelectorAll('#yk-z button');
    Array.prototype.forEach.call(chips, function (b) {
      b.addEventListener('click', function () {
        S.z = +b.getAttribute('data-z');
        Array.prototype.forEach.call(chips, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        drawMap();
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.GMIYAKIN = { show: show, embedUrl: embedUrl, chamberFor: chamberFor, norm: norm };
})();
