/* ===== 放射技术题库 · Service Worker v1（GitHub Pages 相对路径版） =====
  策略:
  - 静态资源(JS/CSS/HTML/数据): Cache First (安装时预缓存)
  - API 请求: Network First, 离线时用本地数据降级
  - 图片/字体: Stale-While-Revalidate
  注意: 使用相对路径，兼容 GitHub Pages 子路径部署
*/
const CACHE_VERSION = 'fsgf-v13';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DATA_CACHE = CACHE_VERSION + '-data';
const API_CACHE = CACHE_VERSION + '-api';

// 安装时预缓存的静态资源（相对路径，兼容子路径部署）
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/style.css',
  './assets/js/api.js',
  './assets/js/store.js',
  './assets/js/gamify.js',
  './assets/js/tts.js',
  './assets/js/sketch.js',
  './assets/js/quiz.js',
  './assets/js/report.js',
  './assets/js/app.js',
  './assets/js/user.js',
  './assets/js/exam.js',
  './assets/js/data/questions_public.js',
  './assets/js/data/questions_ima.js',
  './assets/js/data/questions_offline.js',
  './assets/js/data/lectures.js',
  './assets/js/data/textbook.js',
  './assets/js/data/hotpoints.js'
];

// 安装：预缓存所有静态资源
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets...');
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => !k.startsWith(CACHE_VERSION))
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// 请求拦截
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const { pathname } = url;

  // 跳过非 GET 请求和 Chrome 扩展
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // ── API 请求：Network First，离线降级 ──
  if (pathname.includes('/api/')) {
    event.respondWith(networkFirstAPI(event.request));
    return;
  }

  // ── 静态资源：Cache First ──
  if (isStaticAsset(pathname)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── HTML 导航请求：Network First ──
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstHTML(event.request));
    return;
  }

  // ── 其他：Stale-While-Revalidate ──
  event.respondWith(staleWhileRevalidate(event.request));
});

// ===== 策略函数 =====

// Cache First（静态资源）
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 离线且无缓存，返回空
    return new Response('', { status: 503 });
  }
}

// Network First（API）
async function networkFirstAPI(request) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 离线：尝试返回缓存的 API 响应
    const cached = await caches.match(request);
    if (cached) return cached;
    // 无缓存：返回离线提示
    return new Response(
      JSON.stringify({ ok: false, error: 'offline', offline: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Network First（HTML）
async function networkFirstHTML(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('./index.html');
  }
}

// Stale-While-Revalidate
async function staleWhileRevalidate(request) {
  const cached = caches.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      caches.open(DATA_CACHE).then(cache => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  const cachedResponse = await cached;
  if (cachedResponse) {
    // 后台更新
    fetchPromise;
    return cachedResponse;
  }
  const networkResponse = await fetchPromise;
  return networkResponse || new Response('', { status: 503 });
}

// 判断是否为静态资源
function isStaticAsset(pathname) {
  return pathname.endsWith('.css') ||
         pathname.endsWith('.js') ||
         pathname.endsWith('.json') ||
         pathname.endsWith('.svg') ||
         pathname.endsWith('manifest.json');
}

// ===== 消息处理 =====
self.addEventListener('message', event => {
  const data = event.data;
  if (data === 'skipWaiting' || (data && data.action === 'skipWaiting')) {
    self.skipWaiting();
  }
  if (data && data.type === 'CACHE_QUESTIONS') {
    // 前端通知缓存题目数据完成
    console.log('[SW] Questions data cached notification received');
  }
});
