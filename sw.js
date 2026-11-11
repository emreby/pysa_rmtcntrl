// GMI Piyasa — service worker: çevrimdışı çalışma ve bildirimler
const CACHE = 'gmi-piyasa-v1';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png', 'data/app_data.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('gmi-piyasa-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Veri dosyaları: önce ağ, olmazsa son kayıtlı kopya
  if (url.pathname.indexOf('/data/') !== -1) {
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return res;
      }).catch(() => caches.match(key))
    );
    return;
  }

  // Uygulama dosyaları: hızlı açılış için önce kayıtlı kopya, arkada güncelle
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'GMI Piyasa';
  const opts = {
    body: d.body || 'Yeni piyasa güncellemesi var.',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: d.tag || 'gmi',
    renotify: true,
    data: { url: d.url || './' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.indexOf(self.registration.scope) === 0 && 'focus' in w) {
          if ('navigate' in w) w.navigate(target).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
