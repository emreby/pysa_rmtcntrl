// GMI Piyasa — yeni uyarıları ve seans özetlerini telefona bildirim olarak gönderir.
// GitHub Actions'ta, data/app_data.json değiştiğinde çalışır (.github/workflows/notify.yml).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import webpush from 'web-push';

const CONF = process.env.PUSH_CONFIG;
const SITE = process.env.SITE_URL || 'https://github.com/';
const TEST = String(process.env.TEST_MESSAGE || '').toLowerCase() === 'true';

if (!CONF) {
  console.log('PUSH_CONFIG gizli değeri tanımlı değil; bildirim gönderilmedi.');
  process.exit(0);
}

const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
const cur = parse(readFileSync('data/app_data.json', 'utf8')) || {};
let prev = null;
try {
  prev = parse(execSync('git show HEAD~1:data/app_data.json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch { prev = null; }

const msgs = [];
if (TEST) {
  msgs.push({ title: 'GMI Piyasa', body: 'Deneme bildirimi: GitHub üzerinden gelen bildirimler bu telefonda çalışıyor.', tag: 'gmi-deneme', url: './' });
} else {
  // 1) Yeni uyarılar (yalnız "uyarı" düzeyi)
  const seen = new Set(((prev && prev.alerts) || []).map((a) => a.id));
  for (const a of cur.alerts || []) {
    if (seen.has(a.id) || a.level !== 'uyarı') continue;
    msgs.push({ title: `⚠ ${a.asset}: ${a.title}`.slice(0, 120), body: (a.detail || '').slice(0, 230), tag: a.id, url: './#piyasa' });
  }
  // 2) Tam seansın özeti (uyarı kontrolleri hariç)
  const s = (cur.status || [])[0] || {};
  const ps = ((prev && prev.status) || [])[0] || {};
  const full = s.session && !/^Uyarı/i.test(s.session);
  if (full && s.updated_trt && s.updated_trt !== ps.updated_trt) {
    msgs.push({ title: `GMI · ${s.session}`.slice(0, 120), body: (s.summary || 'Yeni seans verileri hazır.').slice(0, 230), tag: `seans-${s.updated_trt}`, url: './#piyasa' });
  }
}

if (!msgs.length) {
  console.log('Yeni uyarı veya seans yok; bildirim gerekmiyor.');
  process.exit(0);
}

let targets = parse(CONF);
if (!targets) {
  console.log('PUSH_CONFIG okunamadı: değer, uygulamadaki kodun aynısı olmalı.');
  process.exit(1);
}
if (!Array.isArray(targets)) targets = [targets];

let ok = 0;
let fail = 0;
for (const m of msgs.slice(0, 4)) {
  for (const t of targets) {
    try {
      await webpush.sendNotification(t.subscription, JSON.stringify(m), {
        TTL: 6 * 3600,
        urgency: 'high',
        vapidDetails: { subject: SITE, publicKey: t.vapidPublicKey, privateKey: t.vapidPrivateKey },
      });
      ok += 1;
    } catch (e) {
      fail += 1;
      console.log('Gönderilemedi:', e.statusCode || '', e.body || e.message);
    }
  }
}
console.log(`Bildirim: ${ok} gönderildi, ${fail} hata.`);
if (fail && !ok) process.exit(1);
