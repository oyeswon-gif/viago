// 비상용 킬 스위치 서비스 워커 — VIAGO 전용
// 배포 위치: 저장소 루트의 service-worker.js (기존 워커 파일을 이 내용으로 덮어쓴 뒤 push)
//
// 범위 원칙 (같은 도메인 oyeswon-gif.github.io 의 다른 앱을 건드리지 않는다)
//   ① 지우는 캐시는 이름이 `viago-` 로 시작하는 것만.
//      Cache Storage 는 출처(origin) 단위로 공유되므로, 전체 삭제하면 /ring 같은 다른 앱의 캐시까지 사라진다.
//   ② localStorage·IndexedDB·쿠키는 읽지도 쓰지도 않는다. (여행 일정 `journey-note-*` 보존)
//   ③ 새로고침은 이 워커의 범위(/viago/) 안에 있는 창만.
//   ④ 자기 등록만 해제한다.
// 되돌리려면 정상 service-worker.js 를 다시 push (등록은 다음 방문에 새로 된다).
const KILL_VERSION = 'kill-2';
const OUR_PREFIX = 'viago-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(OUR_PREFIX)).map(key => caches.delete(key)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.filter(client => client.url.startsWith(scope)).forEach(client => client.navigate(client.url));
    } catch (e) {}
  })());
});

// 네트워크로 그대로 통과 (이 워커가 다시 화면을 가로채지 않는다)
self.addEventListener('fetch', () => {});
