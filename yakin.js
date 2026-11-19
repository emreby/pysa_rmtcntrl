/* İller sekmesi: konumu haritada gösterir, çevredeki kuyumcuları işaretler, bulunulan ilin kuyumcular odasını eşler.
   Veri: OpenStreetMap. Tek bir Overpass isteği hem kuyumcuları (shop=jewelry, craft=jeweller) hem de noktanın
   bulunduğu il ve ilçe sınırını (admin_level 4 ve 6) getirir; ayrıca adres servisi kullanılmaz.
   Konum yalnız kullanıcı düğmeye basınca alınır ve saklanmaz; arama servisine ~100 m'ye yuvarlanmış konum gider. */
(function () {
  'use strict';
  var OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  var LIMIT = 1500, SHOW = 60;
  var S = { r: 3000, pos: null, list: [], total: 0, place: null, map: null, busy: false, again: false };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function link(url, text, cls) { var a = el('a', cls || 'btn btn-sm btn-ghost', text + ' ↗'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function trNum(v, dp) { return v.toLocaleString('tr-TR', { maximumFractionDigits: dp, minimumFractionDigits: 0 }); }
  function meters(a, b) {
    var R = 6371000, k = Math.PI / 180, dLa = (b.lat - a.lat) * k, dLo = (b.lon - a.lon) * k;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function fmtDist(m) { return m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : trNum(m / 1000, m < 10000 ? 1 : 0) + ' km'; }
  function timeout(ms) {
    if (typeof AbortController === 'undefined') return undefined;
    var c = new AbortController(); setTimeout(function () { c.abort(); }, ms); return c.signal;
  }
  var DAYS = { Mo: 'Pzt', Tu: 'Sal', We: 'Çar', Th: 'Per', Fr: 'Cum', Sa: 'Cmt', Su: 'Paz', PH: 'resmî tatil' };
  function hours(s) {
    return String(s || '').replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, function (d) { return DAYS[d]; })
      .replace(/\boff\b/g, 'kapalı').replace(/\s*;\s*/g, '; ');
  }
  function bare(s) { return String(s || '').replace(/\s+(İli|ili|Province)$/, '').trim(); }
  function norm(s) {
    return bare(s).toLocaleLowerCase('tr-TR')
      .replace(/[âà]/g, 'a').replace(/[îıì]/g, 'i').replace(/[ûü]/g, 'u').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ş/g, 's')
      .replace(/[^a-z]/g, '');
  }

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

  function query(lat, lon, r) {
    var p = r3(lat) + ',' + r3(lon), a = '(around:' + r + ',' + p + ')';
    return '[out:json][timeout:25];' +
      'is_in(' + p + ')->.a;area.a["boundary"="administrative"]["admin_level"~"^(4|6)$"];out tags;' +
      '(node["shop"="jewelry"]' + a + ';way["shop"="jewelry"]' + a + ';node["craft"="jeweller"]' + a + ';way["craft"="jeweller"]' + a + ';);' +
      'out center tags ' + LIMIT + ';';
  }
  function parse(j) {
    var out = { list: [], il: null, ilce: null }, seen = {};
    (j.elements || []).forEach(function (e) {
      var t = e.tags || {};
      if (e.type === 'area') {
        var nm = bare(t['name:tr'] || t.name);
        if (t.admin_level === '4' && !out.il) out.il = nm;
        else if (t.admin_level === '6' && !out.ilce) out.ilce = nm;
        return;
      }
      var la = e.lat != null ? e.lat : (e.center && e.center.lat), lo = e.lon != null ? e.lon : (e.center && e.center.lon);
      var k = e.type + '/' + e.id;
      if (la == null || lo == null || seen[k]) return;
      seen[k] = 1;
      out.list.push({ id: k, lat: la, lon: lo, name: t.name || t['name:tr'] || t.brand || '', tags: t });
    });
    return out;
  }
  async function overpass(lat, lon, r) {
    var q = query(lat, lon, r), last = null;
    for (var i = 0; i < OVERPASS.length; i++) {
      try {
        var resp = await fetch(OVERPASS[i] + '?data=' + encodeURIComponent(q), { signal: timeout(35000) });
        if (!resp.ok) { last = new Error('HTTP ' + resp.status); continue; }
        var j = await resp.json();
        if (j.remark && /error/i.test(j.remark)) { last = new Error(j.remark); continue; }
        return parse(j);
      } catch (err) { last = err; }
    }
    throw last || new Error('Overpass');
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
      card.append(el('div', 'item-detail', 'Bu ilde ' + c.o.oda + ' var, ancak internette yayımladığı bir fiyat listesi bulunamadı. Fiyatı kuyumcuya sormak gerekiyor.'));
    } else {
      card.append(el('div', 'item-detail', P.il + ' için kuyumcular odası fiyat bilgisi bu listede yok. Fiyatı kuyumcuya sormak gerekiyor.'));
    }
    if (c.iko) card.append(el('div', 'pmeta', 'Bu ildeki bazı kuyumcular İKO fiyat ekranını kullanıyor (Anadolu Ajansı, 2023; güncel olmayabilir).'));
    if (row.firstChild) card.append(row);
    box.append(card);
  }

  function renderList() {
    var ol = $('yk-list');
    ol.innerHTML = '';
    S.list.forEach(function (m, i) {
      var li = el('li', 'item yk-item'), top = el('div', 'yk-top'), t = m.tags;
      li.id = 'yk-' + i;
      top.append(el('span', 'yk-no', String(i + 1)), el('strong', 'yk-name', m.name || 'Adı girilmemiş kuyumcu'), el('span', 'pmeta yk-dist', m.dist));
      li.append(top);
      var adr = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || t['addr:full'] || '';
      if (adr) li.append(el('div', 'item-detail', adr));
      if (t.opening_hours) li.append(el('div', 'pmeta', 'Çalışma saatleri (haritadaki kayıt): ' + hours(t.opening_hours)));
      if (/biju|bijou|aksesuar|accessor/i.test(m.name)) li.append(el('div', 'pmeta', 'Adına göre bijuteri ya da aksesuar dükkânı olabilir.'));
      var row = el('div', 'btn-row');
      row.append(link(m.url, 'Yol tarifi', 'btn btn-sm'));
      var show = el('button', 'btn btn-sm btn-ghost', 'Haritada göster');
      show.type = 'button';
      show.addEventListener('click', function () { S.map.select(i); $('yk-map').scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      row.append(show);
      var tel = t.phone || t['contact:phone'] || t['contact:mobile'];
      if (tel) row.append(link('tel:' + String(tel).split(/[;,]/)[0].replace(/[^\d+]/g, ''), 'Ara'));
      li.append(row);
      ol.append(li);
    });
  }

  function onPin(i) {
    Array.prototype.forEach.call(document.querySelectorAll('.yk-item.sel'), function (x) { x.classList.remove('sel'); });
    var li = $('yk-' + i);
    if (li) li.classList.add('sel');
  }

  function renderLinks(P) {
    var box = $('yk-links');
    box.innerHTML = '';
    box.append(link('https://www.google.com/maps/search/kuyumcu/@' + r3(P.lat) + ',' + r3(P.lon) + ',15z', 'Google Haritalar\'da ara'));
    box.append(link('https://www.openstreetmap.org/fixthemap?lat=' + r3(P.lat) + '&lon=' + r3(P.lon) + '&zoom=17', 'Eksik kuyumcuyu bildir'));
  }

  async function search(relocate) {
    if (S.busy) { S.again = true; return; }
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
      $('yk-map').hidden = false;
      $('yk-r').hidden = false;
      if (!S.map) S.map = window.GMIMAP.create($('yk-map'), { lat: P.lat, lon: P.lon, z: 15, onSelect: onPin });
      S.map.setUser(P.lat, P.lon, P.acc);
      renderLinks(P);
      status('Çevredeki kuyumcular aranıyor…');
      var res;
      try { res = await overpass(P.lat, P.lon, S.r); } catch (e) {
        S.list = []; S.total = 0; S.map.setMarkers([]); S.map.fit(); renderList();
        status('Kuyumcu listesi alınamadı: OpenStreetMap arama servisi yanıt vermedi. Biraz sonra yeniden dene ya da Google Haritalar\'da ara.');
        return;
      }
      if (res.il) S.place = { il: res.il, ilce: res.ilce };
      renderPlace();
      res.list.forEach(function (m) {
        m.m = meters(P, m);
        m.dist = fmtDist(m.m);
        m.url = 'https://www.google.com/maps/dir/?api=1&destination=' + m.lat + ',' + m.lon;
      });
      res.list.sort(function (a, b) { return a.m - b.m; });
      S.total = res.list.length;
      S.list = res.list.slice(0, SHOW);
      S.map.setMarkers(S.list.map(function (m) { return { lat: m.lat, lon: m.lon, name: m.name || 'Adı girilmemiş kuyumcu', dist: m.dist, url: m.url }; }));
      S.map.fit();
      renderList();
      var R = fmtDist(S.r), acc = P.acc ? ' Konum doğruluğu ±' + fmtDist(P.acc) + '.' : '';
      if (P.acc > 1000) acc += ' Konum yaklaşık; daha doğru sonuç için uygulamanın konum izninde "tam konum"u aç.';
      var msg = S.total
        ? R + ' içinde haritada kayıtlı ' + S.total + (S.total >= LIMIT ? '+' : '') + ' kuyumcu bulundu' + (S.total > SHOW ? '; en yakın ' + SHOW + ' tanesi gösteriliyor' : '') + '.'
        : R + ' içinde haritada kayıtlı kuyumcu yok. Daha geniş bir alan seçebilir ya da Google Haritalar\'da arayabilirsin.';
      if (S.total >= LIMIT) msg += ' Bu alanda çok fazla kayıt var; en yakınları kaçırmamak için daha küçük bir alan seç.';
      status(msg + acc);
    } finally {
      S.busy = false;
      btn.disabled = false;
      btn.textContent = S.pos ? 'Konumu yenile' : 'Konumumu göster';
      if (S.again) { S.again = false; setTimeout(function () { search(false); }, 0); }
    }
  }

  function init() {
    if (!$('yk-btn')) return;
    $('yk-btn').addEventListener('click', function () { search(true); });
    $('yk-ayar').addEventListener('click', function () { try { window.GMI_NATIVE.openAppSettings(); } catch (e) { /* eski sürüm */ } });
    var chips = document.querySelectorAll('#yk-r button');
    Array.prototype.forEach.call(chips, function (b) {
      b.addEventListener('click', function () {
        S.r = +b.getAttribute('data-r');
        Array.prototype.forEach.call(chips, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        if (S.pos) search(false);
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.GMIYAKIN = { search: search, _query: query, _parse: parse, _norm: norm, _chamberFor: chamberFor };
})();
