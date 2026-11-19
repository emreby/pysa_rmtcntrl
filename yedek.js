/* Yedekleme (Ayarlar): birikim, fiyat alarmları, kuyumcu fiyat defteri, alış-satış farkı, karne ve uyarı geçmişi tek dosyada.
   Android'de dosya, Android'in kaydetme ekranıyla kullanıcının seçtiği yere yazılır; geri yüklemede dosya seçilir.
   Dosya yalnız kullanıcının seçtiği yerde durur; uygulama hiçbir yere göndermez. */
(function () {
  'use strict';
  var KEYS = ['gmi-birikim', 'gmi-defter', 'gmi-makas', 'gmi-alarm', 'gmi-alarm-hit', 'gmi-sinyal-log', 'gmi-uyarilar', 'gmi-gecmis-test'];
  var bekleyen = null;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function N() { return window.GMI_NATIVE || null; }
  function msg(t) { $('yd-msg').textContent = t || ''; }
  function sayi(s) { try { var v = JSON.parse(s); return Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0); } catch (e) { return 0; } }
  function dosyaAdi() {
    var d = new Date(), p = function (x) { return ('0' + x).slice(-2); };
    return 'gmi-yedek-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  }

  function topla() {
    var ls = {};
    KEYS.forEach(function (k) { var v = null; try { v = localStorage.getItem(k); } catch (e) { v = null; } if (v != null) ls[k] = v; });
    var n = N(), nat = null;
    if (n && typeof n.alarmsGet === 'function') {
      var d = {};
      try { d = JSON.parse(n.notifStatus() || '{}'); } catch (e) { d = {}; }
      nat = { alarms: n.alarmsGet(), ozet: !!d.ozet, arka: typeof n.backgroundOn === 'function' ? n.backgroundOn() : true };
    }
    return { tur: 'gmi-yedek', v: 1, tarih: new Date().toISOString(), ls: ls, native: nat };
  }

  function yedekAl() {
    var y = topla(), json = JSON.stringify(y), n = N();
    var ozet = ozetTxt(y);
    if (n && typeof n.saveFile === 'function') {
      window.__gmiSaved = function (ok, m) { msg(ok ? m + ' İçerik: ' + ozet + '.' : m); };
      msg('Kaydetme ekranı açılıyor… Dosyayı İndirilenler ya da Drive gibi bir yere kaydet.');
      n.saveFile(dosyaAdi(), json);
      return;
    }
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = dosyaAdi();
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      msg('Yedek indirildi. İçerik: ' + ozet + '.');
    } catch (e) { msg('Yedek alınamadı: ' + (e && e.message ? e.message : e)); }
  }

  function ozetTxt(y) {
    var ls = y.ls || {}, p = [];
    p.push(sayi(ls['gmi-birikim'] || '[]') + ' birikim kaydı');
    p.push((y.native && y.native.alarms ? sayi(y.native.alarms) : sayi(ls['gmi-alarm'] || '[]')) + ' alarm');
    p.push(sayi(ls['gmi-defter'] || '[]') + ' fiyat defteri kaydı');
    if (ls['gmi-makas']) p.push('alış-satış farkı');
    if (ls['gmi-sinyal-log']) p.push('karne');
    return p.join(', ');
  }

  function dosyaSecildi() {
    var f = $('yd-dosya').files && $('yd-dosya').files[0];
    $('yd-onay').hidden = true;
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var y = null;
      try { y = JSON.parse(String(r.result || '')); } catch (e) { y = null; }
      $('yd-dosya').value = '';
      if (!y || y.tur !== 'gmi-yedek' || !y.ls) { msg('Bu dosya bir GMI Piyasa yedeği değil.'); return; }
      bekleyen = y;
      var box = $('yd-onay');
      A().clear(box);
      var t = new Date(y.tarih);
      box.append(el('p', 'sub', 'Yedek: ' + (isFinite(t) ? t.toLocaleString('tr-TR') : '?') + ' · ' + ozetTxt(y) + '. Yedekteki bilgiler bu telefondakilerin yerine yazılacak.'));
      var row = el('div', 'btn-row'), ok = el('button', 'btn', 'Geri yükle'), no = el('button', 'btn btn-ghost', 'Vazgeç');
      ok.type = 'button'; no.type = 'button';
      ok.addEventListener('click', uygula);
      no.addEventListener('click', function () { bekleyen = null; box.hidden = true; msg(''); });
      row.append(ok, no); box.append(row); box.hidden = false;
      msg('');
    };
    r.onerror = function () { msg('Dosya okunamadı.'); };
    r.readAsText(f);
  }
  function A() { return window.GMIAPP; }

  function uygula() {
    var y = bekleyen;
    if (!y) return;
    bekleyen = null;
    try {
      KEYS.forEach(function (k) { if (typeof y.ls[k] === 'string') localStorage.setItem(k, y.ls[k]); });
      var n = N();
      if (n && y.native) {
        if (typeof y.native.alarms === 'string' && typeof n.alarmsSet === 'function') n.alarmsSet(y.native.alarms);
        if (typeof n.setDailySummary === 'function') n.setDailySummary(!!y.native.ozet);
        if (typeof n.setBackground === 'function') n.setBackground(y.native.arka !== false);
      } else if (n && typeof n.alarmsSet === 'function' && y.ls['gmi-alarm']) {
        n.alarmsSet(y.ls['gmi-alarm']);
      }
      msg('Geri yüklendi. Uygulama yenileniyor…');
      setTimeout(function () { location.reload(); }, 800);
    } catch (e) { msg('Geri yüklenemedi: ' + (e && e.message ? e.message : e)); }
  }

  function init() {
    if (!$('yd-al')) return;
    $('yd-al').addEventListener('click', yedekAl);
    $('yd-dosya').addEventListener('change', dosyaSecildi);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.GMIYEDEK = { topla: topla };
})();
