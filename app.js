/* GMI Piyasa — mobil uygulama. Android'de veriyi telefon çeker ve analizi telefonda yapar (analysis.js);
   web sürümü data/app_data.json dosyasını okur. */
(function () {
  'use strict';
  var CFG = window.GMI_CONFIG || {};
  var VERSION = '2.6.2';
  var NATIVE = window.GMI_NATIVE || null;
  var GA = window.GMIA || null;
  var USE_PHONE = !!(NATIVE && GA);
  var SIG_CLS = { GAL: 'sg-gal', AL: 'sg-al', NOTR: 'sg-notr', SAT: 'sg-sat', GSAT: 'sg-gsat', VERI: 'sg-veri' };
  var STRIP = ['GRAM', 'GOLD_FUT', 'SILVER_FUT', 'USDTRY', 'XU100', 'BTC'];
  var KATMAN_VARS = { sr: true, trend: true, form: true, koni: true, mum: true, fib: false };
  var chartState = { key: null, tf: 'G', span: 1, katman: (function () { try { return Object.assign({}, KATMAN_VARS, JSON.parse(localStorage.getItem('gmi-katman') || '{}')); } catch (e) { return Object.assign({}, KATMAN_VARS); } })() };
  var MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  var VIEWS = ['piyasa', 'altin', 'birikim', 'iller', 'teknik', 'gundem', 'karne'];
  var YZ = window.GMIYORUM || null;
  var state = { data: null, fetchedAt: 0, offline: false, loading: false, error: null };
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
  function pct(v, dp) { return (v == null || !isFinite(v)) ? '—' : sign(v) + '%' + num(Math.abs(v), dp == null ? 2 : dp); }
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
    if (USE_PHONE) {
      if (!state.data) { var c = GA.cached(); if (c) { state.data = c; render(); } }
      $('m-updated').textContent = 'Veriler telefona çekiliyor…';
      GA.run(function (done, total) { $('m-updated').textContent = 'Veriler telefona çekiliyor… ' + done + '/' + total; })
        .then(function (d) { state.data = d; state.error = null; })
        .catch(function (e) { state.error = (e && e.message) || String(e); })
        .then(function () {
          state.loading = false; state.fetchedAt = Date.now();
          $('btn-refresh').classList.remove('spin');
          render();
          if (chartState.key && !$('chart-sheet').hidden) drawChart();
          runBacktest(false);
        });
      return;
    }
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
    // tahmin defteri: ekran çizildikten sonra (günde bir kez kayıt; ayar yoksa varlık başına kısa bir hesap gerekir)
    if (USE_PHONE && window.GMITAHMIN) {
      clearTimeout(render.tk);
      render.tk = setTimeout(function () {
        try {
          var btd = GA.backtestData ? GA.backtestData() : null;
          GMITAHMIN.gunluk(['GRAM', 'GOLD_FUT', 'SILVER_FUT', 'USDTRY', 'EURTRY', 'XU100', 'BTC', 'BRENT'].map(function (k) {
            var ser = GA.seriesFor ? GA.seriesFor(k) : null, bk = btd && btd.assets && btd.assets[k];
            return { key: k, ad: (GA.assets[k] || {}).name || k, bars: ser && ser.d, kal: bk && bk.koni && bk.koni.h20 && bk.koni.h20.k80 != null ? bk.koni : null };
          }));
          renderTahminKarne();
        } catch (e) { /* yok say */ }
      }, 1200);
    }
    renderHeader(); renderStrip(); renderMarketYorum(); renderAlerts(); renderPrices(); renderGold(); renderSpot(); renderMakas(); renderIller(); renderSignals(); renderTech(); renderAgenda(); renderPerf(); renderBt(); renderTahminKarne(); renderBanner();
    try { document.dispatchEvent(new CustomEvent('gmi:data')); } catch (e) { /* yok say */ }
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
    if (state.error) msgs.push('Analiz tamamlanamadı: ' + state.error + '. Son kaydedilen veriler gösteriliyor.');
    var gen = Date.parse((state.data && state.data.generated_at) || '');
    if (isFinite(gen)) {
      var h = (Date.now() - gen) / 36e5;
      if (USE_PHONE && h > 3 && !state.loading) msgs.push('Veriler ' + Math.round(h) + ' saat önce hesaplandı. Yenilemek için ↻ düğmesine dokunun.');
      if (!USE_PHONE && h > (CFG.staleHours || 12)) msgs.push('Bu web sayfası artık otomatik güncellenmiyor (veriler ' + Math.round(h) + ' saatlik). Güncel veri için Android uygulamasını kurun.');
    }
    if (!USE_PHONE && CFG.apkUrl) {
      var a = el('a', 'btn', 'Android uygulamasını indir'); a.href = CFG.apkUrl; a.rel = 'noopener';
      b.append(a);
    }
    if (installEvt && !isStandalone()) {
      var span = el('span', null, 'Uygulamayı telefona yükleyebilirsiniz.');
      var btn = el('button', 'btn', 'Yükle'); btn.addEventListener('click', doInstall);
      b.append(span, btn);
    }
    msgs.forEach(function (m) { b.append(el('div', null, m)); });
    var ns = ntSorun();
    if (ns) {
      var row = el('div', 'banner-nt');
      row.append(el('span', null, ns.text));
      var fix = el('button', 'btn btn-sm', ns.btn);
      fix.addEventListener('click', ns.act);
      row.append(fix);
      if (ns.kapat) {
        var later = el('button', 'btn btn-sm btn-ghost', 'Şimdi değil');
        later.addEventListener('click', function () { lsSetJ(ns.kapat, Date.now()); renderBanner(); });
        row.append(later);
      }
      b.append(row);
    }
    b.hidden = !b.firstChild;
  }
  /* ---------- bildirimler gelebiliyor mu? ---------- */
  function ntDurum() {
    if (!NATIVE || typeof NATIVE.notifStatus !== 'function') return null;
    try { return JSON.parse(NATIVE.notifStatus() || '{}'); } catch (e) { return null; }
  }
  function sureTxt(ms, ek) {
    var dk = Math.round(ms / 6e4);
    if (dk < 60) return dk + ' dakika' + (ek ? 'dır' : '');
    var sa = Math.round(dk / 60);
    return sa < 48 ? sa + ' saat' + (ek ? 'tir' : '') : Math.round(sa / 24) + ' gün' + (ek ? 'dür' : '');
  }
  // Arka plan kontrollerinin son 24 saati (ya da güncellemeden beri geçen süre): kaç kez çalıştı, kaç kez beklenirdi,
  // kaçında internete erişilemedi. Beklenen: 07–24 TSİ arası 15, gece 60 dakikada bir (yedek alarmın aralığı).
  function calismaOzet(d) {
    var a = (d && d.calisma) || [], simdi = d.simdi, bas = Math.max(simdi - 864e5, d.guncelleme || d.kurulum || 0);
    var r = a.filter(function (x) { return x[0] >= bas && x[0] <= simdi && x[1] !== 'e'; });
    var beklenen = 0;
    for (var t = bas; t < simdi; t += 36e5) {
      var saat = new Date(t + 3 * 36e5).getUTCHours(), dilim = Math.min(36e5, simdi - t) / 36e5;
      beklenen += (saat < 7 ? 1 : 4) * dilim;
    }
    var bosluk = 0, onceki = bas;
    r.map(function (x) { return x[0]; }).sort(function (x, y) { return x - y; }).concat([simdi]).forEach(function (x) { bosluk = Math.max(bosluk, x - onceki); onceki = x; });
    return { n: r.length, alarm: r.filter(function (x) { return x[1] === 'a'; }).length, veriYok: r.filter(function (x) { return x[2] === 0; }).length,
      beklenen: Math.max(1, Math.round(beklenen)), sure: simdi - bas, bosluk: bosluk };
  }
  function ayarlaraGit() { openSheet(); setTimeout(function () { var x = $('nt-list'); if (x) x.scrollIntoView({ block: 'start' }); }, 60); }
  // Ana ekrandaki uyarı: yalnız bildirimlerin gelmesini engelleyen ya da geciktiren bir durum varsa (en önemlisi).
  function ntSorun() {
    var d = ntDurum();
    if (!d) return null;
    if (d.izin === false) return { text: 'Bildirimler kapalı: uyarılar ve fiyat alarmları gelmez.', btn: 'Aç', act: function () { NATIVE.requestNotifications(); setTimeout(renderBanner, 2500); } };
    if (d.kanal === 0) return { text: '"Piyasa uyarıları" bildirimleri kapatılmış.', btn: 'Aç', act: function () { NATIVE.openNotificationSettings(); } };
    if (d.arka === false) return null;
    if (d.kisitli === true) return { text: 'Pil kullanımı "Kısıtlı" seçilmiş: uygulama kapalıyken hiç kontrol yapılamaz, bildirim gelmez.', btn: 'Düzelt', act: function () { NATIVE.openAppSettings(); } };
    if (d.veri === 3) return { text: 'Veri tasarrufu açık: uygulama kapalıyken mobil veriyle fiyat alınamıyor, bildirim gelmez.', btn: 'Düzelt', act: function () { NATIVE.openDataSettings ? NATIVE.openDataSettings() : NATIVE.openAppSettings(); } };
    if (d.calisma) {
      var o = calismaOzet(d), saat = Math.max(1, Math.round(o.sure / 36e5));
      if (o.sure >= 2 * 36e5 && o.n < o.beklenen * 0.25)
        return { text: 'Telefon, uygulama kapalıyken kontrolleri durduruyor: son ' + saat + ' saatte ' + o.n + ' kontrol yapıldı (beklenen ≈' + o.beklenen + '). Bildirimler bu yüzden uygulamayı açınca geliyor.', btn: 'Düzelt', act: ayarlaraGit };
      if (o.n >= 4 && o.veriYok >= o.n / 2)
        return { text: 'Arka plan kontrolleri internete erişemiyor (son ' + saat + ' saatte ' + o.veriYok + '/' + o.n + ').', btn: 'Düzelt', act: ayarlaraGit };
    } else {
      var gec = d.simdi - (d.son || d.guncelleme || d.kurulum || d.simdi);
      if (gec > 3 * 36e5) return { text: 'Arka plan kontrolü ' + sureTxt(gec, true) + ' çalışmadı; uyarılar gecikebilir.', btn: 'Nasıl düzeltilir', act: ayarlaraGit };
    }
    var kapatildi = lsGetJ('gmi-pil-sor', 0);
    if (!d.pil && Date.now() - kapatildi > 7 * 864e5)
      return { text: 'Uygulama kapalıyken bildirimlerin zamanında gelmesi için arka planda çalışma izni verin.', btn: 'İzin ver', act: function () { NATIVE.openBatterySettings(); setTimeout(renderBanner, 4000); }, kapat: 'gmi-pil-sor' };
    return null;
  }
  // Üreticinin otomatik başlatma / arka plan izni: durumu okunamadığı için düğmeyle ayar ekranı açılır
  var OTO = [
    [/xiaomi|redmi|poco/i, 'Xiaomi: "Otomatik başlatma" açık olmalı; ayrıca son uygulamalar ekranında GMI Piyasa\'yı aşağı çekip kilitleyin.'],
    [/huawei|honor/i, 'Huawei / Honor: "Uygulama başlatma"da GMI Piyasa elle yönetilmeli, üç seçenek de açık olmalı.'],
    [/oppo|realme|oneplus/i, 'Oppo / Realme / OnePlus: "Otomatik başlatma" ve "Arka plan etkinliği" açık olmalı.'],
    [/vivo|iqoo/i, 'Vivo: "Arka planda başlatma" ve "Arka planda yüksek güç tüketimi" izinli olmalı.'],
    [/samsung/i, 'Samsung: Pil → Arka plan kullanım sınırları: GMI Piyasa "Uyuyan" ya da "Derin uyuyan" uygulamalarda olmamalı.'],
    [/asus/i, 'Asus: "Otomatik başlatma yöneticisi"nde GMI Piyasa izinli olmalı.']
  ];
  var MARKA = [
    [/xiaomi|redmi|poco/i, 'Xiaomi / Redmi / POCO: Ayarlar → Uygulamalar → GMI Piyasa → Otomatik başlatma açık; Pil tasarrufu → Kısıtlama yok.'],
    [/samsung/i, 'Samsung: Ayarlar → Pil → Arka plan kullanım sınırları → GMI Piyasa "Uyuyan uygulamalar"da olmasın; "Hiç uyumayan uygulamalar"a ekleyin.'],
    [/huawei|honor/i, 'Huawei / Honor: Ayarlar → Pil → Uygulama başlatma → GMI Piyasa → Elle yönet; üç seçeneği de açın.'],
    [/oppo|realme|oneplus/i, 'Oppo / Realme / OnePlus: Ayarlar → Pil → GMI Piyasa → Arka plan etkinliğine izin ver; Otomatik başlatma açık.'],
    [/vivo|iqoo/i, 'Vivo: Ayarlar → Pil → Arka planda yüksek güç tüketimi → GMI Piyasa\'ya izin verin.']
  ];
  function renderNtList() {
    var box = $('nt-list'), d = ntDurum();
    if (!box) return;
    clear(box);
    if (!d) { box.append(el('li', 'nt-item', 'Durum okunamadı (eski uygulama sürümü).')); return; }
    function item(ok, text, btn, act) {
      var li = el('li', 'nt-item ' + (ok === true ? 'ok' : (ok === false ? 'bad' : 'warn')));
      li.append(el('span', 'nt-ico', ok === true ? '✓' : (ok === false ? '✗' : '!')), el('span', 'nt-txt', text));
      if (btn) { var b = el('button', 'btn btn-sm btn-ghost', btn); b.type = 'button'; b.addEventListener('click', act); li.append(b); }
      box.append(li);
    }
    item(d.izin, d.izin ? 'Bildirim izni açık.' : 'Bildirim izni kapalı.', d.izin ? null : 'İzin ver', function () { NATIVE.requestNotifications(); setTimeout(renderNtList, 2500); });
    if (d.kanal === 0) item(false, '"Piyasa uyarıları" bildirim türü kapatılmış.', 'Aç', function () { NATIVE.openNotificationSettings(); });
    item(d.arka, d.arka ? 'Arka plan kontrolü açık.' : 'Arka plan kontrolü kapalı.', d.arka ? null : 'Aç', function () { NATIVE.setBackground(true); $('bg-toggle').checked = true; renderNtList(); });
    item(d.pil ? true : null, d.pil ? 'Pil kısıtlaması yok.' : 'Pil tasarrufu arka plan kontrolünü geciktirebilir.', d.pil ? null : 'Kısıtlamayı kaldır', function () { NATIVE.openBatterySettings(); setTimeout(renderNtList, 4000); });
    if (d.kisitli === true) item(false, 'Pil kullanımı "Kısıtlı" seçilmiş: uygulama kapalıyken hiç çalışamaz. Uygulama bilgisi → Pil → "Kısıtlamasız" seçin.', 'Ayarları aç', function () { NATIVE.openAppSettings(); });
    if (d.veri === 3) item(false, 'Veri tasarrufu açık: uygulama kapalıyken mobil veri kullanamıyor.', 'İzin ver', function () { NATIVE.openDataSettings ? NATIVE.openDataSettings() : NATIVE.openAppSettings(); });
    if (d.kova >= 40) item(null, 'Android bu uygulamayı "az kullanılan" sınıfına almış; arka plan kontrolleri saatlerce ertelenebilir. Pil kısıtlamasını kaldırmak bunu çözer.');
    // Arka plan kontrollerinin gerçekten çalışıp çalışmadığı (kayıtlardan)
    var basla = d.guncelleme || d.kurulum || d.simdi, sorun = false, ozetVar = false;
    // yedek alarm gece (00–07 TSİ) 60 dakikada bir ve Doze'da daha geç çalabilir
    var tetikGece = d.tetik && new Date(d.tetik + 3 * 36e5).getUTCHours() < 7;
    var tetikDurdu = d.tetik && d.arka && d.simdi - d.tetik > (tetikGece ? 120 : 45) * 6e4;
    if (d.calisma && d.simdi - basla >= 45 * 6e4) {
      var o = calismaOzet(d), saat = Math.max(1, Math.round(o.sure / 36e5)), oran = o.n / o.beklenen, netYok = o.n > 0 && o.veriYok >= o.n / 2;
      var gecSon = d.son ? d.simdi - d.son : null;
      ozetVar = true; sorun = oran < 0.6 || netYok;
      item(oran < 0.25 || netYok ? false : (oran < 0.6 ? null : true),
        'Son ' + saat + ' saatte ' + o.n + ' arka plan kontrolü yapıldı (beklenen ≈' + o.beklenen + (o.alarm ? '; ' + o.alarm + ' tanesini yedek zamanlayıcı başlattı' : '') + ')' +
        (gecSon != null ? '; sonuncusu ' + sureTxt(Math.max(gecSon, 6e4)) + ' önce' : '') + '. En uzun ara ' + sureTxt(Math.max(o.bosluk, 6e4)) + '.' +
        (oran < 0.25 ? ' Telefon arka plan işini durduruyor; bildirimler bu yüzden uygulamayı açınca geliyor.' : (oran < 0.6 ? ' Kontroller gecikiyor.' : '')) +
        (o.veriYok ? ' ' + o.veriYok + ' kontrolde internete erişilemedi' + (netYok ? ' (veri tasarrufu, arka plan veri kısıtlaması ya da zayıf bağlantı).' : '.') : ''));
    } else if (d.son) {
      var gec = d.simdi - d.son;
      sorun = gec >= 45 * 6e4;
      item(gec < 45 * 6e4 ? true : (gec < 3 * 36e5 ? null : false), 'Son arka plan kontrolü ' + sureTxt(Math.max(gec, 6e4)) + ' önce.' + (gec >= 3 * 36e5 ? ' Telefon arka plan işini durduruyor olabilir.' : ''));
    } else if (d.simdi - basla < 40 * 6e4) {
      item(null, 'Arka plan kontrolü henüz çalışmadı; ilk kontrol kurulumdan ya da güncellemeden sonraki 15–30 dakika içinde yapılır.');
    } else {
      sorun = true;
      item(false, 'Arka plan kontrolü bu sürüm kurulduğundan beri hiç çalışmadı. Telefon arka plan işini durduruyor olabilir.');
    }
    if (tetikDurdu) { sorun = true; item(false, 'Yedek zamanlayıcı ' + sureTxt(d.simdi - d.tetik) + ' önce çalmalıydı ama çalmadı: telefon uygulamayı tamamen kapatıyor (otomatik başlatma kapalı ya da uygulama son uygulamalardan kaydırılınca kapanıyor).'); }
    // Üretici ayarı: durumu okunamıyor; sorun varsa ya da henüz kayıt yoksa gösterilir
    var oto = OTO.filter(function (m) { return m[0].test(d.marka || ''); })[0], otoGoster = oto && (sorun || !ozetVar || !d.pil);
    if (otoGoster && NATIVE.openAutostart) item(null, oto[1], 'Ayarı aç', function () { NATIVE.openAutostart(); });
    var tip = MARKA.filter(function (m) { return m[0].test(d.marka || ''); })[0];
    $('nt-marka').textContent = tip && otoGoster ? 'Düğmeler doğru ekranı açmazsa elle: ' + tip[1] + ' (Menü adları sürüme göre değişebilir.)' : '';
    $('nt-marka').hidden = !(tip && otoGoster);
    try { $('ozet-toggle').checked = !!d.ozet; } catch (e) { /* yok say */ }
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
      var diff = r.metric === 'THEO' ? 'referans (vadeli ons ile)' : (r.metric === 'THEO_SPOT' ? 'vadeli ons ile hesaplanandan fark ' + pct(r.diff_ask_pct)
        : 'teorikten fark ' + pct(r.diff_bid_pct) + (r.diff_ask_pct != null ? ' / ' + pct(r.diff_ask_pct) : ''));
      c.append(el('div', 'pchg flat', diff));
      c.append(el('div', 'pmeta', (r.time || '') + (r.spread_pct != null ? ' · alış-satış farkı %' + num(r.spread_pct, 2) : '')));
      if (r.metric === 'RETAIL' && r.spread_pct != null && r.spread_pct < 0.2) c.append(el('div', 'pmeta', 'Serbest piyasa (toptan) fiyatı; banka ve kuyumcu farkı daha geniştir.'));
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
  function sigBadge(code, label, short) {
    var map = GA && (short ? GA.SIG_SHORT : GA.SIG_LABEL);
    return el('span', 'sig ' + (SIG_CLS[code] || 'sg-veri'), (map && map[code]) || label || code || '—');
  }
  function btFor(key) { var d = GA && GA.backtestData ? GA.backtestData() : null; return d && d.assets ? d.assets[key] || null : null; }
  function spotLine(x) {
    var s = x && x.spot;
    if (!s || s.price == null) return '';
    return 'Spot ' + num(s.price, x.dp) + ' $ (' + (s.time || '—') + ') · vadeli farkı ' + (s.diff >= 0 ? '+' : '−') + num(Math.abs(s.diff), x.dp) + ' $ (' + pct(s.diffPct) + ')';
  }
  function statFor(code) {
    if (!GA || !GA.signalStats) return null;
    var b = GA.signalStats().by[code];
    if (!b) return null;
    var n = (b.isabet || 0) + (b['ıska'] || 0);
    return n ? { rate: 100 * b.isabet / n, n: n, flat: b.yatay || 0 } : null;
  }

  function renderStrip() {
    var box = clear($('sig-strip')), list = rows('signals');
    box.hidden = !list.length;
    STRIP.forEach(function (k) {
      var x = list.filter(function (r) { return r.key === k; })[0];
      if (!x) return;
      var b = el('button', 'chip'); b.type = 'button';
      b.append(el('span', 'chip-n', x.name.replace(/ \(.*\)$/, '')), sigBadge(x.code, x.label, true));
      b.addEventListener('click', function () { openChart(k); });
      box.append(b);
    });
  }

  function renderSignals() {
    var box = clear($('signals')), list = rows('signals');
    $('signals-empty').hidden = list.length > 0;
    list.forEach(function (x) {
      var c = el('button', 'card sig-card'); c.type = 'button';
      var top = el('div', 'sig-top'); top.append(el('span', 'pname', x.name), sigBadge(x.code, x.label));
      var line = el('div', 'sig-line');
      line.append(el('span', 'pval pval-sm', num(x.price, x.dp) + (x.unit ? ' ' + x.unit : '')), el('span', 'pchg ' + dir(x.chg), pct(x.chg)));
      var sy = YZ ? YZ.short(x) : '';
      c.append(top, line, el('div', 'pmeta', 'Günlük skor ' + scoreTxt(x.ds) + '/' + x.dn + ' · kısa vade ' + (x.ss == null ? '—' : scoreTxt(x.ss) + '/' + x.sn) + (sy || !x.trend ? '' : ' · ' + x.trend)));
      if (sy) c.append(el('div', 'sig-yorum', sy));
      var spl = spotLine(x);
      if (spl) c.append(el('div', 'pmeta', spl));
      var hi = YZ && YZ.history ? YZ.history(x, btFor(x.key)) : null;
      if (hi) c.append(el('div', 'sig-hist ' + hi.ton, hi.kart));
      if (x.invalid) c.append(el('div', 'pmeta', (x.code === 'NOTR' ? 'Yön için: ' : 'Bu görünümü bozan: ') + x.invalid));
      if (x.notes && x.notes.length) c.append(el('div', 'sig-note', x.notes[0]));
      if (x.stale) c.append(el('div', 'sig-note', 'Güncel veri alınamadı; önbellekteki veriyle hesaplandı.'));
      c.addEventListener('click', function () { openChart(x.key); });
      box.append(c);
    });
  }

  function openChart(key) {
    chartState.key = key; chartState.view = null;
    var a = GA && GA.assets && GA.assets[key];
    if (chartState.tf !== 'G' && !(a && a.intra)) chartState.tf = 'G';
    $('chart-sheet').hidden = false; $('chart-bg').hidden = false;
    document.body.classList.add('noscroll');
    drawChart();
  }
  function closeChart() {
    if (chartState.tam) tamEkran(false, true);
    $('chart-sheet').hidden = true; $('chart-bg').hidden = true; document.body.classList.remove('noscroll'); chartState.key = null;
  }
  // Tam ekran: yalnız grafik; Android'de ekran yataya döner ve durum çubuğu gizlenir (geri tuşu ya da düğmeyle çıkılır)
  function tamEkran(ac, cizme) {
    chartState.tam = ac == null ? !chartState.tam : !!ac;
    $('chart-sheet').classList.toggle('tam', chartState.tam);
    if (NATIVE && typeof NATIVE.tamEkran === 'function') { try { NATIVE.tamEkran(chartState.tam); } catch (e) { /* yok say */ } }
    $('chart-sheet').scrollTop = 0;
    if (!cizme) drawChart();
  }
  // Android geri tuşu: önce tam ekran, sonra açık pencereler, sonra ana sekme; uygulamadan ancak ana sekmede çıkılır
  window.__gmiGeri = function () {
    if (chartState.tam) { tamEkran(false); return true; }
    if (!$('chart-sheet').hidden) { closeChart(); return true; }
    if (!$('sheet').hidden) { closeSheet(); return true; }
    var v = (location.hash || '').slice(1);
    if (v && v !== 'piyasa') { go('piyasa'); return true; }
    return false;
  };
  function lvl(o, lbl, kind) { return o && o.v != null ? { v: o.v, label: lbl, kind: kind, note: (o.labels || []).join(', ') } : null; }
  function drawChart() {
    var key = chartState.key; if (!key) return;
    var sig = rows('signals').filter(function (x) { return x.key === key; })[0];
    var t = rows('tech').filter(function (x) { return x.key === key; })[0];
    var a = (GA && GA.assets && GA.assets[key]) || {};
    var name = (sig && sig.name) || (t && t.name) || a.name || key, dp = sig ? sig.dp : (t ? t.dp : (a.dp || 2)), unit = sig ? sig.unit : (a.unit || '');
    $('ch-name').textContent = name;
    $('ch-sub').textContent = sig ? num(sig.price, dp) + (unit ? ' ' + unit : '') + ' · ' + pct(sig.chg) + ' · eğilim: ' + ((GA && GA.SIG_LABEL[sig.code]) || sig.label).toLowerCase() +
      (sig.spot && sig.spot.price != null ? ' · spot ' + num(sig.spot.price, dp) + ' $' : '') : '';
    document.querySelectorAll('#ch-tf button').forEach(function (b) {
      var tf = b.getAttribute('data-tf'); b.setAttribute('aria-pressed', tf === chartState.tf ? 'true' : 'false');
      b.disabled = tf !== 'G' && !a.intra;
    });
    var labels = (window.GMICHART && GMICHART.SPAN_LABEL[chartState.tf]) || ['kısa', 'orta', 'uzun'];
    function spanBas() {
      document.querySelectorAll('#ch-span button').forEach(function (b) {
        var i = +b.getAttribute('data-span'); b.textContent = labels[i]; b.setAttribute('aria-pressed', i === chartState.span && !chartState.view ? 'true' : 'false');
      });
    }
    spanBas();
    var levels = [];
    if (sig) levels = [lvl(sig.s1, 'S1', 's'), lvl(sig.s2, 'S2', 's'), lvl(sig.r1, 'R1', 'r'), lvl(sig.r2, 'R2', 'r')].filter(Boolean);
    else if (t) levels = [['s1', 'S1', 's'], ['s2', 'S2', 's'], ['r1', 'R1', 'r'], ['r2', 'R2', 'r']].map(function (x) { return t[x[0]] != null ? { v: t[x[0]], label: x[1], kind: x[2] } : null; }).filter(Boolean);
    var ser = GA && GA.seriesFor ? GA.seriesFor(key) : null;
    var box = $('ch-box'), st = null, kal = chartState.tf === 'G' && ser && ser.d ? koniAyar(key, ser.d) : null;
    var x = sig || sigLike(key), xo = x || { dp: dp, unit: unit };
    var opt = { daily: ser && ser.d, hourly: ser && ser.h, tf: chartState.tf, span: chartState.span, dp: dp, unit: unit, name: name, levels: levels, katman: chartState.katman, kalib: kal,
      gorunum: chartState.view, tamMi: !!chartState.tam, tamEkran: function () { tamEkran(); }, araclar: $('ch-tools'),
      onView: function (v, st2) { chartState.view = v; spanBas(); renderChartRead(st2, xo); } };
    if (!window.GMICHART || !ser || !ser.d) { clear($('ch-tools')); clear(box).append(el('p', 'sub', 'Grafikler Android uygulamasında, veriler telefona çekildikten sonra görünür.')); }
    else if (chartState.tam) {
      // tam ekran: önce tahmini yükseklikle çiz, sonra kalan boşluğa göre bir kez düzelt
      opt.yukseklik = window.innerHeight - box.getBoundingClientRect().top - 60;
      st = GMICHART.render(box, opt);
      var sv = box.querySelector('svg');
      if (sv) {
        var fark = window.innerHeight - sv.getBoundingClientRect().bottom - 6;
        if (Math.abs(fark) > 3) { opt.yukseklik += fark; st = GMICHART.render(box, opt); }
      }
    }
    else st = GMICHART.render(box, opt);
    document.querySelectorAll('#ch-katman button').forEach(function (b) {
      var k = b.getAttribute('data-k'); b.setAttribute('aria-pressed', chartState.katman[k] ? 'true' : 'false');
      b.hidden = k === 'koni' && chartState.tf !== 'G';
    });
    renderForm(st, xo, key);
    renderTahmin(st, xo, kal);
    renderInd(st);
    renderChartRead(st, xo);
    renderAssetYorum(x);
    renderSigDetail(sig);
  }
  // sinyal listesinde olmayan varlıklar için (ör. S&P 500, Nikkei) bellekteki analizden yorum nesnesi
  function sigLike(key) {
    var t = GA && GA.techFor ? GA.techFor(key) : null;
    if (!t) return null;
    var a = (GA.assets && GA.assets[key]) || {};
    return { key: key, name: t.name, dp: t.dp, unit: a.unit || '', price: t.price, chg: t.chg, ds: t.ds, dn: t.dn, ss: t.ss, sn: t.sn, rsi: t.rsi, adx: t.adx,
      trend: t.trend, votes: [], s1: t.msup[0] || null, s2: t.msup[1] || null, r1: t.mres[0] || null, r2: t.mres[1] || null, stale: t.stale, atr: t.atr, ind: t.ind };
  }
  function yorumCtx() {
    var list = rows('signals');
    return { gold: rows('gold'), find: function (k) { return list.filter(function (r) { return r.key === k; })[0] || null; } };
  }
  var TF_AD = { G: 'günlük', '4S': '4 saatlik', '1S': '1 saatlik' };
  // Koninin bu varlıktaki ayarı: haftalık 10 yıllık testten, yoksa grafikteki 2 yıllık veriden (önbellekli)
  var KONI_AYAR = {};
  function koniAyar(key, bars) {
    var bt = btFor(key);
    if (bt && bt.koni && bt.koni.h20 && bt.koni.h20.k80 != null) return bt.koni;
    if (!window.GMITAHMIN || !bars || bars.length < 300) return null;
    var id = key + ':' + bars.length + ':' + bars[bars.length - 1].t;
    if (!KONI_AYAR[id]) { try { KONI_AYAR = {}; KONI_AYAR[id] = GMITAHMIN.test(bars); } catch (e) { return null; } }
    return KONI_AYAR[id];
  }
  // Grafiksel yorum: çizgiler, formasyonlar, bölgeler, Fibonacci, uyumsuzluk, mumlar + formasyonların bu varlıktaki geçmişi
  function renderForm(st, x, key) {
    var box = clear($('ch-form'));
    if (!st || !st.form || !window.GMIFORM) { box.hidden = true; return; }
    var bt = btFor(key), G = chartState.tf === 'G' && bt && bt.form ? bt.form : null;
    if (!G) {
      try { G = GMIFORM.gecmis(st.seri); } catch (e) { G = null; }
      if (G && chartState.tf !== 'G') { G.etiket = 'bu grafiğin verisinde (' + TF_AD[chartState.tf] + ', son ≈3 ay)'; G.birim = 'mum'; }
    }
    var lines = GMIFORM.yorum(st.form, { dp: x.dp, unit: x.unit, gecmis: G, numara: chartState.katman.form });
    box.hidden = !lines.length;
    if (!lines.length) return;
    box.append(el('h3', 'yorum-h', 'Grafiksel yorum (' + TF_AD[chartState.tf] + ' grafik)'));
    var ul = el('ul', 'yorum-list');
    lines.forEach(function (t) { ul.append(el('li', null, t)); });
    box.append(ul);
    box.append(el('p', 'sub', 'Çizgiler ve formasyonlar sabit kurallarla otomatik bulunur. Formasyon hedefi klasik ölçüm kuralıdır (formasyonun yüksekliği kırılım noktasına eklenir); gerçekleşeceği anlamına gelmez. "Kez onaylandı" sayıları bu varlığın kendi geçmiş verisinden hesaplanır.'));
  }
  // Gelecek görünümü: olasılık konisi, seviyelere değme olasılığı, yöntemin geçmiş testi
  function renderTahmin(st, x, test) {
    var box = clear($('ch-tahmin'));
    if (!st || !st.seri || chartState.tf !== 'G' || !window.GMITAHMIN) { box.hidden = true; return; }
    var sv = [];
    [['R1', x.r1], ['S1', x.s1], ['R2', x.r2], ['S2', x.s2]].forEach(function (z) { if (z[1] && z[1].v != null) sv.push({ ad: z[0], v: z[1].v }); });
    if (st.form) st.form.formasyonlar.forEach(function (pt) { if (pt.durum === 'onaylandı' || pt.durum === 'oluşuyor') sv.push({ ad: pt.ad + ' hedefi', v: pt.hedef }); });
    var Y = GMITAHMIN.yorum(st.seri, { dp: x.dp, unit: x.unit, seviyeler: sv, test: test });
    box.hidden = !Y;
    if (!Y) return;
    box.append(el('h3', 'yorum-h', 'Gelecek görünümü (olasılık)'));
    var ul = el('ul', 'yorum-list');
    Y.satir.forEach(function (t) { ul.append(el('li', null, t)); });
    box.append(ul);
    box.append(el('p', 'sub', 'Bu bölüm fiyatın nereye gideceğini söylemez; geçmiş hareketlere ve bugünkü oynaklığa göre olası aralığı gösterir. Grafikteki mavi koni aynı hesaptır. Aralık, bu varlığın geçmişinde söylediği oranda tutacak biçimde ayarlanır; ani haber ve şoklarda yine de dışına çıkılabilir. Uygulama bu aralıkların tutup tutmadığını her gün kaydeder (Karne sekmesi).'));
  }
  // Tüm göstergeler tablosu
  function renderInd(st) {
    var det = $('ch-ind'), body = clear($('ch-ind-body')), T = st && st.form && st.form.gostergeler;
    det.hidden = !T;
    if (!T) return;
    det.querySelector('summary').textContent = 'Tüm göstergeler (' + T.rows.length + '): ' + T.yukari + ' yükseliş, ' + T.asagi + ' düşüş, ' + T.notr + ' nötr';
    var grp = null, tbl = el('table', 'tbl ind-tbl'), tb = el('tbody');
    T.rows.forEach(function (r) {
      if (r.grp !== grp) { grp = r.grp; var h = el('tr', 'ind-grp'); var th = el('th', null, grp); th.colSpan = 2; h.append(th); tb.append(h); }
      var tr = el('tr'), c1 = el('td');
      c1.append(el('div', 'ind-ad', r.ad), el('div', 'ind-deg', r.deger));
      tr.append(c1, td(r.okuma, r.yon > 0 ? 'up' : (r.yon < 0 ? 'down' : 'flat'))); tb.append(tr);
    });
    tbl.append(tb);
    var tw = el('div', 'tw'); tw.append(tbl);
    body.append(tw);
    body.append(el('p', 'sub', 'Bu göstergelerin çoğu aynı fiyat verisinden türediği için birbirini tekrarlar: çoğunluğun aynı yönü göstermesi isabeti artırmaz. Geçmiş testi (Karne) gösterge oylarının bu varlıklarda yönü rastgele bir günden belirgin biçimde iyi bilmediğini gösterdi.' + (T.hacim ? '' : ' Bu varlıkta hacim verisi olmadığı için hacim göstergeleri yok.')));
  }
  function renderChartRead(st, x) {
    var box = clear($('ch-read'));
    if (!YZ || !st) { box.hidden = true; return; }
    var lines = YZ.chart(st, x);
    box.hidden = !lines.length;
    if (!lines.length) return;
    box.append(el('h3', 'yorum-h', 'Bu grafikte ne görünüyor?'));
    var ul = el('ul', 'yorum-list');
    lines.forEach(function (t) { ul.append(el('li', null, t)); });
    box.append(ul);
  }
  function renderAssetYorum(x) {
    var box = clear($('ch-yorum')), ctx = yorumCtx();
    if (x) { ctx.bt = btFor(x.key); ctx.makas = makasGet(); }
    var y = YZ && x ? YZ.asset(x, ctx) : null;
    box.hidden = !y;
    if (!y) return;
    box.append(el('h3', 'yorum-h', 'Uygulamanın yorumu (günlük görünüm)'));
    box.append(el('p', 'yorum-lead', y.lead.join(' ')));
    y.sections.forEach(function (sec) {
      box.append(el('h4', 'yorum-sh', sec.h));
      var ul = el('ul', 'yorum-list');
      sec.items.forEach(function (t) { ul.append(el('li', null, t)); });
      box.append(ul);
    });
    box.append(el('p', 'sub', 'Bu yorum göstergelerden sabit kurallarla otomatik yazılır; tahmin, kesin yön ya da yatırım tavsiyesi değildir.'));
  }
  function renderMarketYorum() {
    var card = $('market-yorum'), body = clear($('market-yorum-body'));
    var lines = YZ ? YZ.market(state.data) : [];
    card.hidden = !lines.length;
    lines.forEach(function (t) { body.append(el('p', null, t)); });
  }
  function openTerms() {
    closeChart(); openSheet();
    var d = document.querySelector('#sheet .terms');
    if (d) { d.open = true; setTimeout(function () { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60); }
  }
  function renderSigDetail(x) {
    var box = clear($('ch-sig'));
    if (!x) return;
    var h = el('div', 'sig-top'); h.append(el('strong', null, 'Eğilim etiketi'), sigBadge(x.code, x.label)); box.append(h);
    box.append(el('p', 'sub', 'Etiket, göstergelerin bugünkü durumunu özetler. Fiyatın bundan sonra o yöne gideceği anlamına gelmez; al-sat emri değildir.'));
    box.append(el('p', 'sub', 'Günlük skor ' + scoreTxt(x.ds) + '/' + x.dn + ' (yedi göstergenin oyu), kısa vade ' + (x.ss == null ? 'hesaplanamadı' : scoreTxt(x.ss) + '/' + x.sn + ' (4 saat ve 1 saat)') +
      (x.trend ? ' · ' + x.trend : '') + '. Göstergelerin oyu:'));
    var ul = el('ul', 'votes');
    (x.votes || []).forEach(function (v) { ul.append(el('li', v.ok ? 'up' : 'down', (v.ok ? '▲ ' : '▼ ') + v.txt)); });
    box.append(ul);
    (x.notes || []).forEach(function (n) { box.append(el('p', 'sig-note', n)); });
    var st = statFor(x.code);
    box.append(el('p', 'sub', st ? 'Bu etiketin bu telefondaki karnesi: %' + num(st.rate, 0) + ' isabet (' + st.n + ' değerlendirme, ' + st.flat + ' yatay).'
      : 'Bu etiket için bu telefonda henüz değerlendirilmiş kayıt yok.'));
    renderBtDetail(box, x);
    box.append(el('p', 'sub', 'Etiketler göstergelerden kurala göre üretilir; kesin yön ya da fiyat hedefi değildir, yatırım tavsiyesi değildir. Karar sizindir.'));
  }
  var BT_ROWS = [['GAL', 'Güçlü yükseliş'], ['AL', 'Yükseliş'], ['NOTR', 'Belirsiz'], ['SAT', 'Düşüş'], ['GSAT', 'Güçlü düşüş'], ['ALL', 'Herhangi bir gün']];
  function renderBtDetail(box, x) {
    box.append(el('h4', 'yorum-sh', 'Geçmiş testi'));
    var bt = btFor(x.key);
    if (!bt) {
      box.append(el('p', 'sub', USE_PHONE ? 'Geçmiş testi henüz hazır değil. Uygulama açıkken arka planda 10 yıllık veriyle hesaplanır; birkaç dakika sürebilir.' : 'Geçmiş testi Android uygulamasında hesaplanır.'));
      return;
    }
    var dc = GA.btCode(x.ds);
    box.append(el('p', 'sub', 'Uygulamanın günlük kuralı ' + bt.bas + ' ile ' + bt.son + ' arasındaki her güne uygulandı. Geçmiş 4 saatlik ve 1 saatlik veri olmadığı için yalnız günlük göstergeler kullanıldı. Tablo, her etiketten sonra fiyatın ne sıklıkla yükseldiğini gösterir.'));
    var tbl = el('table', 'tbl bt-tbl'), th = el('thead'), hr = el('tr');
    ['Etiket (günlük)', '1 hafta sonra yükseldi', '1 ay sonra yükseldi', 'Ayrı dönem'].forEach(function (t) { hr.append(el('th', null, t)); });
    th.append(hr); tbl.append(th);
    var tb = el('tbody');
    BT_ROWS.forEach(function (r) {
      var a = bt.h5[r[0]], b = bt.h20[r[0]];
      if (!a) return;
      var tr = el('tr', r[0] === dc ? 'bt-now' : (r[0] === 'ALL' ? 'bt-base' : ''));
      tr.append(td(r[1] + (r[0] === dc ? ' (bugün)' : '')), td('%' + num(a.up, 0)), td(b ? '%' + num(b.up, 0) : '—'), td(a.ep == null ? '—' : String(a.ep)));
      tb.append(tr);
    });
    tbl.append(tb);
    var w = el('div', 'tw'); w.append(tbl); box.append(w);
    var hi = YZ && YZ.history ? YZ.history(x, bt) : null;
    if (hi) box.append(el('p', 'item-detail', hi.verdict));
    if (bt.st) {
      var a1 = GA.btNet(bt.st, 0.0025), a2 = GA.btNet(bt.st, 0.01), mk = makasGet(), ul = el('ul', 'yorum-list');
      ul.append(el('li', null, 'İşlem başına %0,25 maliyetle: etikete göre girip çıkmak ' + pct(a1.sinyal, 0) + ', hiç satmadan tutmak ' + pct(a1.alTut, 0) + '.'));
      ul.append(el('li', null, 'İşlem başına %1 maliyetle: etikete göre girip çıkmak ' + pct(a2.sinyal, 0) + ', hiç satmadan tutmak ' + pct(a2.alTut, 0) + '.'));
      if (mk && x.key === 'GRAM') {
        var a3 = GA.btNet(bt.st, mk.kayip / 200);
        ul.append(el('li', null, 'Senin girdiğin alış-satış farkıyla (işlem başına %' + num(mk.kayip / 2, 2) + '): etikete göre ' + pct(a3.sinyal, 0) + ', tutmak ' + pct(a3.alTut, 0) + '.'));
      }
      if (bt.st2y) { var b1 = GA.btNet(bt.st2y, 0.0025); ul.append(el('li', null, 'Son 2 yıl, %0,25 maliyetle: etikete göre ' + pct(b1.sinyal, 0) + ', tutmak ' + pct(b1.alTut, 0) + '.')); }
      ul.append(el('li', null, a1.islem + ' alım ya da satım; günlerin %' + num(bt.st.gun, 0) + ' kadarında elde tutuluyor.'));
      box.append(el('p', 'sub', 'Etikete göre girip çıkmak: yükseliş eğiliminde al, düşüş eğiliminde sat, belirsizde bekle (başlangıç ' + bt.st.bas + ').'));
      box.append(ul);
    }
    box.append(el('p', 'sub', 'Geçmiş sonuçlar geleceği garanti etmez. Nakitte beklerken faiz geliri hesaba katılmadı. Son hesaplama: ' + ((GA.backtestData() || {}).asof_trt || '—') + '.'));
  }

  /* ---------- geçmiş testi: arka planda haftada bir ---------- */
  var btState = { running: false, done: 0, total: 0 };
  function runBacktest(force) {
    if (!USE_PHONE || !GA.backtest || btState.running) return;
    var cur = GA.backtestData();
    if (!force && cur && (Date.now() / 1000 - cur.asof) < 7 * 86400) { renderBt(); return; }
    btState.running = true; btState.done = 0; renderBt();
    GA.backtest(true, function (d, t) { btState.done = d; btState.total = t; renderBt(); })
      .catch(function () { /* yok say */ })
      .then(function () {
        btState.running = false;
        renderBt(); renderSignals();
        if (chartState.key && !$('chart-sheet').hidden) drawChart();
      });
  }
  function renderTahminKarne() {
    var box = clear($('tk-sum'));
    if (!window.GMITAHMIN) return;
    var K = GMITAHMIN.karne();
    if (!K.h5.n && !K.h20.n) {
      box.append(el('p', 'sub', K.bekleyen ? K.bekleyen + ' aralık kaydedildi; ilk sonuçlar 5 işlem günü sonra görünür (kayıt başlangıcı ' + when(K.ilk) + ').' : 'Henüz kayıt yok; uygulama veri çektikçe kayıt başlar.'));
      return;
    }
    var tiles = el('div', 'tiles');
    [['5 gün', K.h5], ['20 gün', K.h20]].forEach(function (z) {
      var c = el('div', 'card');
      c.append(el('div', 'pname', z[0] + ' sonra: %80\'lik aralık tuttu'), el('div', 'pval', z[1].n ? '%' + num(100 * z[1].b80 / z[1].n, 0) : '—'),
        el('div', 'pmeta', z[1].n ? z[1].n + ' değerlendirme · %50\'lik aralık %' + num(100 * z[1].b50 / z[1].n, 0) + ' tuttu' : 'henüz vadesi gelmedi'));
      tiles.append(c);
    });
    box.append(tiles);
    var vl = Object.keys(K.varlik).filter(function (k) { return K.varlik[k].n >= 5; }).map(function (k) { var v = K.varlik[k]; return k + ' %' + num(100 * v.b80 / v.n, 0) + ' (' + v.n + ')'; });
    if (vl.length) box.append(el('p', 'sub', 'Varlık bazında %80\'lik aralığın tutma oranı (değerlendirme sayısı): ' + vl.join(' · ') + '.'));
    var az = K.h5.n + K.h20.n < 40;
    box.append(el('p', 'sub', (az ? 'Değerlendirme sayısı henüz az; oranlar zamanla oturur. ' : '') + 'Bekleyen kayıt: ' + K.bekleyen + '. Kayıt başlangıcı: ' + when(K.ilk) + '.'));
  }
  function renderBt() {
    var meta = $('bt-meta'), tb = clear($('bt-table').tBodies[0]), sum = $('bt-sum'), btn = $('btn-bt');
    var d = GA && GA.backtestData ? GA.backtestData() : null;
    btn.hidden = !USE_PHONE; btn.disabled = btState.running;
    btn.textContent = btState.running ? 'Hesaplanıyor… ' + btState.done + '/' + (btState.total || '…') : 'Geçmiş testini şimdi yenile';
    if (!d || !d.assets) {
      meta.textContent = USE_PHONE ? (btState.running ? '10 yıllık günlük veri indiriliyor ve test ediliyor.' : 'Geçmiş testi henüz yapılmadı.') : 'Geçmiş testi Android uygulamasında hesaplanır.';
      sum.textContent = ''; $('bt-wrap').hidden = true; return;
    }
    $('bt-wrap').hidden = false;
    meta.textContent = 'Son hesaplama: ' + (d.asof_trt || '—') + ' · 10 yıllık günlük veri · haftada bir kendiliğinden yenilenir.' + (d.missing && d.missing.length ? ' Alınamayan: ' + d.missing.join(', ') + '.' : '');
    var better = 0, notBetter = 0, opposite = 0;
    rows('signals').forEach(function (x) {
      var bt = d.assets[x.key], hi = YZ && YZ.history ? YZ.history(x, bt) : null;
      if (!bt) return;
      if (hi) { if (hi.ton === 'up') better++; else if (hi.ton === 'down') opposite++; else if (hi.edge != null && hi.kisa !== 'örnek az') notBetter++; }
      var tr = el('tr'), sc = el('td'); sc.append(sigBadge(GA.btCode(x.ds), null, true));
      tr.append(td(x.name.replace(/ \(.*\)$/, '')), sc, td(hi ? '%' + num(hi.up, 0) : '—'), td(hi ? '%' + num(hi.base, 0) : '—'), td(hi ? hi.kisa : '—', hi ? hi.ton : ''));
      tb.append(tr);
    });
    sum.textContent = 'Bugün yön gösteren günlük görünümlerden ' + better + ' tanesi geçmişte yönü rastgele bir günden daha sık doğru göstermiş; ' + notBetter + ' tanesi göstermemiş' +
      (opposite ? ', ' + opposite + ' tanesinden sonra fiyat daha sık ters yöne gitmiş' : '') + '.';
  }

  /* ---------- alış-satış farkı (kullanıcının kendi bankası ya da kuyumcusu) ---------- */
  var MK = 'gmi-makas';
  function makasGet() { try { return JSON.parse(localStorage.getItem(MK) || 'null'); } catch (e) { return null; } }
  function parseTr(v) {
    v = String(v || '').trim().replace(/\s/g, '').replace(/[₺TL]/gi, '');
    if (!v) return null;
    if (v.indexOf(',') >= 0) v = v.replace(/\./g, '').replace(',', '.');
    else if (/\.\d{3}$/.test(v)) v = v.replace(/\./g, '');
    var x = parseFloat(v);
    return isFinite(x) ? x : null;
  }
  function makasHesapla() {
    var a = parseTr($('mk-alis').value), b = parseTr($('mk-satis').value), out = $('mk-sonuc');
    if (!a || !b || a <= 0 || b <= 0) { out.textContent = 'İki fiyatı da yaz (ör. 6.250 ve 6.400).'; return; }
    if (b < a) { out.textContent = 'Satış fiyatı alış fiyatından düşük olamaz; yerlerini kontrol et.'; return; }
    if ((b - a) / b > 0.2) { out.textContent = 'Fark %20\'den büyük çıktı; fiyatları kontrol et.'; return; }
    makasKaydet(a, b);
  }
  function makasKaydet(a, b, kaynak) {
    var d = new Date(), m = { alis: a, satis: b, kayip: 100 * (b - a) / b, esik: 100 * (b / a - 1), tarih: d.getDate() + ' ' + MON[d.getMonth()], kaynak: kaynak || null };
    try { localStorage.setItem(MK, JSON.stringify(m)); } catch (e) { /* yok say */ }
    $('mk-alis').value = num(a, 2); $('mk-satis').value = num(b, 2);
    renderMakas();
    try { document.dispatchEvent(new CustomEvent('gmi:makas')); } catch (e) { /* yok say */ }
  }
  function renderMakas() {
    var m = makasGet(), out = $('mk-sonuc');
    if (!m) { out.textContent = ''; return; }
    if (!$('mk-alis').value) $('mk-alis').value = num(m.alis, 2);
    if (!$('mk-satis').value) $('mk-satis').value = num(m.satis, 2);
    var g = rows('signals').filter(function (x) { return x.key === 'GRAM'; })[0], atr = g && g.atr && g.price ? 100 * g.atr / g.price : null;
    out.textContent = 'Fark %' + num(m.kayip, 2) + ' (' + m.tarih + '). Bu fiyatlarla gram altını alıp hemen satarsan %' + num(m.kayip, 2) + ' kaybedersin; başa baş için fiyatın en az %' +
      num(m.esik, 2) + ' yükselmesi gerekir.' + (atr ? ' Gram altının ortalama günlük hareketi %' + num(atr, 1) + '.' : '') + ' Bu bilgi gram altın yorumunda ve geçmiş testinde kullanılır.';
  }
  function renderSpot() {
    var box = clear($('spot-card')), x = rows('signals').filter(function (r) { return r.key === 'GOLD_FUT'; })[0];
    box.hidden = !(x && x.spot);
    if (!x || !x.spot) return;
    box.append(el('div', 'pname', 'Ons altın: vadeli ve spot'));
    box.append(el('div', 'pval pval-sm', 'Spot ' + num(x.spot.price, 1) + ' $ · Vadeli ' + num(x.price, 1) + ' $'));
    box.append(el('div', 'pmeta', 'Fark ' + (x.spot.diff >= 0 ? '+' : '−') + num(Math.abs(x.spot.diff), 1) + ' $ (' + pct(x.spot.diffPct) + ') · spot: ' + x.spot.source + ', ' + (x.spot.time || '—')));
    box.append(el('p', 'sub', 'Kuyumcu ve döviz sitelerindeki ons fiyatı spot fiyattır. Grafikler ve teorik gram, geçmiş verisi olan COMEX vadeli kontratından hesaplanır; vadeli genelde spotun biraz üstündedir ve Yahoo\'dan yaklaşık 10 dakika gecikmeli gelebilir.'));
  }
  function scoreCls(v) { return v == null ? '' : (v >= 3 ? 'up' : (v <= -3 ? 'down' : 'flat')); }

  /* ---------- iller (kuyumcular odaları) ---------- */
  function extLink(url, text, cls) { var a = el('a', cls || 'btn btn-sm', text + ' ↗'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function odaItem(o) {
    var li = el('li', 'item');
    var top = el('div', 'item-top'); top.append(el('span', 'badge', o.il)); li.append(top);
    li.append(el('div', 'item-title', o.oda));
    if (o.ne) li.append(el('p', 'item-detail', o.ne));
    if (o.neden) li.append(el('p', 'item-detail iller-neden', 'Uygulamada neden yok: ' + o.neden));
    if (o.not) li.append(el('p', 'item-detail', o.not));
    var row = el('div', 'btn-row');
    if (o.url) row.append(extLink(o.url, o.urlTxt || 'Siteyi aç'));
    (o.ek || []).forEach(function (e) { row.append(extLink(e.url, e.t, 'btn btn-sm btn-ghost')); });
    if (row.firstChild) li.append(row);
    return li;
  }
  function renderIller() {
    var L = window.GMIILLER;
    if (!L) return;
    var y = clear($('iller-yayin')); (L.yayinlayan || []).forEach(function (o) { y.append(odaItem(o)); });
    var a = clear($('iller-app')); (L.uygulama || []).forEach(function (o) { a.append(odaItem(o)); });
    var k = clear($('iller-yok'));
    (L.bulunamayan || []).forEach(function (o) {
      var li = el('li', 'item iller-mini'); li.append(el('strong', null, o.il + ' '), el('span', 'pmeta', o.oda));
      if (o.not) li.append(el('div', 'pmeta', o.not));
      k.append(li);
    });
    if (L.ikoEkran) $('iller-iko').textContent = L.ikoEkran.iller.join(', ') + '. Bu illerdeki bazı kuyumcular İKO\'nun fiyat ekranını kullanıyor; bölge fiyatları İKO\'nun uygulamalarında görülebilir. Kaynak: ' + L.ikoEkran.kaynak + ' (güncel olmayabilir).';
    $('iller-not').textContent = 'Son kontrol: ' + L.kontrol + '. Bazı sitelerdeki "il il altın fiyatları" sayfaları her il için aynı ulusal fiyatı gösteriyor; bunlar il fiyatı olmadığı için burada kullanılmıyor. Bir oda verisinin uygulamada kullanılmasına yazılı izin verirse fiyatlar doğrudan bu sekmeye eklenebilir.';
    // karşılaştırma için ulusal serbest piyasa (Truncgil)
    var ref = clear($('iller-ref')), g = rows('gold'), gram = g.filter(function (r) { return r.metric === 'RETAIL'; })[0], cy = g.filter(function (r) { return r.metric === 'CEYREK'; })[0];
    if (gram || cy) {
      var c = el('div', 'card iller-refcard');
      c.append(el('div', 'pname', 'Karşılaştırma için: ulusal serbest piyasa (Truncgil)'));
      var parts = [];
      if (gram) parts.push('Gram altın alış ' + num(gram.bid, 2) + ' / satış ' + num(gram.ask, 2) + ' TL');
      if (cy) parts.push('Çeyrek alış ' + num(cy.bid, 0) + ' / satış ' + num(cy.ask, 0) + ' TL');
      c.append(el('div', 'item-detail', parts.join(' · ')));
      c.append(el('div', 'pmeta', 'Saat ' + ((gram || cy).time || '—') + '. Odaların tavsiye fiyatları genelde bunun üstündedir (işçilik ve kâr payı). Tüm türler Altın sekmesinde.'));
      ref.append(c);
    }
  }

  function renderTech() {
    var tb = clear($('tech').tBodies[0]);
    rows('tech').slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (r) {
      var tr = el('tr');
      var sc = el('td'); if (r.signal) sc.append(sigBadge(r.signal_code, r.signal, true)); else sc.textContent = '—';
      tr.append(td(r.name), sc, td(scoreTxt(r.daily_score), scoreCls(r.daily_score)), td(scoreTxt(r.short_score), scoreCls(r.short_score)),
        td(num(r.rsi, 1)), td(num(r.s1, r.dp)), td(num(r.r1, r.dp)), td(r.trend || '—', 'wrap'));
      tr.className = 'tap'; tr.addEventListener('click', function () { openChart(r.key); });
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
    var ss = clear($('sig-stats'));
    if (GA && GA.signalStats) {
      var by = GA.signalStats().by, codes = ['GAL', 'AL', 'SAT', 'GSAT'].filter(function (c) { return by[c]; });
      if (codes.length) {
        var tbl = el('table', 'tbl'), th = el('thead'), hr = el('tr');
        ['Etiket', 'İsabet', 'Iska', 'Yatay', 'İsabet oranı'].forEach(function (h) { hr.append(el('th', null, h)); });
        th.append(hr); tbl.append(th);
        var tb2 = el('tbody');
        codes.forEach(function (c) {
          var b = by[c], n = (b.isabet || 0) + (b['ıska'] || 0), tr = el('tr'), sc = el('td');
          sc.append(sigBadge(c, GA.SIG_LABEL[c]));
          tr.append(sc, td(String(b.isabet || 0)), td(String(b['ıska'] || 0)), td(String(b.yatay || 0)), td(n ? '%' + num(100 * b.isabet / n, 0) : '—'));
          tb2.append(tr);
        });
        tbl.append(tb2);
        var w = el('div', 'tw'); w.append(tbl); ss.append(w);
      }
    }
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
  function openSheet() {
    $('sheet').hidden = false; $('sheet-bg').hidden = false;
    if (NATIVE) { renderBgLog(); renderNt(); } else refreshPushStatus();
  }
  function renderBgLog() {
    if (!NATIVE) return;
    var j = {};
    try { j = JSON.parse(NATIVE.backgroundLog() || '{}'); } catch (e) { j = {}; }
    if (!j.time) { $('bg-log').textContent = 'Henüz arka plan kontrolü yapılmadı.'; return; }
    var px = j.prices || {}, parts = [];
    if (px.ons) parts.push('ons ' + px.ons);
    if (px.gram) parts.push('gram ' + px.gram);
    if (px.usdtry) parts.push('USD/TRY ' + px.usdtry);
    var txt = 'Son kontrol: ' + when(j.time) + (j.manual ? ' (elle)' : '') + (j.note ? ' · ' + j.note : '') + (parts.length ? ' · ' + parts.join(' · ') : '') + (j.new_alerts != null ? ' · yeni uyarı: ' + j.new_alerts : '') + (j.alarms ? ' · çalan alarm: ' + j.alarms : '');
    if (j.errors && j.errors.length) txt += ' · alınamayan veri: ' + j.errors.length;
    $('bg-log').textContent = txt;
  }
  function renderNt() { if (NATIVE) renderNtList(); }
  function setupNative() {
    if (!NATIVE) { if ($('apk-link') && CFG.apkUrl) $('apk-link').href = CFG.apkUrl; return; }
    $('native-only').hidden = false; $('web-only').hidden = true;
    try { $('bg-toggle').checked = NATIVE.backgroundOn(); } catch (e) { /* yok say */ }
    $('bg-toggle').addEventListener('change', function () { NATIVE.setBackground(this.checked); renderBgLog(); });
    $('btn-check-now').addEventListener('click', function () {
      NATIVE.checkNow(); $('bg-log').textContent = 'Kontrol başlatıldı; sonuç birkaç saniye içinde bildirim olarak gelir ve burada görünür.';
      setTimeout(function () { renderBgLog(); renderNtList(); }, 12000); setTimeout(function () { renderBgLog(); renderNtList(); }, 30000);
    });
    $('btn-battery').addEventListener('click', function () { NATIVE.openBatterySettings(); });
    $('btn-nt-test').addEventListener('click', function () { NATIVE.testNotification(); $('nt-test-msg').textContent = 'Deneme bildirimi gönderildi. Gelmediyse yukarıdaki listede ✗ olan maddeyi düzeltin.'; });
    if ($('ozet-toggle')) $('ozet-toggle').addEventListener('change', function () { try { NATIVE.setDailySummary(this.checked); } catch (e) { /* eski sürüm */ } });
    try { $('ver').textContent = 'Sürüm ' + VERSION + ' · Android ' + NATIVE.version(); } catch (e) { /* yok say */ }
  }
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
        var v = null;
        try { v = JSON.parse(localStorage.getItem('gmi-vapid') || 'null'); } catch (_) { v = null; }
        if (v) showCode(v, sub);
      } else {
        st.textContent = 'Bildirimler kapalı. Açmak için düğmeye dokunun.';
      }
    }).catch(function () { st.textContent = 'Bildirim durumu okunamadı.'; });
  }
  function u8ToB64u(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Bildirim anahtarları bu telefonda üretilir; özel anahtar yalnız sizin kopyaladığınız kodda ve GitHub'daki gizli değerde bulunur.
  function getVapid() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem('gmi-vapid') || 'null'); } catch (_) { v = null; }
    if (v && v.publicKey && v.privateKey) return Promise.resolve(v);
    return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']).then(function (kp) {
      return Promise.all([crypto.subtle.exportKey('raw', kp.publicKey), crypto.subtle.exportKey('jwk', kp.privateKey)]);
    }).then(function (res) {
      v = { publicKey: u8ToB64u(new Uint8Array(res[0])), privateKey: res[1].d };
      try { localStorage.setItem('gmi-vapid', JSON.stringify(v)); } catch (_) {}
      return v;
    });
  }
  function showCode(v, sub) {
    $('push-code').value = JSON.stringify({ v: 1, vapidPublicKey: v.publicKey, vapidPrivateKey: v.privateKey, subscription: sub.toJSON ? sub.toJSON() : sub });
    $('push-box').hidden = false;
  }
  function enablePush() {
    if (!pushSupported() || !(window.crypto && crypto.subtle)) { refreshPushStatus(); return; }
    var vapid = null;
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { refreshPushStatus(); return null; }
      return getVapid().then(function (v) {
        vapid = v;
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          var key = b64uToU8(vapid.publicKey);
          if (sub) {
            var cur = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
            var same = cur && cur.length === key.length && cur.every(function (b, i) { return b === key[i]; });
            if (same) return sub;
            return sub.unsubscribe().then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); });
          }
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        });
      });
    }).then(function (sub) {
      if (!sub) return;
      showCode(vapid, sub);
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

  /* ---------- yeni bölümler için ortak yardımcılar (birikim, alarm, defter, yedek, yakın) ---------- */
  // Varlıklar: ad, birim, ondalık, yerel (Truncgil) anahtarı
  var VARLIK = {
    GRAM: { ad: 'Gram altın', birim: 'TL', dp: 2, tg: 'gram', miktar: 'gram' },
    CEYREK: { ad: 'Çeyrek altın', birim: 'TL', dp: 2, tg: 'ceyrek', miktar: 'adet' },
    YARIM: { ad: 'Yarım altın', birim: 'TL', dp: 2, tg: 'yarim', miktar: 'adet' },
    TAM: { ad: 'Tam altın', birim: 'TL', dp: 2, tg: 'tam', miktar: 'adet' },
    ATA: { ad: 'Cumhuriyet (Ata) altını', birim: 'TL', dp: 2, tg: 'ata', miktar: 'adet' },
    GUMUS_TL: { ad: 'Gümüş (gram)', birim: 'TL', dp: 2, tg: 'gumus', miktar: 'gram' },
    USD: { ad: 'Dolar', birim: 'TL', dp: 4, tg: 'usd', yahoo: 'USDTRY', miktar: '$' },
    EUR: { ad: 'Euro', birim: 'TL', dp: 4, tg: 'eur', yahoo: 'EURTRY', miktar: '€' },
    ONS: { ad: 'Ons altın', birim: '$', dp: 2, spot: 'ONS_SPOT', yahoo: 'GOLD_FUT' },
    GUMUS_ONS: { ad: 'Gümüş (ons)', birim: '$', dp: 3, spot: 'GUMUS_SPOT', yahoo: 'SILVER_FUT' },
    BIST: { ad: 'BIST 100', birim: '', dp: 0, yahoo: 'XU100' },
    BTC: { ad: 'Bitcoin', birim: '$', dp: 0, yahoo: 'BTC' },
    BRENT: { ad: 'Brent petrol', birim: '$', dp: 2, yahoo: 'BRENT' }
  };
  function priceRow(key) { return rows('prices').filter(function (r) { return r.key === key; })[0] || null; }
  // Bir varlığın şu anki fiyatı. alan: 'satis' (alırken ödenen), 'alis' (satarken alınan) ya da boş.
  // Sıra arka plan kontrolüyle aynıdır: yerel altında Truncgil; onsta spot, yoksa vadeli; dövizde Yahoo, yoksa serbest piyasa, yoksa TCMB.
  function fiyat(key, alan) {
    var v = VARLIK[key], d = state.data;
    if (!v || !d) return null;
    var tg = d.local || null, p;
    if (v.tg && !v.yahoo) {
      p = tg && tg[v.tg];
      if (!p) {
        if (key === 'GRAM') { var t = priceRow('GRAM_ALTIN_TEORIK'); if (t && t.value) return { v: t.value, src: 'teorik gram (Truncgil alınamadı)', time: t.time }; }
        return null;
      }
      return { v: alan === 'alis' ? p[0] : p[1], alis: p[0], satis: p[1], src: (alan === 'alis' ? 'alış' : 'satış') + ' · Truncgil', time: tg.time };
    }
    if (v.spot) { var sp = priceRow(v.spot); if (sp && sp.value) return { v: sp.value, src: 'spot · gold-api.com', time: sp.time }; }
    if (v.yahoo) {
      var y = priceRow(v.yahoo);
      if (v.tg && alan) { p = tg && tg[v.tg]; if (p) return { v: alan === 'alis' ? p[0] : p[1], alis: p[0], satis: p[1], src: (alan === 'alis' ? 'alış' : 'satış') + ' · serbest piyasa (Truncgil)', time: tg.time }; }
      if (y && y.value) return { v: y.value, src: 'Yahoo Finance', time: y.time };
      if (v.tg) {
        p = tg && tg[v.tg];
        if (p) return { v: p[1], alis: p[0], satis: p[1], src: 'satış · serbest piyasa (Truncgil)', time: tg.time };
        var tc = priceRow(v.yahoo + '_TCMB');
        if (tc) return { v: tc.ask, alis: tc.bid, satis: tc.ask, src: 'TCMB gösterge kuru', time: tc.time };
      }
    }
    return null;
  }
  function lsGetJ(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (e) { return def; } }
  function lsSetJ(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  window.GMIAPP = {
    data: function () { return state.data; }, native: NATIVE, VARLIK: VARLIK, fiyat: fiyat, priceRow: priceRow,
    num: num, pct: pct, when: when, sign: sign, parseTr: parseTr, el: el, clear: clear, extLink: extLink, MON: MON,
    lsGet: lsGetJ, lsSet: lsSetJ, makasGet: makasGet, makasKaydet: makasKaydet, openSheet: openSheet, go: go,
    refreshBanner: function () { if (state.data) renderBanner(); }
  };

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
  $('ch-close').addEventListener('click', closeChart);
  $('chart-bg').addEventListener('click', closeChart);
  $('ch-terms').addEventListener('click', openTerms);
  $('btn-bt').addEventListener('click', function () { runBacktest(true); });
  $('mk-hesapla').addEventListener('click', makasHesapla);
  document.querySelectorAll('#ch-tf button').forEach(function (b) { b.addEventListener('click', function () { if (b.disabled) return; chartState.tf = b.getAttribute('data-tf'); chartState.view = null; drawChart(); }); });
  document.querySelectorAll('#ch-span button').forEach(function (b) { b.addEventListener('click', function () { chartState.span = +b.getAttribute('data-span'); chartState.view = null; drawChart(); }); });
  document.querySelectorAll('#ch-katman button').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-k'); chartState.katman[k] = !chartState.katman[k];
      try { localStorage.setItem('gmi-katman', JSON.stringify(chartState.katman)); } catch (e) { /* yok say */ }
      drawChart();
    });
  });
  $('ver').textContent = 'Sürüm ' + VERSION;
  setupNative();
  window.gmiOnResume = function () {
    if (!state.loading && Date.now() - state.fetchedAt > (CFG.autoRefreshMinutes || 5) * 6e4) load();
    else if (!$('sheet').hidden) { renderBgLog(); renderNtList(); }
    if (state.data) renderBanner();
    try { document.dispatchEvent(new CustomEvent('gmi:resume')); } catch (e) { /* yok say */ }
  };
  if (isStandalone()) $('install-text').textContent = 'Uygulama bu telefonda yüklü.';

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); installEvt = e; $('btn-install').hidden = false; renderBanner();
  });
  window.addEventListener('appinstalled', function () { installEvt = null; $('btn-install').hidden = true; renderBanner(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - state.fetchedAt > (CFG.autoRefreshMinutes || 5) * 6e4) load();
  });
  var resizeT = null;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (!$('v-altin').hidden) renderLadder(); if (chartState.key) drawChart(); }, 200); });

  if (!NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  renderIller();
  show(location.hash.slice(1));
  load();
})();
