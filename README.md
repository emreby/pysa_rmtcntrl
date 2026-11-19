# GMI Piyasa

Kişisel piyasa takip uygulaması: altın, döviz, emtia, borsalar ve faiz. Araştırma ve takip amaçlıdır; yatırım tavsiyesi değildir.

## Android uygulaması (asıl sürüm)

İndirme: [gmi-piyasa.apk](https://github.com/emreby/pysa_rmtcntrl/releases/download/uygulama/gmi-piyasa.apk) (her değişiklikte GitHub'da otomatik derlenir; sürüm sayfası: Releases → "uygulama").

- **Veri ve analiz telefonda:** Uygulama açılınca fiyatları ve grafik verisini doğrudan telefondan çeker (Yahoo Finance, Truncgil, Google Haberler başlıkları, Forex Factory takvimi). Göstergeler, destek/direnç ve sinyaller telefonda hesaplanır. Bilgisayar gerekmez.
- **Teknik grafikler:** Mum grafiği, SMA 20/50/200, Bollinger bandı, destek/direnç çizgileri, RSI ve MACD; günlük, 4 saatlik ve 1 saatlik.
- **Eğilim etiketleri:** Göstergelerin oylamasından kurala göre güçlü yükseliş / yükseliş / yön belirsiz / düşüş / güçlü düşüş eğilimi. Etiketler tahmin ya da al-sat emri değildir.
- **Geçmiş testi:** Günlük kural son 10 yılın her gününe uygulanır (haftada bir, telefonda); her etiketten 1 hafta ve 1 ay sonra fiyatın ne sıklıkla yükseldiği ve etikete göre girip çıkmanın maliyetli sonucu gösterilir. 13 Kasım 2026 testinde etiketler yönü rastgele bir günden daha iyi göstermedi.
- **Spot ons ve alış-satış farkı:** Vadeli onsun yanında spot ons (gold-api.com); bankanın ya da kuyumcunun gram fiyatlarıyla başa baş hesabı.
- **Otomatik yorum:** Her varlık için grafik altında sade Türkçe yorum (eğilim, RSI, MACD, ADX, Bollinger, ATR, seviyeler; gram altında ons ve kur payı) ve seçili zaman dilimine göre grafik okuması; Piyasa sekmesinde "Günün yorumu". Yorumlar göstergelerden sabit kurallarla yazılır; tahmin ya da tavsiye değildir.
- **Yakınımdaki kuyumcular (İller sekmesi):** "Konumumu göster" ile konum Google Haritalar'da (anahtarsız "Haritayı yerleştir" biçimi) gösterilir ve "kuyumcu" araması yapılır; "Google Haritalar'da aç" uygulamayı açar. İl ve ilçe telefonun adres servisinden (Android Geocoder) bulunur ve ilin kuyumcular odası eşlenir. Konum yalnız düğmeye basınca alınır, saklanmaz; Google'a ~100 m'ye yuvarlanmış konum gider.
- **Kuyumcu fiyat defteri (İller):** Kuyumcunun alış/satış fiyatı, kayıt anındaki piyasa fiyatıyla birlikte saklanır; kuyumcuların farkı karşılaştırılır, gram kaydı alış-satış farkı hesabına aktarılabilir.
- **Birikim sekmesi:** Birikim takibi (bugünkü değer piyasa alışıyla, kâr/zarar, fiyat defterine göre kuyumcuya satış tahmini), fiyat alarmları (arka planda ≈15 dk, uygulama açıkken anında; her alarm bir kez çalar) ve düzenli alım hesabı (Yahoo aylık verisi; TÜFE karşılaştırması TCMB'nin yayımladığı tablodan).
- **Bildirim kontrol listesi ve yedekleme (Ayarlar):** izin, bildirim türü, pil kısıtlaması ve son arka plan kontrolü; telefon markasına göre ipucu; elle kontrol sonucu bildirim olarak gelir; günlük özet (isteğe bağlı). Yedek dosyası Android'in kaydetme ekranıyla alınır, geri yüklenir.
- **Yedek veri kaynakları:** Dolar ve euro için serbest piyasa (Truncgil) satırları; Yahoo ve Truncgil alınamazsa TCMB gösterge kuru. Gram altın için vadeli ons ya da kur yoksa spot ons ve yedek kurla teorik gram. Arka plan alarmları aynı sırayı kullanır.
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
- `yakin.js`: konum, gömülü Google haritası, il/oda eşleşmesi
- `birikim.js`: birikim takibi ve düzenli alım hesabı
- `alarm.js`: fiyat alarmları
- `defter.js`: kuyumcu fiyat defteri
- `yedek.js`: yedek alma ve geri yükleme
- `engine/ta_engine.js`: gösterge motoru
- `android/`: Android kabuğu ve arka plan kontrolü (WorkManager)
- `.github/workflows/android.yml`: APK derleme ve yayınlama
- `engine/pipeline.py`, `.github/workflows/gmi.yml`: sunucu tarafı akış (zamanlaması kapalı; Yahoo, GitHub sunucularını engelliyor)
