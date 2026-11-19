/* Fiyat alarmları (Birikim sekmesi). Android uygulamasında liste telefonun yerel deposunda tutulur; arka plan kontrolü
   (≈15 dk) ve uygulama açıkken arayüz fiyatı kontrol eder. Çalan alarm tek kimlikle kaydedildiği için aynı alarm iki kez
   bildirim göndermez. Web sürümünde arka plan yoktur; alarm yalnız sayfa açıkken kontrol edilir. */
(function () {
  'use strict';
  var LS = 'gmi-alarm', LSH = 'gmi-alarm-hit', MAX = 30;
  var LISTE = ['GRAM', 'CEYREK', 'YARIM', 'TAM', 'ATA', 'GUMUS_TL', 'USD', 'EUR', 'ONS', 'GUMUS_ONS', 'BIST', 'BTC', 'BRENT'];
  var onayBekleyen = null;
  function A() { return window.GMIAPP; }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function num(v, dp) { return A().num(v, dp); }
  function N() { var n = window.GMI_NATIVE; return n && typeof n.alarmsGet === 'function' ? n : null; }
  function liste() {
    var n = N();
    if (n) { try { return JSON.parse(n.alarmsGet() || '[]'); } catch (e) { return []; } }
    return A().lsGet(LS, []);
  }
  function kaydet(l) { var n = N(); if (n) n.alarmsSet(JSON.stringify(l)); else A().lsSet(LS, l); }
  function hits() {
    var n = N();
    if (n) { try { return JSON.parse(n.alarmHits() || '{}'); } catch (e) { return {}; } }
    return A().lsGet(LSH, {});
  }
  function yerel(k) { var v = A().VARLIK[k]; return !!(v && v.tg && !v.yahoo); }
  function simdi(asset, field) { return A().fiyat(asset, yerel(asset) ? (field || 'satis') : null); }
  function birim(a) { return a.unit ? ' ' + a.unit : ''; }
  function zaman() {
    var d = new Date(), p = function (x) { return ('0' + x).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function yeniId() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  // Uygulama açıkken: güncel veriyle alarmları kontrol et
  function kontrol() {
    if (!A() || !A().data()) return;
    var l = liste(), h = hits(), degisti = false, n = N();
    l.forEach(function (a) {
      if (!a.on || h[a.id]) return;
      var f = simdi(a.asset, a.field);
      if (!f || !isFinite(f.v)) return;
      var up = a.dir === 'ust';
      if (up ? f.v >= a.price : f.v <= a.price) {
        var title = 'Fiyat alarmı: ' + num(a.price, a.dp) + birim(a) + (up ? ' üstü' : ' altı');
        var text = a.name + ' ' + num(f.v, a.dp) + birim(a) + ' (' + f.src + ')' + (a.note ? ' · ' + a.note : '');
        if (n && typeof n.alarmHit === 'function') n.alarmHit(a.id, f.v, f.src, 'GMI · ' + a.name + ': ' + title, text);
        else { h[a.id] = { t: zaman(), px: f.v, src: f.src }; A().lsSet(LSH, h); }
        degisti = true;
      }
    });
    if (degisti) render();
  }

  function render() {
    var ol = $('al-list');
    if (!ol || !A()) return;
    A().clear(ol);
    var l = liste(), h = hits();
    var n = N();
    if (n && typeof n.notificationsAllowed === 'function') {
      var izin = true;
      try { izin = n.notificationsAllowed(); } catch (e) { izin = true; }
      if (!izin && l.length) ol.append(el('li', 'item al-uyari', 'Bildirim izni kapalı: alarm çalsa da telefona bildirim gelmez. Ayarlar (⚙) → Bildirimler bölümünden açabilirsin.'));
    }
    if (!n && l.length) ol.append(el('li', 'item al-uyari', 'Bu web sürümünde arka plan yok: alarmlar yalnız bu sayfa açıkken kontrol edilir. Bildirim için Android uygulamasını kullan.'));
    if (!l.length) { ol.append(el('li', 'item pmeta', 'Kurulu alarm yok.')); return; }
    l.slice().sort(function (x, y) { return (h[x.id] ? 1 : 0) - (h[y.id] ? 1 : 0) || String(y.created).localeCompare(String(x.created)); }).forEach(function (a) {
      var li = el('li', 'item al-item' + (h[a.id] ? ' al-caldi' : ''));
      li.append(el('strong', null, a.name + ' ' + num(a.price, a.dp) + birim(a) + (a.dir === 'ust' ? ' üstüne çıkarsa' : ' altına inerse')));
      var hit = h[a.id];
      if (hit) {
        li.append(el('div', 'al-durum caldi', 'Çaldı · ' + A().when(hit.t) + (hit.px != null ? ' · ' + num(hit.px, a.dp) + birim(a) : '') + (hit.src ? ' (' + hit.src + ')' : '')));
      } else {
        var f = simdi(a.asset, a.field);
        li.append(el('div', 'al-durum', f ? 'Bekliyor · şu an ' + num(f.v, a.dp) + birim(a) + ' · seviyeye ' + A().pct(100 * Math.abs(a.price / f.v - 1), 1) + ' uzakta' : 'Bekliyor · şu anki fiyat alınamadı'));
      }
      if (a.note) li.append(el('div', 'pmeta', a.note));
      var row = el('div', 'btn-row');
      if (hit) {
        var yeniden = el('button', 'btn btn-sm', 'Yeniden kur');
        yeniden.type = 'button';
        yeniden.addEventListener('click', function () {
          var f = simdi(a.asset, a.field);
          if (f && ((a.dir === 'ust') ? f.v >= a.price : f.v <= a.price)) { $('al-msg').textContent = 'Fiyat hâlâ seviyenin ' + (a.dir === 'ust' ? 'üstünde' : 'altında') + '; yeniden kurulsa hemen çalardı.'; return; }
          var l2 = liste().filter(function (y) { return y.id !== a.id; });
          var b = JSON.parse(JSON.stringify(a)); b.id = yeniId(); b.created = zaman(); b.on = true;
          l2.push(b); kaydet(l2); $('al-msg').textContent = 'Alarm yeniden kuruldu.'; render();
        });
        row.append(yeniden);
      }
      var sil = el('button', 'btn btn-sm btn-ghost', 'Sil');
      sil.type = 'button';
      sil.addEventListener('click', function () {
        kaydet(liste().filter(function (y) { return y.id !== a.id; }));
        if (!N()) { var hh = A().lsGet(LSH, {}); delete hh[a.id]; A().lsSet(LSH, hh); }
        render();
      });
      row.append(sil);
      li.append(row);
      ol.append(li);
    });
  }

  function ipucu() {
    var k = $('al-varlik').value, alan = $('al-alan').value, f = simdi(k, alan), V = A().VARLIK[k];
    $('al-alan-lbl').hidden = !yerel(k);
    $('al-simdi').textContent = f ? 'Şu an: ' + num(f.v, V.dp) + (V.birim ? ' ' + V.birim : '') + ' (' + f.src + (f.time ? ', ' + f.time : '') + ')' : 'Şu anki fiyat henüz alınmadı.';
    if (f) $('al-fiyat').placeholder = 'ör. ' + num(f.v, V.dp > 2 ? 2 : V.dp);
    onayBekleyen = null;
  }

  function kur(e) {
    e.preventDefault();
    var k = $('al-varlik').value, V = A().VARLIK[k], alan = yerel(k) ? $('al-alan').value : null, dir = $('al-yon').value, msg = $('al-msg');
    var p = A().parseTr($('al-fiyat').value);
    if (!p || p <= 0) { msg.textContent = 'Seviyeyi yaz (ör. 5.400).'; return; }
    if (liste().filter(function (a) { return a.on; }).length >= MAX) { msg.textContent = 'En çok ' + MAX + ' alarm kurulabilir; önce birini sil.'; return; }
    var f = simdi(k, alan);
    if (f && (dir === 'ust' ? f.v >= p : f.v <= p)) { msg.textContent = 'Fiyat şu an zaten ' + num(f.v, V.dp) + (V.birim ? ' ' + V.birim : '') + '; bu alarm hemen çalardı. Seviyeyi ya da yönü değiştir.'; return; }
    var imza = [k, alan, dir, p].join('|');
    if (f && Math.abs(p / f.v - 1) > 0.3 && onayBekleyen !== imza) {
      onayBekleyen = imza;
      msg.textContent = 'Seviye şu anki fiyattan ' + A().pct(100 * Math.abs(p / f.v - 1), 0) + ' uzakta. Doğruysa "Alarm kur"a yeniden dokun.';
      return;
    }
    onayBekleyen = null;
    var a = { id: yeniId(), asset: k, name: V.ad + (alan ? ' (' + (alan === 'alis' ? 'alış' : 'satış') + ')' : ''), unit: V.birim, dp: V.dp, dir: dir, price: p, field: alan,
      note: $('al-not').value.trim(), on: true, created: zaman() };
    var l = liste(); l.push(a); kaydet(l);
    $('al-fiyat').value = ''; $('al-not').value = '';
    msg.textContent = 'Alarm kuruldu.' + (N() ? ' Telefon arka planda yaklaşık 15 dakikada bir kontrol eder.' : '');
    render();
  }

  function init() {
    if (!$('al-form') || !A()) return;
    var sel = $('al-varlik');
    LISTE.forEach(function (k) { var o = el('option', null, A().VARLIK[k].ad); o.value = k; sel.append(o); });
    sel.addEventListener('change', ipucu);
    $('al-alan').addEventListener('change', ipucu);
    $('al-form').addEventListener('submit', kur);
    ipucu();
    render();
    document.addEventListener('gmi:data', function () { kontrol(); ipucu(); render(); });
    document.addEventListener('gmi:resume', render);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.GMIALARM = { render: render, kontrol: kontrol, liste: liste };
})();
