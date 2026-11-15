// tests/e2e/smoke.mjs — VIAGO 모바일 스모크 테스트 (외부 의존 없이 로컬 서버 + Playwright)
// 실행: npm ci && npx playwright install chromium && node tests/e2e/smoke.mjs
// 확인: ① 390×844에서 일정 카드·이동 pill·카테고리 pill ② 카드 아래 인라인 미리보기
//       ③ 지도 카메라 가드(사용자 조작 양보) ④ 터치 타겟 44px ⑤ 가로 넘침·겹침
//       ⑥ 오프라인 재실행에서 일정 유지 + 안내 ⑦ Google 서비스 호출 0건
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'tests/e2e/shots');
const PORT = Number(process.env.PORT || 8931);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const results = [];
const rec = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`); return !!ok; };

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/demo-trip.json'), 'utf8')).trips;

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache', 'service-worker-allowed': '/' });
  r.end(fs.readFileSync(f));
});

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Tokyo' });

  const state = { netDown: false, google: [], googleService: [], external: [] };
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    const host = u.hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
    state.external.push(host);
    if (/googleapis\.com$/.test(host) || /gstatic\.com$/.test(host) || /(^|\.)google\.com$/.test(host)) {
      state.google.push(u.href);
      if (/places|geocode|directions|distancematrix/.test(u.pathname)) state.googleService.push(u.href);
      return route.abort();
    }
    return route.abort();
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(t => {
    localStorage.setItem('journey-note-trips', JSON.stringify(t));
    localStorage.setItem('journey-note-current-trip', 'demo-trip');
    localStorage.setItem('journey-note-voter', '테스터');
  }, seed);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.locator('#dateTabs [data-i]').nth(1).click();
  await page.waitForTimeout(1200);

  const base = await page.evaluate(() => {
    const rect = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const cards = [...document.querySelectorAll('#timeline .place')];
    const legs = [...document.querySelectorAll('#timeline .trip-leg')];
    return {
      tabs: document.querySelectorAll('#dateTabs [data-i]').length,
      cards: cards.length,
      legs: legs.length,
      legKinds: legs.map(l => l.dataset.leg),
      legText: legs.map(l => (l.textContent || '').replace(/\s+/g, ' ').trim()),
      cats: cards.map(c => (c.querySelector('.place-kind') || {}).textContent || ''),
      preview: rect('#journeyDayPreview'),
      viewportH: innerHeight,
      docW: document.documentElement.scrollWidth,
      nav: rect('.mobile-nav'),
      dayTitle: (document.querySelector('#panelHeading, #mapHeading, h2') || {}).textContent || ''
    };
  });

  rec('S1 일자 탭 2개가 그려진다', base.tabs === 2, `tabs=${base.tabs}`);
  rec('S2 일정 카드 3장 + 이동 pill 2개', base.cards === 3 && base.legs === 2, `cards=${base.cards}, legs=${base.legs}`);
  rec('S3 이동 pill 에 도보/지하철과 분 표시', base.legLabelOk !== false && base.legKinds.every(k => k === 'walk' || k === 'transit') && base.legText.some(t => /\d+분/.test(t)), base.legText.join(' | '));
  rec('S4 카테고리 pill 이 카드마다 있다', base.cats.every(c => c && c.trim().length > 0), base.cats.join(','));
  const mapPct = Math.round(base.preview.h / base.viewportH * 100);
  rec('S5 지도 높이가 화면의 44%(clamp 300~370)', base.preview.h >= 300 && base.preview.h <= 370 && mapPct >= 40, `h=${base.preview.h}px (${mapPct}%)`);
  rec('S6 가로 넘침 없음', base.docW <= 390, `scrollWidth=${base.docW}`);

  // 인라인 미리보기: 누른 카드 바로 아래
  await page.locator('#timeline .place').nth(1).click();
  await page.waitForTimeout(1800);
  const inline = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#timeline .swipe-row')];
    const row = rows[1];
    const slot = row && row.nextElementSibling && row.nextElementSibling.classList.contains('quick-map-slot') ? row.nextElementSibling : null;
    const q = document.querySelector('#quickMap');
    return { open: q ? q.classList.contains('open') : false, slotAfterRow: !!slot, slotHasQuickMap: !!(slot && slot.querySelector('#quickMap')), h: q ? Math.round(q.getBoundingClientRect().height) : 0 };
  });
  rec('S7 카드를 누르면 그 카드 아래로 미리보기가 열린다', inline.open && inline.slotAfterRow && inline.slotHasQuickMap && inline.h > 150, JSON.stringify(inline));

  // 인라인 미리보기 위의 손가락 움직임은 카드 스와이프·화면 탭 전환으로 새지 않는다
  const swipe = await page.evaluate(() => {
    const map = document.querySelector('#quickLeafletMap');
    const card = document.querySelectorAll('#timeline .place')[1];
    const touch = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: map, clientX: x, clientY: y });
      map.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    const r = map.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    const before = { transform: card.style.transform, view: currentView, open: card.dataset.open || '0' };
    touch('touchstart', Math.round(r.left + r.width - 40), y);
    touch('touchmove', Math.round(r.left + r.width - 160), y);
    touch('touchend', Math.round(r.left + r.width - 160), y);
    return { before, after: { transform: card.style.transform, view: currentView, open: card.dataset.open || '0' } };
  });
  rec('S7b 인라인 지도 위 스와이프가 카드·탭을 움직이지 않는다', swipe.before.transform === swipe.after.transform && swipe.before.open === swipe.after.open && swipe.before.view === swipe.after.view, JSON.stringify(swipe));

  // 카드 스와이프 → 삭제·편집 패널이 드러난다(닫힘 상태에서는 보이지 않아야 한다)
  const swipeCard = await page.evaluate(async () => {
    const row = document.querySelectorAll('#timeline .swipe-row')[2];
    const card = row.querySelector('.place');
    const actions = row.querySelector('.row-actions');
    const closed = getComputedStyle(actions).opacity;
    const fire = (type, x, y) => {
      const t = new Touch({ identifier: 2, target: card, clientX: x, clientY: y });
      card.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    const r = card.getBoundingClientRect(), y = Math.round(r.top + r.height / 2);
    fire('touchstart', Math.round(r.right - 60), y);
    fire('touchmove', Math.round(r.right - 160), y - 1);
    fire('touchmove', Math.round(r.right - 180), y - 1);
    fire('touchend', Math.round(r.right - 180), y - 1);
    await new Promise(res => setTimeout(res, 320));   // opacity 전환(.12s) 뒤에 읽는다
    return { closed, open: card.dataset.open, transform: card.style.transform, opened: getComputedStyle(actions).opacity };
  });
  rec('S7c 카드 스와이프로 삭제·편집 패널이 드러난다', swipeCard.open === '1' && swipeCard.transform.indexOf('translateX(-') === 0 && Number(swipeCard.opened) > 0.5 && Number(swipeCard.closed) < 0.5, JSON.stringify(swipeCard));

  // 지도 카메라 가드: 사용자가 만진 뒤 자동 맞춤은 양보, 명시적 요청만 맞춘다
  const camera = await page.evaluate(() => {
    if (typeof viagoFrameMap !== 'function' || typeof viagoCameraTouch !== 'function') return { missing: true };
    let calls = 0;
    const fake = { getContainer: () => ({ clientWidth: 320, clientHeight: 320 }), invalidateSize() {}, setView() { calls++; }, fitBounds() { calls++; } };
    const pts = [{ c: [35.16, 136.88] }, { c: [35.17, 136.90] }];
    viagoCameraTouch('e2e');
    const auto = viagoFrameMap(fake, 'leaflet', pts, { key: 'e2e', context: 'ctx', requestAt: Date.now() - 10 });
    const afterAuto = calls;
    const forced = viagoFrameMap(fake, 'leaflet', pts, { key: 'e2e', context: 'ctx', force: true });
    return { auto, afterAuto, forced, finalCalls: calls };
  });
  rec('S8 사용자가 만진 지도를 자동 맞춤이 덮어쓰지 않는다', !camera.missing && camera.auto === false && camera.afterAuto === 0, JSON.stringify(camera));
  rec('S9 명시적 요청(force)은 맞춘다', !camera.missing && camera.forced === true && camera.finalCalls > 0, `calls=${camera.finalCalls}`);

  // 터치 타겟 44px (지도 핀·attribution 은 지도 조작 요소라 제외)
  const touch = await page.evaluate(() => {
    const sel = 'button, a[href], input, select, [role="button"]';
    const small = [];
    document.querySelectorAll(sel).forEach(el => {
      if (el.closest('.leaflet-container, .leaflet-control, #mapPanel, .quick-map')) return;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') return;
      if (r.bottom < 0 || r.top > innerHeight) return;
      // ::after 로 넓힌 히트 영역을 반영
      let w = r.width, h = r.height;
      const a = getComputedStyle(el, '::after');
      if (a && a.content !== 'none' && a.position === 'absolute') {
        const px = (v) => Math.abs(parseFloat(v) || 0);
        w += px(a.left) + px(a.right); h += px(a.top) + px(a.bottom);
      }
      if (w < 44 || h < 44) small.push(`${(el.id ? '#' + el.id : el.className || el.tagName).toString().slice(0, 34)} ${Math.round(w)}x${Math.round(h)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 14)}"`);
    });
    return small;
  });
  rec('S10 터치 타겟 44px 이상', touch.length === 0, touch.slice(0, 6).join(' / '));

  await page.screenshot({ path: path.join(SHOTS, 'smoke-390x844.png') });
  await page.screenshot({ path: path.join(SHOTS, 'smoke-390x844-full.png'), fullPage: true });

  // Google 서비스 호출 0건 (지도 초기화 부트스트랩 1건은 허용, Places/Geocode 는 0)
  rec('S11 Google Places·Geocoding 호출 0건', state.googleService.length === 0, `${state.googleService.length}건`);
  const bootstrap = state.google.filter(h => /maps\/api\/js/.test(h)).length;
  rec('S12 Google 지도 JS 부트스트랩 1회 이하', bootstrap <= 1, `${bootstrap}회`);

  // 서비스 워커 + 오프라인
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    const keys = await caches.keys();
    return { scope: reg ? reg.scope : null, active: !!(reg && (reg.active || reg.installing || reg.waiting)), keys: keys.filter(k => k.startsWith('viago-')) };
  });
  rec('S13 서비스 워커 등록·껍데기 캐시', !!swState.active && swState.keys.length > 0, JSON.stringify(swState));

  state.netDown = true;
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const offline = await page.evaluate(() => ({
    tabs: document.querySelectorAll('#dateTabs [data-i]').length,
    cards: document.querySelectorAll('#timeline .place').length,
    status: (document.querySelector('#syncStatus') || {}).textContent || '',
    netChip: (document.querySelector('#netChip') || {}).textContent || ''
  })).catch(() => ({ tabs: 0, cards: 0, status: '', netChip: '' }));
  rec('S14 오프라인에서도 일정이 열린다', offline.tabs === 2 && offline.cards >= 3, JSON.stringify(offline));
  rec('S15 오프라인 안내가 화면에 보인다', /오프라인/.test(offline.status + offline.netChip), offline.status || offline.netChip);

  // 데스크톱 레이아웃
  await ctx.setOffline(false);
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await desk.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    return route.abort();
  });
  const dpage = await desk.newPage();
  const derrors = [];
  dpage.on('pageerror', e => derrors.push(e.message));
  await dpage.addInitScript(t => {
    localStorage.setItem('journey-note-trips', JSON.stringify(t));
    localStorage.setItem('journey-note-current-trip', 'demo-trip');
    localStorage.setItem('journey-note-voter', '테스터');
  }, seed);
  await dpage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dpage.waitForSelector('#dateTabs button', { timeout: 45000 });
  await dpage.waitForTimeout(2000);
  const deskState = await dpage.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    cards: document.querySelectorAll('#timeline .place').length,
    workspaceCols: getComputedStyle(document.querySelector('#workspace')).gridTemplateColumns,
    navHidden: getComputedStyle(document.querySelector('.mobile-nav')).display === 'none'
  }));
  rec('S16 데스크톱 2단 레이아웃 유지(하단 탭바는 숨김)', deskState.docW <= 1280 && deskState.cards >= 3 && deskState.navHidden && deskState.workspaceCols.split(' ').length === 2, JSON.stringify(deskState));
  await dpage.screenshot({ path: path.join(SHOTS, 'smoke-1280x900.png') });

  rec('S17 페이지 오류 없음 (모바일·데스크톱)', errors.length === 0 && derrors.length === 0, [...errors, ...derrors].slice(0, 3).join(' | '));

  const passed = results.filter(r => r.ok).length;
  console.log(`\n== 스모크: ${passed}/${results.length} 통과 ==`);
  fs.writeFileSync(path.join(SHOTS, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 1));
  await browser.close();
  srv.close();
  process.exit(passed === results.length ? 0 : 1);
})();
