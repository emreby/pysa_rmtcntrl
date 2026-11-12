/* GMI yorum motoru: göstergelerden sade Türkçe yorum yazar.
   Kurallar sabittir ve göstergelerin o anki değerlerini anlatır; tahmin, kesin yön ya da yatırım tavsiyesi üretmez.
   window.GMIYORUM.asset(sinyal, bağlam)  → { lead: [cümle], sections: [{ h: başlık, items: [cümle] }] }
   window.GMIYORUM.short(sinyal)          → kart için tek satır
   window.GMIYORUM.chart(grafikDurumu, sinyal) → seçili zaman dilimine göre cümleler
   window.GMIYORUM.market(veri)           → Piyasa sekmesi için paragraflar */
(function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function n(v, dp) {
    if (!isNum(v)) return '—';
    return v.toLocaleString('tr-TR', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace('-', '−');
  }
  // değer + birim ("4.012,5 $", "6.150,25 TL", "%4,25")
  function P(x, v) {
    if (!isNum(v)) return '—';
    var u = x && x.unit;
    if (u === '%') return '%' + n(v, x.dp);
    return n(v, x ? x.dp : 2) + (u ? ' ' + u : '');
  }
  function sp(v, dp) { return isNum(v) ? (v > 0 ? '+' : (v < 0 ? '−' : '')) + '%' + n(Math.abs(v), dp == null ? 2 : dp) : '—'; }
  function absPct(v, dp) { return '%' + n(Math.abs(v), dp == null ? 1 : dp); }
  function prevOf(x) { return isNum(x.price) && isNum(x.chg) ? x.price / (1 + x.chg / 100) : null; }
  function dayMoveAtr(x) {
    var atr = x.atr || (x.ind && x.ind.d && x.ind.d.atr14), pv = prevOf(x);
    return isNum(atr) && atr > 0 && isNum(pv) ? Math.abs(x.price - pv) / atr : null;
  }
  function D(x) { return (x && x.ind && x.ind.d) || {}; }

  var SIG_MEAN = {
    GAL: 'Teknik sinyal GÜÇLÜ AL: günlük göstergelerin büyük çoğunluğu yükselişi gösteriyor, 4 saatlik ve 1 saatlik grafikler de aynı yönde.',
    AL: 'Teknik sinyal AL: günlük göstergelerin çoğu yükselişi gösteriyor; kısa vadeli grafikler buna belirgin biçimde karşı değil.',
    NOTR: 'Teknik sinyal NÖTR: göstergeler bölünmüş, belirgin bir yön yok.',
    SAT: 'Teknik sinyal SAT: günlük göstergelerin çoğu düşüşü gösteriyor; kısa vadeli grafikler buna belirgin biçimde karşı değil.',
    GSAT: 'Teknik sinyal GÜÇLÜ SAT: günlük göstergelerin büyük çoğunluğu düşüşü gösteriyor, 4 saatlik ve 1 saatlik grafikler de aynı yönde.',
    VERI: 'Göstergeleri hesaplamak için yeterli veri yok.'
  };

  /* ---------- ortak parçalar ---------- */
  // fiyatın üç ortalamaya göre konumu
  function maPos(p, s20, s50, s200) {
    return { a20: isNum(s20) ? p > s20 : null, a50: isNum(s50) ? p > s50 : null, a200: isNum(s200) ? p > s200 : null };
  }
  // u: 'günlük' ya da 'dönemlik'; ilk cümle öznesi: "Fiyat" (günlük yorum) ya da "Son mum" (grafik yorumu)
  function maStory(m, u, subj) {
    u = u || 'günlük'; subj = subj || 'Fiyat';
    if (m.a50 === null || m.a200 === null) {
      if (m.a20 !== null && m.a50 !== null) return subj + ' 20 ve 50 ' + u + ' ortalamaların ' + (m.a20 && m.a50 ? 'üstünde: eğilim yukarı.' : (!m.a20 && !m.a50 ? 'altında: eğilim aşağı.' : 'arasında: yön belirsiz.'));
      return null;
    }
    if (m.a20 === null) {
      if (m.a50 && m.a200) return subj + ' 50 ve 200 ' + u + ' ortalamaların üstünde: eğilim yukarı.';
      if (!m.a50 && !m.a200) return subj + ' 50 ve 200 ' + u + ' ortalamaların altında: eğilim aşağı.';
      return null;
    }
    if (m.a20 && m.a50 && m.a200) return subj + ' üç ortalamanın da üstünde: kısa, orta ve uzun vade aynı yönde, yukarı.';
    if (!m.a20 && !m.a50 && !m.a200) return subj + ' üç ortalamanın da altında: kısa, orta ve uzun vade aynı yönde, aşağı.';
    if (m.a200 && m.a50 && !m.a20) return subj + ' 50 ve 200 ' + u + ' ortalamaların üstünde, yalnız 20 ' + u + ' ortalamanın altında: yukarı eğilim içinde kısa süreli bir geri çekilme.';
    if (!m.a200 && !m.a50 && m.a20) return subj + ' 50 ve 200 ' + u + ' ortalamaların altında, yalnız 20 ' + u + ' ortalamanın üstünde: aşağı eğilim içinde kısa süreli bir tepki.';
    if (m.a200 && !m.a50) return subj + ' 200 ' + u + ' ortalamanın üstünde ama 50 ' + u + ' ortalamanın altında: bu tablo genelde yükseliş eğilimi içinde bir düzeltme olarak okunur.';
    if (!m.a200 && m.a50) return subj + ' 200 ' + u + ' ortalamanın altında ama 50 ' + u + ' ortalamanın üstünde: düşüş eğilimi içinde bir toparlanma denemesi.';
    return null;
  }
  function rsiText(r, rp) {
    if (!isNum(r)) return null;
    var t = 'RSI (14) ' + n(r, 0);
    if (isNum(rp)) t += r > rp + 1 ? ', yükseliyor (önceki ' + n(rp, 0) + ')' : (r < rp - 1 ? ', düşüyor (önceki ' + n(rp, 0) + ')' : ', yatay');
    if (r >= 70) return t + ': aşırı alım bölgesinde (70 üstü). Fiyat kısa sürede çok yükselmiş; bu bölgede yükseliş yavaşlayabilir ya da geri çekilme görülebilir. Güçlü trendlerde RSI uzun süre 70\'in üstünde de kalabilir.';
    if (r >= 60) return t + ': güçlü bölgede, alıcılar baskın.';
    if (r > 40) return t + ': nötr bölgede (40–60), belirgin bir baskı yok.';
    if (r > 30) return t + ': zayıf bölgede, satıcılar baskın.';
    return t + ': aşırı satım bölgesinde (30 altı). Fiyat kısa sürede çok düşmüş; bu bölgede tepki yükselişleri görülebilir. Güçlü düşüşlerde RSI uzun süre 30\'un altında da kalabilir.';
  }
  function rsiWord(r) { return !isNum(r) ? '—' : (r >= 70 ? 'aşırı alım' : r <= 30 ? 'aşırı satım' : r >= 60 ? 'güçlü' : r <= 40 ? 'zayıf' : 'nötr'); }
  function macdText(m, s, h, hp, longNames, lastWord) {
    if (!isNum(h)) return null;
    var t;
    if (isNum(hp) && (h > 0) !== (hp > 0)) t = 'MACD ' + (lastWord || 'son mumda') + ' sinyal çizgisini ' + (h > 0 ? 'yukarı kesti: yükseliş ivmesi başlıyor olabilir.' : 'aşağı kesti: düşüş ivmesi başlıyor olabilir.');
    else if (h > 0) t = isNum(hp) && Math.abs(h) < Math.abs(hp) ? 'MACD sinyal çizgisinin üstünde ama fark daralıyor: yükseliş ivmesi zayıflıyor.' : 'MACD sinyal çizgisinin üstünde ve fark açılıyor: yükseliş ivmesi artıyor.';
    else t = isNum(hp) && Math.abs(h) < Math.abs(hp) ? 'MACD sinyal çizgisinin altında ama fark daralıyor: düşüş ivmesi zayıflıyor.' : 'MACD sinyal çizgisinin altında ve fark açılıyor: düşüş ivmesi artıyor.';
    if (isNum(m) && longNames) t += m > 0 ? ' MACD sıfırın üstünde (12 günlük üssel ortalama 26 günlüğün üstünde).' : ' MACD sıfırın altında (12 günlük üssel ortalama 26 günlüğün altında).';
    return t;
  }
  function macdWord(h, hp) {
    if (!isNum(h)) return null;
    if (h > 0) return isNum(hp) && h < hp ? 'MACD yukarı ama ivme azalıyor' : 'MACD ivmesi yukarı';
    return isNum(hp) && h > hp ? 'MACD aşağı ama ivme azalıyor' : 'MACD ivmesi aşağı';
  }
  function tfView(r, lbl) {
    if (!r) return null;
    var v = [];
    if (isNum(r.ema9) && isNum(r.ema21)) v.push(r.ema9 > r.ema21);
    if (isNum(r.macd_hist)) v.push(r.macd_hist > 0);
    if (isNum(r.rsi)) v.push(r.rsi > 50);
    if (!v.length) return null;
    var up = v.filter(Boolean).length, w = up === v.length ? 'yukarı' : (up === 0 ? 'aşağı' : 'karışık');
    var parts = [];
    if (isNum(r.rsi)) parts.push('RSI ' + n(r.rsi, 0));
    if (isNum(r.ema9) && isNum(r.ema21)) parts.push(r.ema9 > r.ema21 ? 'EMA 9 > EMA 21' : 'EMA 9 < EMA 21');
    if (isNum(r.macd_hist)) parts.push('MACD histogramı ' + (r.macd_hist > 0 ? 'pozitif' : 'negatif'));
    return { dir: w, txt: lbl + ' grafikte görünüm ' + w + ' (' + parts.join(', ') + ').' };
  }

  /* ---------- varlık yorumu ---------- */
  function asset(x, ctx) {
    if (!x) return null;
    ctx = ctx || {};
    var d = D(x), p = x.price, out = { lead: [], sections: [] };
    if (!isNum(p)) return { lead: ['Bu varlık için fiyat alınamadı.'], sections: [] };

    // özet
    out.lead.push(x.name + ' ' + P(x, p) + (isNum(x.chg) ? ', önceki kapanışa göre ' + sp(x.chg) + '.' : '.'));
    var mv = dayMoveAtr(x);
    if (isNum(mv)) {
      if (mv >= 1.5) out.lead.push('Bu hareket, son 14 günün ortalama günlük hareketinin (ATR) yaklaşık ' + n(mv, 1) + ' katı: olağandışı büyük bir gün.');
      else if (mv >= 1) out.lead.push('Bu hareket ortalama bir günün (ATR) biraz üstünde.');
      else if (mv <= 0.3) out.lead.push('Hareket, ortalama günlük hareketin (ATR) çok altında: sakin bir gün.');
    }
    if (SIG_MEAN[x.code]) {
      var ups = (x.votes || []).filter(function (v) { return v.ok; }).length, dns = (x.votes || []).length - ups;
      out.lead.push(SIG_MEAN[x.code] + ((x.votes || []).length ? ' Günlük oylama: yukarı ' + ups + ', aşağı ' + dns + '.' : ''));
    }
    if (x.stale) out.lead.push('Güncel veri alınamadı; yorum önbellekteki veriye dayanıyor.');

    // gram altın: teorik ne demek, hareketin kaynağı
    if (x.key === 'GRAM') {
      var gi = [];
      gi.push('"Teorik" şu demek: bu fiyat bir kuyumcu ya da banka fiyatı değil; COMEX vadeli ons fiyatı × USD/TRY ÷ 31,1035 hesabıyla bulunan gram değeridir (1 ons = 31,1035 gram). Grafik de aynı hesapla çizilir.');
      var ret = (ctx.gold || []).filter(function (r) { return r.metric === 'RETAIL'; })[0];
      if (ret && isNum(ret.ask) && isNum(ret.diff_ask_pct)) {
        gi.push('Piyasada gram altın satış fiyatı ' + n(ret.ask, 2) + ' TL (Truncgil, ' + (ret.time || 'saat yok') + '); teorik değerden ' + absPct(ret.diff_ask_pct) +
          (ret.diff_ask_pct >= 0 ? ' yüksek' : ' düşük') + '. Fark; alış-satış makası, vadeli ile spot fiyat farkı ve yerel piyasa koşullarından kaynaklanır.');
      }
      var g = ctx.find ? ctx.find('GOLD_FUT') : null, u = ctx.find ? ctx.find('USDTRY') : null;
      if (g && u && isNum(g.chg) && isNum(u.chg)) {
        var src = Math.abs(g.chg) >= 2 * Math.abs(u.chg) ? 'Hareketin büyük kısmı onstan geliyor.' : (Math.abs(u.chg) >= 2 * Math.abs(g.chg) ? 'Hareketin büyük kısmı kurdan geliyor.' : 'İkisinin etkisi birbirine yakın.');
        gi.push('Bugünkü değişimin kaynağı: ons (dolar cinsinden) ' + sp(g.chg) + ', USD/TRY ' + sp(u.chg) + '. ' + src);
      }
      out.sections.push({ h: 'Gram altın nasıl hesaplanıyor?', items: gi });
    }

    // eğilim
    var s20 = d.sma20, s50 = isNum(d.sma50) ? d.sma50 : x.sma50, s200 = isNum(d.sma200) ? d.sma200 : x.sma200, tr = [];
    function rel(level, N, scope) {
      if (!isNum(level)) return null;
      var dd = 100 * (p / level - 1), pos = Math.abs(dd) < 0.05 ? 'hemen yanında' : absPct(dd) + (dd > 0 ? ' üstünde' : ' altında');
      return scope + ': fiyat, son ' + N + ' günün ortalamasının (SMA ' + N + ' = ' + P(x, level) + ') ' + pos + '.';
    }
    [rel(s200, 200, 'Uzun vade'), rel(s50, 50, 'Orta vade'), rel(s20, 20, 'Kısa vade')].forEach(function (t) { if (t) tr.push(t); });
    var ms = maStory(maPos(p, s20, s50, s200), 'günlük', 'Fiyat');
    if (ms) tr.push(ms);
    if (isNum(s50) && isNum(s200)) tr.push(s50 > s200 ? '50 günlük ortalama 200 günlüğün üstünde; bu düzen ("altın kesişim" sonrası) yükseliş eğilimlerinde görülür.'
      : '50 günlük ortalama 200 günlüğün altında; bu düzen ("ölüm kesişimi" sonrası) düşüş eğilimlerinde görülür.');
    var atr = x.atr || d.atr14;
    if (isNum(atr) && atr > 0 && isNum(s50)) {
      var ext = (p - s50) / atr;
      if (ext >= 3) tr.push('Fiyat 50 günlük ortalamadan ' + n(ext, 1) + ' ATR yukarıda: yükseliş çok hızlı olmuş; teknik analizde buna "aşırı uzama" denir.');
      else if (ext <= -3) tr.push('Fiyat 50 günlük ortalamadan ' + n(-ext, 1) + ' ATR aşağıda: düşüş çok hızlı olmuş; teknik analizde buna "aşırı uzama" denir.');
    }
    if (tr.length) out.sections.push({ h: 'Eğilim (hareketli ortalamalar)', items: tr });

    // ivme
    var mo = [], rt = rsiText(x.rsi, d.rsi_prev), mt = macdText(d.macd, d.macd_sig, d.macd_hist, d.macd_hist_prev, true, 'son günde');
    if (rt) mo.push(rt);
    if (mt) mo.push(mt);
    if (mo.length) out.sections.push({ h: 'İvme (RSI ve MACD)', items: mo });

    // trend gücü ve oynaklık
    var vo = [], a = x.adx;
    if (isNum(a)) {
      var dirTxt = isNum(d.pdi) && isNum(d.mdi) ? (d.pdi > d.mdi ? ', yönü yukarı (+DI > −DI)' : ', yönü aşağı (−DI > +DI)') : '';
      if (a < 20) vo.push('ADX ' + n(a, 0) + ': belirgin bir trend yok; fiyat bir aralıkta gidip gelebilir. Bu ortamda ortalamalara ve MACD\'ye dayalı sinyaller daha sık yanılır.');
      else if (a < 25) vo.push('ADX ' + n(a, 0) + ': trend oluşuyor ama henüz güçlü değil' + dirTxt + '.');
      else if (a < 40) vo.push('ADX ' + n(a, 0) + ': trend güçlü' + dirTxt + '.');
      else vo.push('ADX ' + n(a, 0) + ': trend çok güçlü' + dirTxt + '.');
    }
    if (isNum(d.bb_u) && isNum(d.bb_l) && d.bb_u > d.bb_l) {
      var pb = (p - d.bb_l) / (d.bb_u - d.bb_l);
      if (pb > 1) vo.push('Fiyat Bollinger üst bandının (' + P(x, d.bb_u) + ') dışında: son 20 günün olağan oynaklık aralığının üstüne taşmış, hareket olağandışı hızlı.');
      else if (pb < 0) vo.push('Fiyat Bollinger alt bandının (' + P(x, d.bb_l) + ') dışında: son 20 günün olağan oynaklık aralığının altına inmiş, hareket olağandışı hızlı.');
      else if (pb >= 0.8) vo.push('Fiyat Bollinger bandının üst kısmında (bant ' + P(x, d.bb_l) + ' – ' + P(x, d.bb_u) + ').');
      else if (pb <= 0.2) vo.push('Fiyat Bollinger bandının alt kısmında (bant ' + P(x, d.bb_l) + ' – ' + P(x, d.bb_u) + ').');
      else vo.push('Fiyat Bollinger bandının orta kısmında (bant ' + P(x, d.bb_l) + ' – ' + P(x, d.bb_u) + ').');
    }
    if (isNum(atr) && atr > 0) vo.push('Ortalama günlük hareket (ATR 14) yaklaşık ' + P(x, atr) + '; fiyata oranla ' + absPct(100 * atr / p) + '.');
    if (vo.length) out.sections.push({ h: 'Trendin gücü ve oynaklık', items: vo });

    // kısa vade
    var sv = [], v4 = tfView(x.ind && x.ind.h4, '4 saatlik'), v1 = tfView(x.ind && x.ind.h1, '1 saatlik');
    if (v4) sv.push(v4.txt);
    if (v1) sv.push(v1.txt);
    var dDir = !isNum(x.ds) ? null : (x.ds >= 3 ? 'yukarı' : (x.ds <= -3 ? 'aşağı' : 'karışık'));
    if (v4 && v1 && dDir && v4.dir === v1.dir && v4.dir !== 'karışık' && dDir !== 'karışık') {
      sv.push(v4.dir === dDir ? 'Kısa vade günlük görünümle aynı yönde.' : (v4.dir === 'yukarı' ? 'Kısa vade günlük görünümün tersine yukarı: büyük resimdeki düşüş içinde bir tepki olabilir.'
        : 'Kısa vade günlük görünümün tersine aşağı: büyük resimdeki yükseliş içinde bir geri çekilme olabilir.'));
    }
    if (sv.length) out.sections.push({ h: 'Kısa vade (4 saat ve 1 saat)', items: sv });

    // seviyeler
    var lv = [];
    function lvTxt(o, first, kind) {
      if (!o || !isNum(o.v)) return null;
      var dd = 100 * (o.v / p - 1);
      return (first ? 'İlk anlamlı ' : 'Sonraki ') + kind + ' ' + P(x, o.v) + (o.labels && o.labels.length ? ' (' + o.labels.join(', ') + ')' : '') +
        ', fiyatın ' + absPct(dd) + (dd < 0 ? ' altında.' : ' üstünde.');
    }
    [lvTxt(x.s1, true, 'destek'), lvTxt(x.s2, false, 'destek'), lvTxt(x.r1, true, 'direnç'), lvTxt(x.r2, false, 'direnç')].forEach(function (t) { if (t) lv.push(t); });
    var h52 = isNum(d.h52) ? d.h52 : x.h52, l52 = isNum(d.l52) ? d.l52 : x.l52;
    if (isNum(h52) && isNum(l52) && h52 > l52) {
      var pos = (p - l52) / (h52 - l52);
      lv.push('Son 52 haftanın aralığı ' + P(x, l52) + ' – ' + P(x, h52) + '; fiyat bu aralığın ' + (pos >= 0.8 ? 'üst' : (pos <= 0.2 ? 'alt' : 'orta')) +
        ' kısmında (aralığın %' + n(Math.max(0, Math.min(1, pos)) * 100, 0) + ' noktası).');
    }
    if (x.invalid) lv.push(x.code === 'NOTR' ? 'Yön için: ' + x.invalid + '.' : 'Bu görünüm, ' + x.invalid + ' olursa bozulur.');
    if (lv.length) out.sections.push({ h: 'Seviyeler', items: lv });

    return out;
  }

  /* ---------- kart için tek satır ---------- */
  function short(x) {
    if (!x || !isNum(x.price)) return '';
    var d = D(x), m = maPos(x.price, d.sma20, isNum(d.sma50) ? d.sma50 : x.sma50, isNum(d.sma200) ? d.sma200 : x.sma200), parts = [];
    if (m.a20 !== null && m.a50 !== null && m.a200 !== null) {
      if (m.a20 && m.a50 && m.a200) parts.push('Üç ortalamanın da üstünde');
      else if (!m.a20 && !m.a50 && !m.a200) parts.push('Üç ortalamanın da altında');
      else if (m.a200 && !m.a50) parts.push('Uzun vade yukarı, orta vade düzeltmede');
      else if (!m.a200 && m.a50) parts.push('Uzun vade aşağı, toparlanma denemesi');
      else if (m.a200) parts.push('Orta ve uzun vade yukarı, kısa vade geri çekilmede');
      else parts.push('Orta ve uzun vade aşağı, kısa vadeli tepki');
    }
    if (isNum(x.rsi)) parts.push('RSI ' + n(x.rsi, 0) + ' (' + rsiWord(x.rsi) + ')');
    var mw = macdWord(d.macd_hist, d.macd_hist_prev);
    if (mw) parts.push(mw);
    var mv = dayMoveAtr(x);
    if (isNum(mv) && mv >= 1.5) parts.push('bugünkü hareket ATR\'nin ' + n(mv, 1) + ' katı');
    return parts.join('; ') + (parts.length ? '.' : '');
  }

  /* ---------- seçili zaman dilimi ---------- */
  var TF_NAME = { G: 'günlük', '4S': '4 saatlik', '1S': '1 saatlik' };
  var TF_MUM = { G: 'bir günü', '4S': 'dört saati', '1S': 'bir saati' };
  function chart(st, x) {
    if (!st) return [];
    var out = [], o = x || { dp: 2, unit: '' };
    var per = st.per || {};
    out.push('Bu ' + TF_NAME[st.tf] + ' grafikte her mum ' + TF_MUM[st.tf] + ' gösterir. Ortalamalar seçili zaman dilimine göre hesaplanır: burada SMA 20 = ' +
      (per[20] ? per[20].txt : '20 mum') + ', SMA 50 = ' + (per[50] ? per[50].txt : '50 mum') + ', SMA 200 = ' + (per[200] ? per[200].txt : '200 mum') + '.');
    if (isNum(st.first) && isNum(st.c) && st.first > 0) {
      out.push('Görünen aralıkta (' + st.spanLabel + ') fiyat ' + P(o, st.first) + ' seviyesinden ' + P(o, st.c) + ' seviyesine geldi (' + sp(100 * (st.c / st.first - 1)) +
        '); en yüksek ' + P(o, st.hiV) + ', en düşük ' + P(o, st.loV) + '.');
    }
    var ms = maStory(maPos(st.c, st.sma20, st.sma50, st.sma200), 'dönemlik', 'Son mum');
    if (ms) out.push(ms);
    var r = rsiText(st.rsi, st.rsiPrev);
    if (r) out.push(r.replace('RSI (14)', 'Bu grafikte RSI'));
    var mt = macdText(st.macd, st.sig, st.hist, st.histPrev, false);
    if (mt) out.push(mt);
    if (st.tf !== 'G' && x && isNum(x.ds)) {
      var tfUp = isNum(st.sma50) && isNum(st.hist) && st.c > st.sma50 && st.hist > 0, tfDn = isNum(st.sma50) && isNum(st.hist) && st.c < st.sma50 && st.hist < 0;
      var dUp = x.ds >= 3, dDn = x.ds <= -3;
      if (tfUp && dDn) out.push('Bu zaman dilimi yukarıyı gösteriyor ama günlük görünüm aşağı: büyük resimdeki düşüş içinde kısa vadeli bir tepki olabilir.');
      else if (tfDn && dUp) out.push('Bu zaman dilimi aşağıyı gösteriyor ama günlük görünüm yukarı: büyük resimdeki yükseliş içinde kısa vadeli bir geri çekilme olabilir.');
      else if ((tfUp && dUp) || (tfDn && dDn)) out.push('Bu zaman dilimi günlük görünümle aynı yönde.');
    }
    if (st.tf !== 'G') out.push('Üstteki sinyal etiketi günlük göstergelere ve 4 saat/1 saat oylarına göre verilir; yalnız bu grafikten çıkarılmaz.');
    return out;
  }

  /* ---------- piyasa özeti ---------- */
  function market(data) {
    var S = (data && data.signals) || [], out = [];
    if (!S.length) return out;
    var by = {}; S.forEach(function (x) { by[x.key] = x; });
    var gold = (data && data.gold) || [];

    // altın
    var G = by.GRAM, O = by.GOLD_FUT, U = by.USDTRY;
    if (G && isNum(G.price)) {
      var t = 'Gram altın (teorik) ' + n(G.price, 0) + ' TL (' + sp(G.chg) + ')';
      if (O && U && isNum(O.chg) && isNum(U.chg)) {
        t += '; ons ' + sp(O.chg) + ', USD/TRY ' + sp(U.chg) + '. ' + (Math.abs(O.chg) >= 2 * Math.abs(U.chg) ? 'Gramdaki hareketin büyük kısmı onstan geliyor.' :
          (Math.abs(U.chg) >= 2 * Math.abs(O.chg) ? 'Gramdaki hareketin büyük kısmı kurdan geliyor.' : 'Ons ve kurun etkisi birbirine yakın.'));
      } else t += '.';
      var ret = gold.filter(function (r) { return r.metric === 'RETAIL'; })[0];
      if (ret && isNum(ret.ask)) t += ' Piyasada gram satış ' + n(ret.ask, 0) + ' TL.';
      t += ' Teknik sinyal ' + G.label + (G.trend ? ', eğilim: ' + G.trend.toLowerCase() : '') + '.';
      out.push(t);
    }

    // genel tablo
    var nAl = S.filter(function (x) { return x.code === 'AL' || x.code === 'GAL'; }).length;
    var nSat = S.filter(function (x) { return x.code === 'SAT' || x.code === 'GSAT'; }).length;
    var nN = S.length - nAl - nSat;
    var tone = nSat >= 2 * Math.max(1, nAl) && nSat >= 6 ? 'Sinyallerin çoğu düşüş yönünde: genel bir zayıflık var.'
      : (nAl >= 2 * Math.max(1, nSat) && nAl >= 6 ? 'Sinyallerin çoğu yükseliş yönünde: genel bir güçlenme var.' : 'Tablo karışık; tek yönlü bir hava yok.');
    out.push('Teknik sinyaller: AL ' + nAl + ', SAT ' + nSat + ', NÖTR ' + nN + ' (' + S.length + ' varlık). ' + tone);

    // ortalamasına göre büyük hareketler
    var big = S.map(function (x) { return { x: x, m: dayMoveAtr(x) }; }).filter(function (z) { return isNum(z.m) && z.m >= 1; })
      .sort(function (a, b) { return b.m - a.m; }).slice(0, 3);
    if (big.length) out.push('Ortalamasına göre en büyük hareketler: ' + big.map(function (z) {
      return z.x.name.replace(/ \(.*\)$/, '') + ' ' + sp(z.x.chg) + ' (ATR\'nin ' + n(z.m, 1) + ' katı)';
    }).join(', ') + '.');
    else out.push('Hiçbir varlıkta ortalama bir günün (ATR) üstünde hareket yok; sakin bir gün.');

    // risk iştahı
    var risk = [], V = by.VIX, X = by.DXY, T = by.US10Y;
    if (V && isNum(V.price)) {
      var vl = V.price < 15 ? 'düşük: piyasalar sakin' : (V.price < 20 ? 'normal aralıkta' : (V.price < 30 ? 'yüksek: tedirginlik var' : 'çok yüksek: belirgin korku'));
      risk.push('VIX ' + n(V.price, 1) + ' (' + vl + ')');
    }
    if (X && isNum(X.chg)) risk.push('dolar endeksi ' + sp(X.chg) + (Math.abs(X.chg) >= 0.3 ? (X.chg > 0 ? ' (güçlü dolar genellikle onsu baskılar)' : ' (zayıf dolar genellikle onsu destekler)') : ''));
    if (T && isNum(T.price) && isNum(T.chg)) {
      var bp = T.price - T.price / (1 + T.chg / 100);
      risk.push('ABD 10 yıllık faiz %' + n(T.price, 2) + ' (' + (bp >= 0 ? '+' : '−') + n(Math.abs(bp * 100), 0) + ' baz puan)');
    }
    if (risk.length) out.push('Risk göstergeleri: ' + risk.join(', ') + '.');

    // borsa
    var B = by.XU100;
    if (B && isNum(B.price)) out.push('BIST 100 ' + n(B.price, 0) + ' (' + sp(B.chg) + '); teknik sinyal ' + B.label + (B.trend ? ', eğilim: ' + B.trend.toLowerCase() : '') + '.');
    return out;
  }

  window.GMIYORUM = { asset: asset, short: short, chart: chart, market: market, TF_NAME: TF_NAME };
})();
