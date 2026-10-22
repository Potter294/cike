/* 词刻 Service Worker — 离线缓存（需在 http/https 环境生效，file:// 下自动跳过）
   版本号机制：代码更新时同时把 index.html 里的资源引用版本号 +1（app.js?v=N 等）并同步本文件 ASSETS。
   更新策略：页面/脚本/样式走「网络优先」——联网时永远取最新文件，断网时回退缓存；图标等静态资源走缓存优先。 */
const CACHE = 'cike-v9';
const ASSETS = ['./', './index.html', './styles.css?v=3', './app.js?v=7', './dict.js?v=4', './manifest.webmanifest?v=4', './icon.svg', './icon-192.png', './icon-512.png'];

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') return caches.match('./index.html');
    throw err;
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 跨域请求（如 OCR 代理）不拦截
  const dest = e.request.destination || '';
  if (dest === 'document' || dest === 'script' || dest === 'style') {
    e.respondWith(networkFirst(e.request));
  } else {
    e.respondWith(caches.match(e.request).then((hit) => hit || networkFirst(e.request)));
  }
});
