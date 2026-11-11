# GMI Piyasa

Kişisel piyasa takip uygulaması: altın, döviz, emtia ve borsalar için fiyatlar, teknik görünüm, gündem, uyarılar ve tahmin karnesi. Araştırma ve takip amaçlıdır; yatırım tavsiyesi değildir.

## Nasıl çalışır
- Uygulama bir PWA'dır: GitHub Pages'te yayımlanır, Android'de Chrome ile normal bir uygulama gibi yüklenir.
- Veriler `data/app_data.json` dosyasındadır. Bu dosyayı hafta içi 08:45, 10:33, 12:45, 14:33, 16:38, 20:33 ve 22:15'te (TSİ) zamanlanmış Claude seansları günceller.
- Dosya değişince `.github/workflows/notify.yml` çalışır. Yeni bir uyarı ya da tam seans özeti varsa telefona bildirim gönderir.

## Kurulum (bir kez)
1. **Settings → Pages:** Source "Deploy from a branch", Branch `main`, klasör `/ (root)`.
2. Telefonda Chrome ile `https://emreby.github.io/pysa_rmtcntrl/` adresini açın. Menüden (⋮) **Uygulamayı yükle**'ye dokunun.
3. Uygulamada ⚙ **Ayarlar → Bildirimleri aç**, izin verin ve **Kodu kopyala**'ya dokunun. Bildirim anahtarları telefonunuzda üretilir.
4. **Settings → Secrets and variables → Actions → New repository secret**: ad `PUSH_CONFIG`, değer kopyaladığınız kod.
5. **Actions → Telefona bildirim → Run workflow** ile deneme bildirimi gönderin.

## Dosyalar
| Dosya | Görev |
|---|---|
| `index.html`, `app.css`, `app.js`, `config.js` | Uygulama |
| `sw.js` | Çevrimdışı çalışma ve bildirimler |
| `manifest.webmanifest`, `icons/` | Uygulama adı ve simgeleri |
| `data/app_data.json` | Piyasa verisi (seanslarca güncellenir) |
| `scripts/notify.mjs`, `.github/workflows/notify.yml` | Bildirim gönderimi |

Adresi kimseyle paylaşmayın: veri kaynaklarının koşulları kişisel kullanım içindir.
