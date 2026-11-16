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

// R15 — 하루 지도 기본값(시안 C): 인라인 지도 제스처, 저장은 여행 문서 선택 필드, 역지오코딩 없음 (M19)
const preview = read('journey-preview.js');
check('R15 인라인 지도 제스처 활성화',
  /L\.map\(id,\{zoomControl:id!=='journeyDayMap',dragging:true/.test(html) && /touchZoom:true/.test(html) && /scrollWheelZoom:true/.test(html));
check('R15 기본값은 여행 문서 필드(mapView·dayMapViews)+localStorage 사본',
  /mapView/.test(preview) && /dayMapViews/.test(preview) && /journey-note-map-views-/.test(preview));
check('R15 역지오코딩·외부 호출 없음(중심 지역은 저장된 좌표로만)', !/geocode|reverseGeocode|placesRequest\(|fetch\(/.test(preview));
check('R15 저장값이 없으면 ⌂ 는 그날 전체 동선', /function goHome\(\)[\s\S]{0,240}refitDay\('bounds'\)/.test(preview));
check('R15 moveend 처리기를 통째로 지우지 않음(타일 그리드)', !/map\.off\('moveend'\)\s*;/.test(preview) && /off\('moveend',previewMoveEnd\)/.test(preview));

// R16 — 앱 아이콘(2번) 전 규격·'내 여행 보관함' iOS 시트 (M20)
const manifest = read('manifest.webmanifest');
check('R16 아이콘: 32·180·192·512 파일이 모두 있다', ['app-icon-32.png', 'app-icon-180.png', 'app-icon-192.png', 'app-icon-512.png', 'app-icon.svg'].every(f => exists(f)));
check('R16 아이콘: head 가 ?v= 로 캐시를 끊는다', /apple-touch-icon[^>]*app-icon-180\.png\?v=/.test(html) && /rel="icon"[^>]*app-icon-3?2?\.png\?v=/.test(html));
check('R16 아이콘: manifest 가 같은 아이콘을 가리킨다', /app-icon-192\.png\?v=/.test(manifest) && /app-icon-512\.png\?v=/.test(manifest));
const tripDialog = section(html, '<dialog id="tripDialog"', '<div class="update-bar"');
check('R16 시트: 닫기 버튼이 .cancel 로 기존 닫기 규칙에 걸린다', /class="trip-sheet-close cancel"/.test(tripDialog) && /dialog \.cancel/.test(html));
check('R16 시트: 여행 전환·만들기 입력 id 가 그대로다', /id="destinationInput"/.test(tripDialog) && /id="tripStartInput"/.test(tripDialog) && /id="tripEndInput"/.test(tripDialog) && /id="newTripForm"/.test(tripDialog));
check('R16 시트: iOS 토큰(헤어라인·시스템 블루·44px)', /\.trip-sheet-close\{[^}]*width:\s*44px/.test(css) && /\.trip-option\+\s*\.trip-option:before\{[^}]*rgba\(60,60,67/.test(css) && /\.trip-create\{[^}]*background:var\(--blue\)/.test(css));
check('R16 시트: 목록 이름에서 이모지를 걷고 저장 값은 건드리지 않는다', /const tripLabel=/.test(html) && /esc\(label\)/.test(html));


// R17 — 정산·가계부 탭: 하단 탭은 4개(지도 버튼 제거), 지도 패널·setView 는 그대로, 지출은 trips[].expenses (M21)
const nav = section(html, '<nav class="mobile-nav"', '</nav>');
check('R17 탭: 하단 탭 4개에 정산이 있고 지도 버튼은 없다', (nav.match(/data-view="/g) || []).length === 4 && /data-view="expenses"/.test(nav) && !/data-view="map"/.test(nav));
check('R17 탭: 지도 패널과 setView(map) 진입이 살아 있다', /id="mapPanel"/.test(html) && /setView\('map'\)/.test(html) && /itineraryPanel'\)\.classList\.toggle\('map-hidden',map\|\|today\|\|exchange\|\|expenses\)/.test(html));
const expenseFeatures = section(html, 'function ensureTripFeatures', 'trips.forEach(t=>ensureTripFeatures(t))');
check('R17 정산: 지출은 trips[].expenses 로 동기화 경로에 실린다', /t\.expenses=Array\.isArray\(t\.expenses\)\?t\.expenses:\[\]/.test(ensureFeatures) && /amountJpy/.test(html) && /function renderExpenses\(/.test(html));
check('R17 가계부: 원화는 환율 탭 값만 쓰고 새 API 를 부르지 않는다', /function yenKrwRate\(\)\{const rate=exchangeValue\(1,'JPY','KRW'\)/.test(html) && !/expenses[\s\S]{0,2000}?fetch\(/.test(section(html, 'const EXPENSE_CATS', 'const tabViews=')));
check('R17 가계부: 화면 스타일이 iOS 토큰(헤어라인·시스템 블루·44px)을 쓴다', /\.expense-chip\{[^}]*min-width:44px/.test(css) && /\.expense-capture\{[^}]*min-height:52px/.test(css) && /\.capture-cta\{[^}]*min-height:46px[^}]*background:var\(--blue\)/.test(css) && /\.expense-row\{[^}]*border-top:\.5px solid var\(--hair\)/.test(css));

// R18 — 가계부 v2: 사람별 구분·1/2 정산을 화면에서 완전히 걷어냈다 (v31)
const expenseSection = section(html, '// ── 가계부 (v31)', 'const tabViews=');
check('R18 사람 구분 제거: 납부자 선택·비율 바·정산 카드 코드가 없다',
  !/expensePayers|expenseSettle(?!ment)|EXPENSE_PAYER_COLOR|expensePlan\(|expenseMembers\(/.test(html));
check('R18 사람 구분 제거: 지출 행이 결제자를 그리지 않는다',
  !!expenseSection && !/item\.payer|entry\.payer|payer\s*[:=]\s*['"]/.test(expenseSection) && !/결제자/.test(expenseSection));
check('R18 헤더는 가계부, 총 지출은 합계·건수·잔액 한 줄', /<h2>가계부<\/h2>/.test(html) && /expense-total-meta/.test(html) && /cardBalanceJpy/.test(html));

// R19 — 카테고리 누적/일별 꺾은선 그래프: SVG + 토글 + 범례 강조
check('R19 그래프: 카테고리 4색 SVG 꺾은선을 직접 그린다',
  /function expenseChartMarkup/.test(html) && /expense-chart-line/.test(html) && /EXPENSE_CAT_COLOR=\{식비:'#e2795a',교통:'#2e9a6a',쇼핑:'#8b6fd4',관광:'#e2a03f'\}/.test(html));
check('R19 그래프: 누적/일별 토글과 여행 일차 축', /data-range="cumulative"/.test(html) && /data-range="daily"/.test(html) && /expenseDraft\.chartMode==='daily'/.test(html) && /일차/.test(html) && /function expenseDays\(/.test(html));
check('R19 그래프: 범례 탭이 카테고리 강조·목록 필터로 이어진다', /expensesLegend/.test(html) && /expenseDraft\.chartFocus/.test(html) && /data-cat="\$\{category\}"/.test(html));
check('R19 그래프: 외부 라이브러리 없이 계산만 한다', !/chart\.js|Chart\.min|d3\./.test(html));

// R20 — 거래내역 캡처: 기기 안 OCR(필요할 때만 CDN) → 파서 → 확인 시트
check('R20 캡처: OCR 은 누를 때만 CDN 에서 받는다', /TESSERACT_SRC='https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js@7\.0\.0\/dist\/tesseract\.min\.js'/.test(html) && !/<script[^>]*tesseract/.test(html) && /function loadTesseract\(/.test(html));
check('R20 캡처: 파서가 껍데기에 실려 있고 SW 캐시 목록에 있다', /viago-expense-ocr\.js/.test(html) && /\.\/viago-expense-ocr\.js/.test(sw) && /parseCaptureText/.test(html));
check('R20 캡처: 확인 시트(체크·카테고리 칩·일괄 추가)가 있다', /<dialog id="captureSheet"/.test(html) && /id="captureRows"/.test(html) && /id="captureAdd"/.test(html) && /applyCapture/.test(html));
check('R20 캡처: 충전은 지출에서 빼고 잔액만 후보로 남긴다', /looksLikeTopup/.test(read('viago-expense-ocr.js')) && /isTopup/.test(html) && /cardBalanceJpy/.test(html) && /expenseTopupJpy/.test(html));
const captureSection = section(html, '// ── 거래내역 캡처', 'function bindExpenseForm');
check('R20 캡처: 사진은 서버로 보내지 않는다', !!captureSection && !/FormData|apiFetch\(|authedFetch\(|fetch\(/.test(captureSection));

// R21 — 실행 화면: iOS 시작 화면(새 지구본+VIAGO 7종)이 먼저 뜨고, 앱이 그리는 #launchCover 가 그 자리를 잇는다 (v34)
const SPLASH_SIZES = ['375x812', '390x844', '393x852', '402x874', '414x896', '430x932', '440x956'];
const splashLinks = [...html.matchAll(/<link\s+rel="apple-touch-startup-image"[^>]*>/g)].map(m => m[0]);
const splashMissing = SPLASH_SIZES.filter(size => {
  const [w, h] = size.split('x');
  return !splashLinks.some(t => t.includes(`device-width: ${w}px`) && t.includes(`device-height: ${h}px`) && t.includes('-webkit-device-pixel-ratio: 3') && /orientation:\s*portrait/.test(t) && t.includes(`./splash/${size}.png?v=`));
});
check('R21 실행 화면: iOS 시작 화면 7종이 기기 규격 media 로 연결돼 있다', splashLinks.length >= 7 && !splashMissing.length, splashMissing.length ? `빠짐: ${splashMissing.join(', ')}` : `${splashLinks.length}줄`);
const splashStamp = exists('tools/ci/splash-fingerprint.json') ? JSON.parse(read('tools/ci/splash-fingerprint.json')) : { files: {} };
const splashNotRecorded = SPLASH_SIZES.filter(size => !((splashStamp.files || {})[`splash/${size}.png`] || {}).sha256);
check('R21 실행 화면: 7종 그림이 새 지구본·VIAGO 그림으로 기록돼 있다(옛 파란 화살표로 되돌아가지 않음)', !splashNotRecorded.length && SPLASH_SIZES.every(size => { const r = splashStamp.files[`splash/${size}.png`]; const [w, h] = size.split('x').map(Number); return r.px[0] === w * 3 && r.px[1] === h * 3; }), splashNotRecorded.length ? `지문 없음: ${splashNotRecorded.join(', ')}` : 'splash-fingerprint.json · 3배 해상도');
check('R21 실행 화면: #launchCover 마크업·CSS·hideLaunchCover 가 살아 있다',
  /id="launchCover"/.test(html) && /함께 떠나는 여행/.test(html) && /#launchCover\{/.test(css) && /#launchCover\.leaving\{/.test(css) && /function hideLaunchCover\(\)/.test(html));
check('R21 실행 화면: 마크는 옛 파란 화살표가 아니라 새 지구본 앱 아이콘이다',
  /class="launch-mark"[^>]*src="\.\/app-icon-180\.png\?v=\d+"/.test(html) &&
  /\.launch-mark\{[^}]*width:72px[^}]*height:72px[^}]*border-radius:18px/.test(css), '72×72 · 둥근 모서리 18px');
check('R21 실행 화면: 첫 화면이 준비되면 걷고, 어떤 경우에도 5초 뒤에는 걷는다',
  (html.match(/hideLaunchCover\(\)/g) || []).length >= 4 && /setTimeout\(hideLaunchCover,\d+\)/.test(html));

// R22 — 가계부 캡처: 충전 행도 체크할 수 있고, 작은 캡처 글씨를 살리는 해상도로 읽는다 (v33)
check('R22 캡처: 충전(isTopup) 행을 체크박스에서 막지 않는다',
  !/aria-disabled/.test(html) && !/item\.isTopup\)return/.test(html) && /function toggleCaptureCheck/.test(html) && /function cycleCaptureCategory/.test(html));
check('R22 캡처: 충전 행도 카테고리 칩과 이름 입력을 그린다',
  !/capture-title-text/.test(html) && /item\.isTopup\?'<span class="capture-tag">충전<\/span>'/.test(html));
check('R22 캡처: 긴 캡처는 긴 변 2400px·가로 최소 1000px·고품질 보간',
  /CAPTURE_LONG_EDGE=2400/.test(html) && /CAPTURE_MIN_WIDTH=1000/.test(html) && /imageSmoothingQuality='high'/.test(html));
check('R22 캡처: 지출이 하나도 안 잡히면 더 크게 한 번 더 읽는다',
  /function captureNeedsSharpRead/.test(html) && /CAPTURE_SHARP_LONG_EDGE=3200/.test(html) && /captureNeedsSharpRead\(chosen,parsedPrimary\)/.test(html));

// R23 — 파서: 금액과 잔액이 한 줄에 뭉치거나 상호·금액이 줄로 떨어져도 거래를 놓치지 않는다 (v33)
const ocr = exists('viago-expense-ocr.js') ? read('viago-expense-ocr.js') : '';
check('R23 파서: 같은 줄에 금액과 잔액이 있어도 부호 있는 금액을 쓴다',
  /function pickTransactionMoney/.test(ocr) && /pickTransactionMoney\(rightMoney\)/.test(ocr));
check('R23 파서: 상호가 윗줄에 따로 잡혀도 그 상호로 거래를 만든다',
  /if \(pendingTitle\) \{ record\(pendingTitle, pick, time, false\); return; \}/.test(ocr));

console.log(ok ? '\n모든 회귀 불변식 통과' : '\n실패한 불변식이 있습니다 — docs/REGRESSION-CHECKLIST.md 의 해당 M# 항목을 보세요.');
process.exit(ok ? 0 : 1);
