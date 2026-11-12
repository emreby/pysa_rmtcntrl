/* İller sekmesi: kuyumcular odalarının fiyat yayını (elle doğrulanmış liste).
   Fiyatlar uygulamaya çekilmez: yayımlayan odaların siteleri otomatik veri çekmeyi yasaklıyor ya da üye girişi istiyor.
   Uygulama resmî sayfayı telefonun tarayıcısında açar. Liste değişirse bu dosya güncellenir. */
window.GMIILLER = {
  kontrol: '12 Kasım 2026',
  yayinlayan: [
    {
      il: 'İzmir', oda: 'İzmir Kuyumcular Odası (İZKO)', url: 'https://izko.org.tr/guncel-kur', urlTxt: 'Güncel fiyatları aç',
      ne: 'Her gün "tavsiye edilen fiyatlar" listesi: 22, 18, 14 ve 8 ayar, gram, Ata, eski/yeni çeyrek, yarım, ziynet, paketli has ve has altın. Her kalem için K.K. (kredi kartıyla) satış ve satış fiyatı. Haberlerdeki yayın saatlerine göre liste sabah 09:30 civarında güncelleniyor. Sitedeki nota göre fiyatlar bilgilendirme amaçlı ve KDV hariç.',
      neden: 'Sitenin yasal uyarısı, verilerin otomatik araçlarla çekilmesini ve kopyalanmasını yasaklıyor. Bu yüzden fiyatlar uygulamaya alınmıyor; resmî sayfa tarayıcıda açılır.',
      ek: [{ t: 'Geçmiş kurlar', url: 'https://izko.org.tr/gecmis-kurlar' }, { t: 'Gümüş', url: 'https://izko.org.tr/gumus-fiyatlari' }]
    },
    {
      il: 'Malatya', oda: 'Malatya Kuyumcular Odası', url: 'https://malatyakuyumcular.tr', urlTxt: 'Siteyi aç',
      ne: 'Odanın sitesinde güncel altın fiyatları yayımlandığı bildiriliyor (gram, çeyrek, Cumhuriyet altını ve diğerleri).',
      neden: 'Site otomatik erişime kapalı (robots.txt). 12 Kasım\'daki denemede sayfa açılamadı; içeriği doğrulanamadı.'
    }
  ],
  uygulama: [
    {
      il: 'İstanbul', oda: 'İstanbul Kuyumcular Odası (İKO)', url: 'https://www.iko.org.tr', urlTxt: 'İKO sitesini aç',
      ne: 'İlçe ve bölgeye göre kuyumcu fiyatları İKO\'nun mobil uygulamalarında (İKO Fiyat, Zerger App) gösteriliyor. Web\'deki fiyat ekranı (fiyat.iko.org.tr) üye girişi istiyor.',
      neden: 'Herkese açık, okunabilir bir fiyat listesi yok; fiyatlar giriş yapılan ekranda ve İKO\'nun kendi uygulamalarında.',
      ek: [{ t: 'Play Store: İKO Fiyat', url: 'https://play.google.com/store/search?q=%C4%B0KO%20Fiyat&c=apps' },
        { t: 'Play Store: Zerger App', url: 'https://play.google.com/store/search?q=Zerger%20App&c=apps' }]
    }
  ],
  // Odası olduğu haberlerden doğrulanan, internette yayımladığı bir fiyat listesi bulunamayan iller
  bulunamayan: [
    { il: 'Ankara', oda: 'Ankara Kuyumcular ve Saatçiler Odası' },
    { il: 'Antalya', oda: 'Antalya Kuyumcular Odası (AKOD)' },
    { il: 'Bursa', oda: 'Bursa Kuyumcular Odası', not: 'Yerel haberler "oda verilerine göre" fiyat aktarıyor; odanın kendi yayımladığı bir liste bulunamadı.' },
    { il: 'Trabzon', oda: 'Trabzon Kuyumcular ve Saatçiler Odası' },
    { il: 'Gaziantep', oda: 'Gaziantep Kuyumcular Odası' },
    { il: 'Adana', oda: 'Adana Kuyumcular Odası' },
    { il: 'Diyarbakır', oda: 'Diyarbakır Kuyumcular ve Sarraflar Odası (DİKO)' },
    { il: 'Eskişehir', oda: 'Eskişehir Kuyumcular Odası' }
  ],
  // AA, Nisan 2023: İKO fiyat ekranını kullanan kuyumcuların bulunduğu iller (güncel olmayabilir)
  ikoEkran: { kaynak: 'Anadolu Ajansı, Nisan 2023', iller: ['Adıyaman', 'Afyonkarahisar', 'Amasya', 'Ağrı', 'Bursa', 'Elazığ', 'Hakkâri', 'Kars', 'Kütahya', 'Mardin', 'Osmaniye', 'Şanlıurfa', 'Bingöl', 'Kastamonu'] }
};
