/* Bağımlılıksız kaygan harita: OpenStreetMap standart karoları, konum noktası ve numaralı işaretler.
   OSM karo kullanım koşulları: atıf haritanın üstünde görünür; yalnız ekrandaki karolar indirilir (önden ya da toplu indirme yok);
   önbellek başlıklarına WebView uyar; istekler uygulamanın adını taşıyan User-Agent ile gider (MainActivity).
   GMIMAP.create(kutu, { lat, lon, z, onSelect(i) }) → { setUser, setMarkers, select, fit, center, redraw } */
(function () {
  'use strict';
  var TILE = 256, MINZ = 3, MAXZ = 19, SRC = 'https://tile.openstreetmap.org/';

  function worldSize(z) { return TILE * Math.pow(2, z); }
  function lon2x(lon, z) { return (lon + 180) / 360 * worldSize(z); }
  function lat2y(lat, z) {
    var r = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * worldSize(z);
  }
  function x2lon(x, z) { return x / worldSize(z) * 360 - 180; }
  function y2lat(y, z) { var n = Math.PI - 2 * Math.PI * y / worldSize(z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }
  function metersPerPx(lat, z) { return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z); }
  function div(cls) { var d = document.createElement('div'); d.className = cls; return d; }
  function button(text, label, cls) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label);
    if (cls) b.className = cls;
    return b;
  }
  function move(node, x, y) { node.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; }

  function create(box, o) {
    o = o || {};
    var st = { lat: o.lat, lon: o.lon, z: Math.max(MINZ, Math.min(MAXZ, o.z || 15)), user: null, marks: [], sel: null };
    box.innerHTML = '';
    box.classList.add('gmap');
    var tiles = div('gmap-tiles'), layer = div('gmap-layer'), ctl = div('gmap-ctl'), attr = div('gmap-attr');
    var zin = button('+', 'Yakınlaştır'), zout = button('−', 'Uzaklaştır'), me = button('◎', 'Konumuma dön');
    ctl.append(zin, zout, me);
    attr.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıda bulunanlar';
    box.append(tiles, layer, ctl, attr);
    var imgs = {}, raf = 0;

    function view() {
      var w = box.clientWidth || 320, h = box.clientHeight || 300;
      return { x: lon2x(st.lon, st.z) - w / 2, y: lat2y(st.lat, st.z) - h / 2, w: w, h: h };
    }
    function draw() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      var V = view(), n = Math.pow(2, st.z), keep = {};
      var x0 = Math.floor(V.x / TILE), x1 = Math.floor((V.x + V.w) / TILE);
      var y0 = Math.max(0, Math.floor(V.y / TILE)), y1 = Math.min(n - 1, Math.floor((V.y + V.h) / TILE));
      for (var tx = x0; tx <= x1; tx++) {
        for (var ty = y0; ty <= y1; ty++) {
          var key = st.z + '/' + (((tx % n) + n) % n) + '/' + ty, slot = key + '@' + tx, im = imgs[slot];
          if (!im) {
            im = document.createElement('img');
            im.alt = ''; im.draggable = false; im.decoding = 'async'; im.className = 'gmap-tile';
            im.onerror = function () { this.classList.add('gmap-tile-err'); };
            im.src = SRC + key + '.png';
            tiles.append(im); imgs[slot] = im;
          }
          move(im, tx * TILE - V.x, ty * TILE - V.y);
          keep[slot] = 1;
        }
      }
      Object.keys(imgs).forEach(function (k) { if (!keep[k]) { imgs[k].remove(); delete imgs[k]; } });
      drawLayer(V);
    }
    function later() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; draw(); }); }
    function pos(lat, lon, V) { return { x: lon2x(lon, st.z) - V.x, y: lat2y(lat, st.z) - V.y }; }

    function drawLayer(V) {
      layer.innerHTML = '';
      if (st.user) {
        var u = pos(st.user.lat, st.user.lon, V), r = st.user.acc ? st.user.acc / metersPerPx(st.user.lat, st.z) : 0;
        if (r > 8 && r < 2000) { var c = div('gmap-acc'); c.style.width = c.style.height = 2 * r + 'px'; move(c, u.x - r, u.y - r); layer.append(c); }
        var dot = div('gmap-me'); dot.setAttribute('aria-label', 'Konumun'); move(dot, u.x, u.y); layer.append(dot);
      }
      // en yakın (1 numara) en üstte kalsın diye sondan başa çizilir
      for (var i = st.marks.length - 1; i >= 0; i--) pin(i, V);
      var sm = st.sel != null ? st.marks[st.sel] : null;
      if (sm) {
        var q = pos(sm.lat, sm.lon, V), pop = div('gmap-pop'), inner = document.createElement('span');
        var t = document.createElement('span'), sub = document.createElement('span');
        inner.className = 'gmap-pop-in';
        t.className = 'gmap-pop-t';
        t.textContent = (st.sel + 1) + '. ' + (sm.name || 'Kuyumcu');
        sub.className = 'gmap-pop-s';
        if (sm.dist) sub.append(sm.dist);
        if (sm.url) {
          var a = document.createElement('a');
          a.href = sm.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Yol tarifi ↗';
          sub.append(a);
        }
        inner.append(t, sub);
        pop.append(inner);
        move(pop, q.x, q.y);
        layer.append(pop);
        // kutucuk haritanın dışına taşmasın ve sağ üstteki düğmelerin altında kalmasın:
        // işaret üst kenara yakınsa altına konur, yatayda harita (ve gerekirse düğmeler) sınırına çekilir
        var w = inner.offsetWidth, h = inner.offsetHeight, below = q.y < h + 50;
        if (below) inner.classList.add('below');
        var top = below ? q.y + 10 : q.y - 40 - h, right = V.w - 8 - (top < ctl.offsetTop + ctl.offsetHeight + 6 ? ctl.offsetWidth + 8 : 0);
        inner.style.left = Math.round(Math.max(8 - q.x, Math.min(right - q.x - w, -w / 2))) + 'px';
      }
    }
    function pin(i, V) {
      var m = st.marks[i], p = pos(m.lat, m.lon, V);
      if (p.x < -40 || p.y < -10 || p.x > V.w + 40 || p.y > V.h + 50) return;
      var b = button(String(i + 1), (i + 1) + '. ' + (m.name || 'Kuyumcu'), 'gmap-pin' + (st.sel === i ? ' sel' : ''));
      move(b, p.x, p.y);
      b.addEventListener('click', function (e) { e.stopPropagation(); select(i, true); });
      layer.append(b);
    }
    function select(i, fromMap) {
      st.sel = i;
      var m = st.marks[i];
      if (m && !fromMap) { st.lat = m.lat; st.lon = m.lon; if (st.z < 16) st.z = 16; }
      draw();
      if (fromMap && o.onSelect) o.onSelect(i);
    }
    function zoom(d) { var z = Math.max(MINZ, Math.min(MAXZ, st.z + d)); if (z !== st.z) { st.z = z; draw(); } }
    function center() { if (st.user) { st.lat = st.user.lat; st.lon = st.user.lon; draw(); } }
    function pan(dx, dy) {
      var x = lon2x(st.lon, st.z) - dx, y = lat2y(st.lat, st.z) - dy;
      st.lon = ((x2lon(x, st.z) + 540) % 360) - 180;
      st.lat = Math.max(-85, Math.min(85, y2lat(y, st.z)));
      later();
    }

    zin.addEventListener('click', function () { zoom(1); });
    zout.addEventListener('click', function () { zoom(-1); });
    me.addEventListener('click', center);

    // tek parmakla kaydırma, iki parmakla yakınlaştırma, boş yere dokununca seçimi kapatma
    var pts = {}, pinch = null, moved = 0;
    function count() { return Object.keys(pts).length; }
    function gap() { var k = Object.keys(pts); return Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y); }
    box.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button, a')) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count() === 1) moved = 0;
      try { box.setPointerCapture(e.pointerId); } catch (err) { /* yok say */ }
      if (count() === 2) pinch = gap();
    });
    box.addEventListener('pointermove', function (e) {
      var p = pts[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (count() === 1) pan(dx, dy);
      p.x = e.clientX; p.y = e.clientY;
      if (count() === 2 && pinch) {
        var g = gap();
        if (g / pinch > 1.6) { zoom(1); pinch = g; } else if (g / pinch < 0.62) { zoom(-1); pinch = g; }
      }
    });
    function up(e) {
      if (!pts[e.pointerId]) return;
      var single = count() === 1;
      delete pts[e.pointerId];
      if (count() < 2) pinch = null;
      if (single && e.type === 'pointerup' && moved < 8 && st.sel != null) { st.sel = null; draw(); }
    }
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    if (window.ResizeObserver) new ResizeObserver(later).observe(box); else window.addEventListener('resize', later);

    // konumu ve en yakın n işareti sığdıran en yakın ölçek (uzaktakiler için uzaklaştırılır)
    function fit(n) {
      if (!st.marks.length) { if (st.user) { st.lat = st.user.lat; st.lon = st.user.lon; st.z = 15; } draw(); return; }
      var all = st.marks.slice(0, n || 5);
      if (st.user) all.push(st.user);
      var w = (box.clientWidth || 320) - 60, h = (box.clientHeight || 300) - 80;
      for (var z = 17; z >= MINZ; z--) {
        var xs = all.map(function (m) { return lon2x(m.lon, z); }), ys = all.map(function (m) { return lat2y(m.lat, z); });
        var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
        if ((maxX - minX <= w && maxY - minY <= h) || z === MINZ) {
          st.z = z; st.lon = x2lon((minX + maxX) / 2, z); st.lat = y2lat((minY + maxY) / 2 - 12, z);
          break;
        }
      }
      draw();
    }

    draw();
    return {
      setUser: function (lat, lon, acc) { st.user = { lat: lat, lon: lon, acc: acc }; draw(); },
      setMarkers: function (list) { st.marks = list || []; st.sel = null; draw(); },
      select: function (i) { select(i, false); },
      fit: fit,
      center: center,
      redraw: draw
    };
  }

  window.GMIMAP = { create: create };
})();
