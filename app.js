/* GMI Piyasa — mobil uygulama (PWA). Veri: data/app_data.json (şema gmi-app/1). */
(function () {
  'use strict';
  var CFG = window.GMI_CONFIG || {};
  var VERSION = '1.0.0';
  var MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  var VIEWS = ['piyasa', 'altin', 'teknik', 'gundem', 'karne'];
  var state = { data: null, fetchedAt: 0, offline: false, loading: false };
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
    renderHeader(); renderAlerts(); renderPrices(); renderGold(); renderTech(); renderAgenda(); renderPerf(); renderBanner();
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
    var gen = Date.parse((state.data && state.data.generated_at) || '');
    if (isFinite(gen)) {
      var h = (Date.now() - gen) / 36e5;
      if (h > (CFG.staleHours || 12)) msgs.push('Veriler ' + Math.round(h) + ' saattir güncellenmedi. Hafta sonu ya da bilgisayarınız kapalıyken seanslar çalışmaz.');
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
  function scoreCls(v) { return v == null ? '' : (v >= 3 ? 'up' : (v <= -3 ? 'down' : 'flat')); }

  function renderTech() {
    var tb = clear($('tech').tBodies[0]);
    rows('tech').slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (r) {
      var tr = el('tr');
      tr.append(td(r.name), td(scoreTxt(r.daily_score), scoreCls(r.daily_score)), td(scoreTxt(r.short_score), scoreCls(r.short_score)),
        td(num(r.rsi, 1)), td(num(r.s1, r.dp)), td(num(r.r1, r.dp)), td(r.trend || '—', 'wrap'));
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
  function openSheet() { $('sheet').hidden = false; $('sheet-bg').hidden = false; refreshPushStatus(); }
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
        $('push-code').value = JSON.stringify(sub);
        $('push-box').hidden = false;
      } else {
        st.textContent = 'Bildirimler kapalı. Açmak için düğmeye dokunun.';
      }
    }).catch(function () { st.textContent = 'Bildirim durumu okunamadı.'; });
  }
  function enablePush() {
    if (!pushSupported()) { refreshPushStatus(); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { refreshPushStatus(); return null; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(CFG.vapidPublicKey) });
        });
      });
    }).then(function (sub) {
      if (!sub) return;
      $('push-code').value = JSON.stringify(sub);
      $('push-box').hidden = false;
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
  $('ver').textContent = 'Sürüm ' + VERSION;
  if (isStandalone()) $('install-text').textContent = 'Uygulama bu telefonda yüklü.';

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); installEvt = e; $('btn-install').hidden = false; renderBanner();
  });
  window.addEventListener('appinstalled', function () { installEvt = null; $('btn-install').hidden = true; renderBanner(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - state.fetchedAt > (CFG.autoRefreshMinutes || 5) * 6e4) load();
  });
  var resizeT = null;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (!$('v-altin').hidden) renderLadder(); }, 200); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  show(location.hash.slice(1));
  load();
})();
