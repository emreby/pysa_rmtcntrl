# GMI Piyasa

Kişisel piyasa takip uygulaması: altın, döviz, emtia, borsalar ve faiz. Araştırma ve takip amaçlıdır; yatırım tavsiyesi değildir.

## Android uygulaması (asıl sürüm)

İndirme: [gmi-piyasa.apk](https://github.com/emreby/pysa_rmtcntrl/releases/download/uygulama/gmi-piyasa.apk) (her değişiklikte GitHub'da otomatik derlenir; sürüm sayfası: Releases → "uygulama").

- **Veri ve analiz telefonda:** Uygulama açılınca fiyatları ve grafik verisini doğrudan telefondan çeker (Yahoo Finance, Truncgil, Google Haberler başlıkları, Forex Factory takvimi). Göstergeler, destek/direnç ve sinyaller telefonda hesaplanır. Bilgisayar gerekmez.
- **Teknik grafikler:** Mum grafiği, SMA 20/50/200, Bollinger bandı, destek/direnç çizgileri, RSI ve MACD; günlük, 4 saatlik ve 1 saatlik.
- **Teknik sinyaller:** Göstergelerin oylamasından kurala göre GÜÇLÜ AL / AL / NÖTR / SAT / GÜÇLÜ SAT. Sinyaller kesin yön ya da fiyat hedefi değildir; geçmiş isabetleri Karne sekmesinde tutulur.
- **Otomatik yorum:** Her varlık için grafik altında sade Türkçe yorum (eğilim, RSI, MACD, ADX, Bollinger, ATR, seviyeler; gram altında ons ve kur payı) ve seçili zaman dilimine göre grafik okuması; Piyasa sekmesinde "Günün yorumu". Yorumlar göstergelerden sabit kurallarla yazılır; tahmin ya da tavsiye değildir.
- **İller sekmesi:** Kuyumcular odalarının fiyat yayını. Yayımlayan odaların siteleri otomatik veri çekmeyi yasakladığı ya da giriş istediği için fiyatlar uygulamaya alınmaz; resmî sayfa tarayıcıda açılır. Liste `iller.js` içinde.
- **Arka plan kontrolü:** Uygulama kapalıyken telefon yaklaşık 15 dakikada bir (Android izin verdikçe) fiyatları kontrol eder; eşik aşılırsa ya da son analizin destek/direnç seviyesi kırılırsa bildirim gösterir.

### Kurulum
1. Telefonda APK bağlantısını açıp dosyayı indirin.
2. Açın; "bilinmeyen kaynaklardan yükleme" izni istenirse bu kez için izin verin ve **Yükle**'ye dokunun.
3. Uygulama bildirim izni ister; izin verin.
4. ⚙ Ayarlar → **Pil kısıtlamasını kaldır** → GMI Piyasa için "Kısıtlama yok" (bazı telefonlarda arka plan kontrolü için gerekir).

## Web sürümü

https://emreby.github.io/pysa_rmtcntrl/ — `data/app_data.json` dosyasını okur; artık otomatik güncellenmez.

## Dosyalar

- `index.html`, `app.js`, `app.css`: arayüz
- `analysis.js`: telefonda veri toplama, teknik analiz ve sinyaller
- `chart.js`: teknik grafikler
- `yorum.js`: kural tabanlı yorum motoru
- `iller.js`: kuyumcular odaları listesi (elle doğrulanır)
- `engine/ta_engine.js`: gösterge motoru
- `android/`: Android kabuğu ve arka plan kontrolü (WorkManager)
- `.github/workflows/android.yml`: APK derleme ve yayınlama
- `engine/pipeline.py`, `.github/workflows/gmi.yml`: sunucu tarafı akış (zamanlaması kapalı; Yahoo, GitHub sunucularını engelliyor)
