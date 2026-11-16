// VIAGO 서비스 워커 (2026-11-15 활성화 · 2026-11-15 v10: 새 코드가 옛 캐시에 가려지지 않게)
//
// 원칙
// 1) 앱 껍데기(HTML·CSS·JS·아이콘)만 캐시한다. 일정 데이터는 건드리지 않는다.
//    - 일정은 localStorage(`journey-note-*`)와 Firestore 실시간 동기화가 정본이고,
//      이 워커는 localStorage·IndexedDB를 읽거나 쓰지 않는다.
// 2) 모든 쓰기(POST/PUT/PATCH/DELETE)와 외부 API(Firestore·Google Maps·날씨·환율·Photon)는
//    그대로 네트워크로 보낸다. (respondWith 없이 통과 → 캐시·재전송·가로채기 없음)
// 3) **화면과 코드 모두 네트워크 우선**이다(v10). 새 배포가 있으면 다음 실행에 바로 반영되고,
//    오프라인일 때만 마지막으로 받은 사본을 보여준다.
//    v9 까지는 JS 를 '캐시 먼저'로 줬다. 그래서 새 배포 뒤에도 옛 viago-auth-client.js 가
//    한 번은 그대로 실행돼 초대 참여가 실패했다(옛 코드 + 새 화면). 그 창을 없앤다.
// 4) 새 워커는 skipWaiting + clients.claim 으로 바로 활성화된다. 화면(index.html)은
//    controllerchange 를 받으면 한 번 새로고침해, 옛 코드가 남은 화면을 새 코드로 갈아 끼운다.
// 4) 새 워커는 skipWaiting + clients.claim 으로 바로 활성화된다. 화면(index.html)은
//    controllerchange 를 받으면 새 코드로 갈아 끼우고, 입력 중이면 안내 막대(새로고침)를 띄운다.
//    화면이 보내는 { type: 'SKIP_WAITING' } 메시지도 같은 동작을 한다(대기 중인 워커용).
const VERSION = 'v32';   // 2026-11-16 v30: 하단 탭 '지도' → '정산'(정산·가계부) · 지도 패널·setView('map') 유지 · v29 아이콘 유지
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
  './viago-expense-ocr.js',   // 거래내역 캡처·영수증 글자 파서(v32) — OCR 자체는 필요할 때만 CDN 에서 받는다
  './viago-sync-v3.js',       // (구) 인증 없는 저장 구현 — 앱이 더 이상 부르지 않지만 남겨 둔다
  './manifest.webmanifest',
  './app-icon-32.png',
  './app-icon-180.png',
  './app-icon-192.png',
  './app-icon-512.png',
  './app-icon.svg',
  './viago-travel-cover.webp',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL);
      // HTTP 캐시를 거치지 않고 받아 둔다(설치 시점의 최신 파일).
      //   하나라도 빠지면 오프라인에서 그 파일만 비므로, 조용히 넘기지 않고 기록해 둔다(CI 가 파일 존재를 먼저 검사한다).
      const results = await Promise.all(SHELL_FILES.map(file => cache.add(new Request(file, { cache: 'reload' })).then(() => null).catch(error => ({ file, error: String(error) }))));
      const failed = results.filter(Boolean);
      if (failed.length) console.warn('[viago sw] 캐시하지 못한 껍데기 파일', failed);
    } catch (e) {}
    // v10: 새 워커가 대기하지 않고 바로 활성화된다(옛 코드가 계속 도는 시간을 없앤다).
    try { await self.skipWaiting(); } catch (e) {}
  })());
});

// 화면의 「새로고침」이 대기 중인 워커를 바로 활성화하도록 한다.
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting().catch(() => {}); return; }
  if (data.type === 'VERSION' && event.source) { event.source.postMessage({ type: 'VERSION', version: VERSION }); }
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== SHELL && key.startsWith(OUR_PREFIX)).map(key => caches.delete(key)));
    } catch (e) {}
    try { await self.clients.claim(); } catch (e) {}
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;                 // 저장·동기화 요청은 손대지 않는다
  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;      // Firestore·Google 지도·날씨·환율 등 외부 API
  if (url.pathname.endsWith('/service-worker.js')) return;
  if (url.pathname.includes('/api/')) return;           // 정적 호스팅에는 서버 API 가 없다
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request, true)); return; }
  if (/\.(?:js|css|png|webp|svg|jpg|jpeg|ico|woff2?|webmanifest)$/i.test(url.pathname)) {
    // 코드·스타일·아이콘 전부 네트워크 우선(v10). 오프라인이면 캐시로 연다.
    event.respondWith(networkFirst(request, false));
  }
});

async function cachePut(request, response) {
  try {
    const cache = await caches.open(SHELL);
    await cache.put(request, response);
  } catch (e) {}
}

async function fromCache(request) {
  const cache = await caches.open(SHELL);
  return (await cache.match(request)) ||
    (await cache.match(request, { ignoreSearch: true })) ||   // ?v= 가 달라도 같은 파일이면 찾는다
    null;
}

async function networkFirst(request, isNavigate) {
  try {
    // cache: 'no-store' — 브라우저 HTTP 캐시의 옛 사본을 쓰지 않는다.
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) cachePut(isNavigate ? new Request('./index.html') : request, response.clone());
    return response;
  } catch (error) {
    const cached = await fromCache(request);
    if (cached) return cached;
    if (isNavigate) {
      const cache = await caches.open(SHELL);
      return (await cache.match('./index.html')) || (await cache.match('./')) ||
        new Response('오프라인 상태예요. 인터넷에 연결한 뒤 다시 열어주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return new Response('', { status: 504 });
  }
}
