/* 词刻 Service Worker — 离线缓存（需在 http/https 环境生效，file:// 下自动跳过）
   版本号机制：代码更新时同时把 index.html 里的资源引用版本号 +1（styles.css?v=N 等）并同步本文件 ASSETS。 */
const CACHE = 'cike-v6';
const ASSETS = ['./', './index.html', './styles.css?v=3', './app.js?v=4', './dict.js?v=3', './manifest.webmanifest?v=4', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      if (res.ok && new URL(e.request.url).origin === location.origin) caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
