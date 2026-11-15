// VIAGO 서비스 워커 (2026-11-15 활성화)
//
// 원칙
// 1) 앱 껍데기(HTML·CSS·JS·아이콘)만 캐시한다. 일정 데이터는 건드리지 않는다.
//    - 일정은 localStorage(`journey-note-*`)와 Firestore 실시간 동기화가 정본이고,
//      이 워커는 localStorage·IndexedDB를 읽거나 쓰지 않는다.
// 2) 모든 쓰기(POST/PUT/PATCH/DELETE)와 외부 API(Firestore·Google Maps·날씨·환율·Photon)는
//    그대로 네트워크로 보낸다. (respondWith 없이 통과 → 캐시·재전송·가로채기 없음)
// 3) 화면(HTML)은 네트워크 우선이다. 새 배포가 있으면 다음 실행에 바로 반영되고,
//    오프라인일 때만 마지막으로 받은 화면을 보여준다.
// 4) 새 워커는 skipWaiting 하지 않는다. 사용 중인 화면을 갑자기 갈아치우지 않고,
//    앱을 완전히 닫았다 열 때 적용된다.
const VERSION = 'v2';   // 2026-11-15 이전 빌드: 인증 클라이언트 2개를 껍데기에 추가
const SHELL = `viago-shell-${VERSION}`;
// 같은 출처(oyeswon-gif.github.io)의 다른 앱(/ring 등) 캐시는 건드리지 않는다.
const OUR_PREFIX = 'viago-';
const SHELL_FILES = [
  './',
  './index.html',
  './journey-design.css',
  './journey-preview.js',
  './journey-sync.js',
  './viago-auth-client.js',   // 이전 빌드의 인증·초대 클라이언트
  './viago-auth-firebase.js', // 앱 저장 경로 어댑터
  './viago-sync-v3.js',       // (구) 인증 없는 저장 구현 — 앱이 더 이상 부르지 않지만 남겨 둔다
  './journey-install.js',
  './manifest.webmanifest',
  './app-icon-192.png',
  './app-icon-512.png',
  './app-icon.svg',
  './viago-travel-cover.webp',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(cache => Promise.all(SHELL_FILES.map(file => cache.add(new Request(file, { cache: 'reload' })).catch(() => null))))
      .catch(() => null)
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== SHELL && key.startsWith(OUR_PREFIX)).map(key => caches.delete(key))))
      .catch(() => null)
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;                 // 저장·동기화 요청은 손대지 않는다
  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;      // Firestore·Google 지도·날씨·환율 등 외부 API
  if (url.pathname.endsWith('/service-worker.js')) return;
  if (url.pathname.includes('/api/')) return;           // 정적 호스팅에는 서버 API 가 없다
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request)); return; }
  if (/\.(?:js|css|png|webp|svg|jpg|jpeg|ico|woff2?|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL);
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch (error) {
    const cache = await caches.open(SHELL);
    return (await cache.match(request)) || (await cache.match('./index.html')) || (await cache.match('./')) ||
      new Response('오프라인 상태예요. 인터넷에 연결한 뒤 다시 열어주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}
