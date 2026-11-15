// tools/ci/regression.test.mjs — 지난 사고가 코드로 되살아나지 않았는지 확인하는 불변식 검사
// 각 검사 이름 앞의 R# 은 docs/REGRESSION-CHECKLIST.md 의 M# 항목과 연결된다.
import { read, exists, report } from './lib.mjs';

const html = read('index.html');
const sw = read('service-worker.js');
const auth = read('viago-auth-client.js');
const css = read('journey-design.css');
let ok = true;
const check = (name, cond, detail = '') => { ok = report(name, cond, detail) && ok; };
const section = (src, start, end) => {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = end ? src.indexOf(end, i + start.length) : -1;
  return j < 0 ? src.slice(i, i + 6000) : src.slice(i, j);
};

// R1 — 지도 카메라: 자동 맞춤은 viagoFrameMap 한 곳에서만, 사용자 조작을 양보한다 (M3)
const camera = section(html, 'const viagoCameras', 'function viagoDrawContext');
check('R1 지도: 사용자 조작 양보 가드', /touchedAt\s*>\s*opts\.requestAt/.test(camera) && /cam\.touchedAt\s*>\s*cam\.fittedAt/.test(camera));
check('R1 지도: 지도 크기 35% 여백 제한', /0\.35/.test(camera));
const drawLocated = section(html, 'async function drawLocated', 'async function locatePlace');
check('R1 지도: drawLocated 가 fitBounds 를 직접 부르지 않음', !!drawLocated && !/fitBounds/.test(drawLocated));

// R2 — SW 캐시 전략: 껍데기는 네트워크 우선 (M4)
check('R2 SW: navigate → networkFirst', /request\.mode\s*===\s*'navigate'[\s\S]{0,80}networkFirst/.test(sw));
check('R2 SW: js/css/이미지 → networkFirst', /\\\.\(\?:js\|css\|png/.test(sw) && /networkFirst\(request,\s*false\)/.test(sw));
check('R2 SW: cacheFirst 없음', !/cacheFirst/.test(sw));
check('R2 SW: 응답 검사(ok) 뒤에만 캐시', /response\s*&&\s*response\.ok\)\s*cachePut/.test(sw));
check('R2 SW: 옛 캐시 정리', /startsWith\(OUR_PREFIX\)[\s\S]{0,80}caches\.delete/.test(sw));

// R3 — SW 갱신 UX (M4)
check('R3 SW: skipWaiting·clients.claim', /skipWaiting\(\)/.test(sw) && /clients\.claim\(\)/.test(sw));
check('R3 SW: message 채널(SKIP_WAITING)', /addEventListener\('message'/.test(sw) && /SKIP_WAITING/.test(sw));
check('R3 화면: 새 버전 안내 막대', /id="swUpdate"/.test(html) && /새 버전/.test(html));

// R4 — 초대 게이트는 hidden 으로만 숨긴다 (M7)
check('R4 게이트: hidden 규칙 존재', /#inviteGate\[hidden\][^{]*\{[^}]*display\s*:\s*none/.test(html));
check('R4 게이트: 해시 이동만으로 참여하지 않음', !/location\.replace\([^)]*#invite=/.test(html));

// R5 — Firestore 요청은 authedFetch 하나로, 항상 idToken (M2)
const authed = section(auth, 'async function authedFetch', '\n  }');
check('R5 인증: authedFetch 가 Authorization 헤더를 붙임', /Authorization/.test(authed) && /Bearer/.test(authed));
check('R5 인증: idToken 을 매 요청 갱신', /idToken/.test(authed));
check('R5 인증: 401 을 멤버 아님으로 해석하지 않음', !/401[\s\S]{0,40}not_member/.test(auth));

// R6 — 자동완성 목록(role=combobox·suggestion-list)은 <label> 밖에 둔다 (M1)
const autocompleteInsideLabel = [...html.matchAll(/<label[^>]*>((?:(?!<\/label>)[\s\S]){0,3000}?)<\/label>/g)]
  .filter(m => /suggestion-list|role="combobox"/.test(m[1]));
check('R6 자동완성 입력이 label 안에 없음', autocompleteInsideLabel.length === 0, `${autocompleteInsideLabel.length}곳`);
check('R6 자동완성 응답 세대 확인(취소·재확인)', /AbortController/.test(html) && /placePreviewRequest|requestId/.test(html));

// R7 — 로컬 자산은 상대 경로만 (M5: /viago-..., /splash-... 절대 경로 404)
check('R7 절대 경로 자산 없음', !/(?:src|href)="\/viago[-/]/.test(html) && !/(?:src|href)="\/splash-/.test(html));

// R8 — 반지 앱 경로를 앱이 쓰지 않는다 (M10)
const clientFiles = ['index.html', 'viago-auth-client.js', 'viago-auth-firebase.js', 'viago-sync-v3.js', 'journey-sync.js', 'journey-preview.js']
  .filter(f => exists(f)).map(f => [f, read(f)]);
const ringUse = clientFiles.filter(([, src]) => /weddingRingRooms/.test(src)).map(([f]) => f);
check('R8 반지 앱 경로 미사용', ringUse.length === 0, ringUse.join(', '));
check('R8 VIAGO 컬렉션 사용', /viagoRooms/.test(auth) && /viagoInvites/.test(auth));

// R9 — 이동시간은 저장된 좌표 계산으로만 (Places/Geocoding 호출 없음, M11)
check('R9 이동시간 좌표 계산', /haversine|distanceMeters|kmBetween|legFor|tripLeg/.test(html));
const boot = section(html, '\n    startSharedSync();', 'const prepareReorder');
check('R9 부팅 경로에 Places 호출 없음', !!boot && !/placesRequest\(/.test(boot), boot ? `${boot.length}자 구간` : '구간 없음');

// R10 — 문지기(터치) 규칙이 CSS 에 살아 있음 (M8)
check('R10 터치: 아이콘 버튼 44px', /\.icon-btn\{[^}]*width:\s*44px/.test(css));
check('R10 터치: 카드 화살표 히트 영역', /\.more::after\{[^}]*inset:/.test(css) || /\.more\{[^}]*min-width:\s*44px/.test(css));
check('R10 터치: 눌림(active) 피드백', /:active/.test(css));

// R11 — 중복 함수 정의 없음 (M15: 패치 이어붙임)
const topLevelFn = [...html.matchAll(/^ {4}function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
const dupFn = [...new Set(topLevelFn.filter((n, i) => topLevelFn.indexOf(n) !== i))];
check('R11 중복 함수 정의 없음', dupFn.length === 0, dupFn.slice(0, 6).join(', '));

// R12 — iOS PWA 기본기 (M9)
check('R12 safe-area 하단 여백', /env\(safe-area-inset-bottom\)/.test(css));
check('R12 동적 뷰포트(dvh)', /dvh/.test(css) && /dvh/.test(html));
check('R12 가로 넘침 차단', /overflow-x:\s*hidden/.test(html) || /overflow-x:\s*hidden/.test(css));
check('R12 한 줄 말줄임 3종', /text-overflow:\s*ellipsis/.test(css) && /min-width:\s*0/.test(css));

// R13 — 플랜 B 는 선택 필드: 편집 입력·카드 배지가 있고, 부팅이 기본값을 심지 않는다 (M17)
check('R13 플랜 B 편집 입력란', /id="editPlanB"/.test(html));
check('R13 플랜 B 카드 배지·펼침', /place-planb-btn/.test(html) && /class="place-planb"/.test(html));
const ensureFeatures = section(html, 'function ensureTripFeatures', 'function inAppBrowserInfo');
check('R13 기존 일정에 planB 기본값을 심지 않음', !!ensureFeatures && !/planB/.test(ensureFeatures));

// R14 — 전날 브리핑은 저장된 데이터만 쓴다(외부 호출 없음), 진입 버튼은 상단 바 44px (M11·M17)
const briefBlock = section(html, 'const BRIEF_WARNING_RULES', 'function renderToday');
check('R14 브리핑 계산에 외부 호출 없음', !!briefBlock && !/fetch\(|placesRequest\(|googleMaps|createGoogleMap/.test(briefBlock), briefBlock ? `${briefBlock.length}자 구간` : '구간 없음');
check('R14 브리핑 진입 버튼이 상단 바에 있고 44px', /id="briefBtn"/.test(html) && /\.brief-btn\{[^}]*height:\s*44px/.test(css));

console.log(ok ? '\n모든 회귀 불변식 통과' : '\n실패한 불변식이 있습니다 — docs/REGRESSION-CHECKLIST.md 의 해당 M# 항목을 보세요.');
process.exit(ok ? 0 : 1);
