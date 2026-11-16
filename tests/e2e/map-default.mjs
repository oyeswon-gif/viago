// tests/e2e/map-default.mjs — 시안 C: 하루 지도 기본값(⌂) · 길게 눌러 저장 · ＋/－ 검증 (2026-11-16)
// 실행: npm ci && npx playwright install chromium && node tests/e2e/map-default.mjs
// 확인: ① 인라인 지도 제스처(드래그·핀치·더블탭·휠) ② ＋/－ 캡슐 44px
//       ③ 길게 누르면 저장 시트, 이 일차/여행 공통 저장 ④ ⌂ 한 번으로 저장한 화면 복귀
//       ⑤ 저장값이 여행 문서 필드(mapView·dayMapViews)+localStorage 사본으로 남고, 일차 전환·새로고침·오프라인에서도 그 화면으로 열림
//       ⑥ 첫 1회 말풍선이 저장/탭 뒤 사라지고 다시 뜨지 않음 ⑦ 지도 44%·가로 넘침 없음 ⑧ Google Places 0건
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'tests/e2e/shots');
const PORT = Number(process.env.PORT || 8934);
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

  const watch = () => {
    const state = { google: [], googleService: [], loads: 0 };
    return state;
  };
  const state = watch();

  const newPage = async (ctx, { seedOnce = true } = {}) => {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ trips, once }) => {
      if (once && localStorage.getItem('journey-note-e2e-seed') === 'v1') return;
      localStorage.setItem('journey-note-trips', JSON.stringify(trips));
      localStorage.setItem('journey-note-current-trip', 'demo-trip');
      localStorage.setItem('journey-note-voter', '테스터');
      localStorage.setItem('journey-note-e2e-seed', 'v1');
    }, { trips: seed, once: seedOnce });
    // Leaflet 인스턴스를 관찰해 지도 중심·배율을 읽는다(앱 코드는 건드리지 않는다)
    await page.addInitScript(() => {
      window.__maps = {};
      let current;
      Object.defineProperty(window, 'L', {
        configurable: true,
        get() { return current; },
        set(value) {
          current = value;
          if (value && value.map && !value.map.__viagoPatched) {
            const original = value.map;
            value.map = function (id, options) {
              const map = original.call(value, id, options);
              try { window.__maps[typeof id === 'string' ? id : 'x'] = map; } catch (e) {}
              return map;
            };
            value.map.__viagoPatched = true;
          }
        }
      });
    });
    return { page, errors };
  };

  const routeAll = async (ctx) => {
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      const host = u.hostname;
      if (host === '127.0.0.1' || host === 'localhost') return route.continue();
      if (/googleapis\.com$/.test(host) || /gstatic\.com$/.test(host) || /(^|\\.)google\.com$/.test(host)) {
        state.google.push(u.href);
        if (/places|geocode|directions|distancematrix/.test(u.pathname)) state.googleService.push(u.href);
      }
      return route.abort();
    });
  };

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Tokyo' });
  await routeAll(ctx);
  const { page, errors } = await newPage(ctx);

  const view = () => page.evaluate(() => {
    const m = window.__maps && window.__maps['journeyDayMap'];
    if (!m) return null;
    const c = m.getCenter();
    return { lat: Number((typeof c.lat === 'function' ? c.lat() : c.lat).toFixed(5)), lng: Number((typeof c.lng === 'function' ? c.lng() : c.lng).toFixed(5)), zoom: m.getZoom() };
  });
  const same = (a, b, eps = 0.0004) => !!a && !!b && Math.abs(a.lat - b.lat) < eps && Math.abs(a.lng - b.lng) < eps && Math.abs(a.zoom - b.zoom) < 0.01;
  const dragMap = async (dx, dy) => {
    const box = await page.locator('#journeyDayMap').boundingBox();
    const x = box.x + box.width * 0.5, y = box.y + box.height * 0.45;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + dx * i / 8, y + dy * i / 8);
    await page.mouse.up();
    await page.waitForTimeout(650);
  };
  const longPress = async (selector = '#journeyMapHome') => {
    const b = await page.locator(selector).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const sheetOpen = () => page.evaluate(() => !document.getElementById('mapViewSheet').hidden);

  state.loads++;
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.locator('#dateTabs [data-i]').nth(0).click();
  await page.waitForTimeout(1200);

  // ① 인라인 지도 제스처 — 예전에는 journeyDayMap 만 dragging·touchZoom·wheel 이 꺼져 있었다
  const gestures = await page.evaluate(() => {
    const m = window.__maps && window.__maps['journeyDayMap'];
    if (!m || !m.dragging) return { missing: true };
    return {
      dragging: m.dragging.enabled(), touchZoom: m.touchZoom.enabled(), doubleClickZoom: m.doubleClickZoom.enabled(),
      scrollWheelZoom: m.scrollWheelZoom.enabled(), touchAction: getComputedStyle(document.getElementById('journeyDayMap')).touchAction
    };
  });
  rec('D1 인라인 지도에서 드래그·핀치·더블탭·스크롤 확대가 모두 살아 있다', !gestures.missing && gestures.dragging && gestures.touchZoom && gestures.doubleClickZoom && gestures.scrollWheelZoom, JSON.stringify(gestures));

  const initial = await view();
  await dragMap(-150, -90);
  const dragged = await view();
  rec('D2 손가락(마우스) 드래그로 지도 중심이 실제로 움직인다', !same(initial, dragged) && dragged.lat < initial.lat, `before ${JSON.stringify(initial)} → after ${JSON.stringify(dragged)}`);

  // 드래그 뒤 새로 드러난 쪽 타일이 비지 않는다 (map.off('moveend') 로 타일 그리드 처리를 지우던 회귀)
  const coverage = async () => {
    const miss = await page.evaluate(() => {
      const host = document.getElementById('journeyDayMap'), hb = host.getBoundingClientRect();
      const tiles = [...host.querySelectorAll('img.leaflet-tile')].map(t => t.getBoundingClientRect());
      let gap = 0;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        const x = hb.x + hb.width * (i + 0.5) / 6, y = hb.y + hb.height * (j + 0.5) / 6;
        if (!tiles.some(r => x >= r.x && x <= r.right && y >= r.y && y <= r.bottom)) gap++;
      }
      return gap;
    });
    return miss;
  };
  await page.waitForTimeout(1200);
  const gaps = await coverage();
  rec('D2b 드래그한 지도에 타일이 빠진 회색 띠가 남지 않는다', gaps === 0, `빈 지점 ${gaps}/36`);

  // ② ＋/－ 캡슐 (44×88, 44px 터치 타겟)
  const zoomUi = await page.evaluate(() => {
    const box = document.querySelector('.journey-map-zoom').getBoundingClientRect();
    const home = document.getElementById('journeyMapHome').getBoundingClientRect();
    const all = document.getElementById('journeyPreviewOpen').getBoundingClientRect();
    const cells = [...document.querySelectorAll('.journey-map-zoom button')].map(b => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), label: b.getAttribute('aria-label') }; });
    return { box: { w: Math.round(box.width), h: Math.round(box.height) }, gapToAllRoute: Math.round(all.top - box.bottom), home: { w: Math.round(home.width), h: Math.round(home.height) }, cells };
  });
  rec('D3 ⌂ 44px · ＋/－ 캡슐 44×88 이고 전체 동선 위에 8px 간격으로 앉는다', zoomUi.home.w === 44 && zoomUi.home.h === 44 && zoomUi.box.w === 44 && zoomUi.box.h === 88 && zoomUi.cells.every(c => c.w === 44 && c.h === 44) && Math.abs(zoomUi.gapToAllRoute - 8) <= 2, JSON.stringify(zoomUi));

  const z0 = (await view()).zoom;
  await page.click('#journeyZoomIn');
  await page.waitForTimeout(450);
  const z1 = (await view()).zoom;
  await page.click('#journeyZoomOut');
  await page.waitForTimeout(500);
  await page.click('#journeyZoomOut');
  await page.waitForTimeout(550);
  const z2 = (await view()).zoom;
  // 빠르게 두 번 누르면 −2 (애니메이션 중에도 누른 만큼 반영)
  await page.click('#journeyZoomIn');
  await page.waitForTimeout(80);
  await page.click('#journeyZoomIn');
  await page.waitForTimeout(700);
  const z3 = (await view()).zoom;
  rec('D4 ＋/－ 가 한 단계씩 확대·축소한다(빠른 연속 탭 포함)', z1 === z0 + 1 && z2 === z0 - 1 && z3 === z2 + 2, `${z0} → ${z1} → ${z2} → ${z3}`);
  await page.waitForTimeout(1500);
  const zoomGaps = await coverage();
  rec('D4b ＋/－ 로 배율을 바꾼 뒤에도 타일이 다 덮인다', zoomGaps === 0, `빈 지점 ${zoomGaps}/36`);

  // ③ 저장값이 없을 때 ⌂ = 그날 전체 동선 맞춤
  await page.click('#journeyMapHome');
  await page.waitForTimeout(900);
  const homeNoSave = await view();
  rec('D5 저장된 기본값이 없으면 ⌂ 는 그날 전체 동선으로 돌아온다', same(homeNoSave, initial, 0.0015), `${JSON.stringify(homeNoSave)} vs 처음 ${JSON.stringify(initial)}`);

  // ④ 말풍선: 첫 1회만, 누르면 사라진다
  const hint = await page.evaluate(() => {
    const el = document.getElementById('journeyMapHint');
    const r = el.getBoundingClientRect(), a = getComputedStyle(el, '::after');
    return { hidden: el.hidden, text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), hit: { t: Math.abs(parseFloat(a.top) || 0) * 2 + Math.round(r.height) }, role: el.getAttribute('role') };
  });
  rec('D6 기본값을 저장하기 전에는 ⌂ 아래에 “길게 눌러 기본값 저장” 말풍선이 있다', !hint.hidden && hint.text === '길게 눌러 기본값 저장' && hint.role === 'button' && hint.hit.t >= 44, JSON.stringify(hint));

  // ⑤ 길게 누르면 iOS 액션 시트
  await dragMap(90, 60);
  const beforePress = await view();
  await longPress();
  const sheet = await page.evaluate(() => ({
    open: !document.getElementById('mapViewSheet').hidden,
    title: document.getElementById('mapViewSheetTitle').textContent.trim(),
    desc: document.getElementById('mapViewSheetDesc').textContent.trim(),
    day: document.getElementById('mapViewDaySub').textContent.trim(),
    trip: document.getElementById('mapViewTripSub').textContent.trim(),
    opts: [...document.querySelectorAll('#mapViewSheet .mvs-opt strong')].map(e => e.textContent.trim()),
    cancel: document.getElementById('mapViewCancel').textContent.trim(),
    onTop: (() => { const el = document.elementFromPoint(195, 700); return !!(el && el.closest('#mapViewSheet')); })()
  }));
  const afterPress = await view();
  rec('D7 ⌂ 를 500ms 길게 누르면 저장 시트가 열린다(제목·안내·두 선택지·취소)', sheet.open && sheet.title === '지도 기본값' && /지금 화면\(.+ · \d+배율\)을 기본값으로 저장할까요\?/.test(sheet.desc) && /1일차 지도/.test(sheet.day) && /모두 같은 배율로 열기/.test(sheet.trip) && sheet.opts.join(',') === '이 일차에만,여행 전체 공통' && sheet.cancel === '취소' && sheet.onTop, JSON.stringify(sheet));
  rec('D8 길게 눌러도 짧은 탭(복귀)이 함께 실행되지 않는다', same(beforePress, afterPress), `${JSON.stringify(beforePress)} → ${JSON.stringify(afterPress)}`);
  await page.screenshot({ path: path.join(SHOTS, 'map-default-sheet-390x844.png') });

  // ⑥ 취소 — 저장하지 않는다
  await page.click('#mapViewCancel');
  await page.waitForTimeout(300);
  const cancelled = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('journey-note-trips') || '[]')[0];
    return { open: !document.getElementById('mapViewSheet').hidden, mapView: t.mapView || null, days: t.dayMapViews || null };
  });
  rec('D9 시트의 취소는 아무것도 저장하지 않는다', !cancelled.open && !cancelled.mapView && !cancelled.days, JSON.stringify(cancelled));

  // ⑦ 이 일차에만 저장
  const savedTarget = await view();
  await longPress();
  await page.click('#mapViewSaveDay');
  await page.waitForTimeout(700);
  const storedDay = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('journey-note-trips') || '[]')[0];
    return { day: t.dayMapViews && t.dayMapViews['0'], common: t.mapView || null, mirror: JSON.parse(localStorage.getItem('journey-note-map-views-demo-trip') || 'null'), hintHidden: document.getElementById('journeyMapHint').hidden, hintFlag: localStorage.getItem('journey-note-map-hint-demo-trip') };
  });
  const near = (a, b) => !!a && Math.abs(a.lat - b.lat) < 0.0004 && Math.abs(a.lng - b.lng) < 0.0004 && Math.abs(a.zoom - b.zoom) < 0.01;
  rec('D10 “이 일차에만”은 그 일차의 중심·배율을 여행 문서 필드와 localStorage 사본에 함께 남긴다', near(storedDay.day, savedTarget) && !storedDay.common && near(storedDay.mirror && storedDay.mirror.days && storedDay.mirror.days['0'], savedTarget), JSON.stringify(storedDay));
  rec('D11 저장하면 첫 1회 말풍선이 사라지고 localStorage 에 기록된다', storedDay.hintHidden === true && storedDay.hintFlag === '1');

  // ⑧ ⌂ 한 번 = 저장한 화면 복귀 (+ 재렌더가 되돌리지 않는다)
  await dragMap(160, 120);
  const moved = await view();
  await page.click('#journeyMapHome');
  await page.waitForTimeout(800);
  const back = await view();
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); });
  await page.waitForTimeout(900);
  const afterRerender = await view();
  rec('D12 ⌂ 를 한 번 누르면 저장한 중심·배율로 즉시 돌아온다', !same(moved, savedTarget) && same(back, savedTarget, 0.0012), `${JSON.stringify(savedTarget)} ← ${JSON.stringify(back)} (움직였던 곳 ${JSON.stringify(moved)})`);
  rec('D13 복귀한 뒤 재렌더·동기화 갱신이 지도를 다른 곳으로 되돌리지 않는다', same(afterRerender, back, 0.0008), JSON.stringify(afterRerender));

  // ⑨ 2일차에 자기 기본값을 저장한 뒤, 1일차에서 “여행 전체 공통” 저장
  await page.locator('#dateTabs [data-i]').nth(1).click();
  await page.waitForTimeout(1500);
  await dragMap(-70, -50);
  await page.evaluate(() => { const m = window.__maps['journeyDayMap']; m.setView([35.1622, 136.8944], 13, { animate: false }); });
  await page.waitForTimeout(500);
  const day2Target = await view();
  await longPress();
  await page.click('#mapViewSaveDay');
  await page.waitForTimeout(700);
  const day2Stored = await page.evaluate(() => JSON.parse(localStorage.getItem('journey-note-trips'))[0].dayMapViews || null);
  rec('D14 2일차 기본값은 그 일차 항목으로만 저장된다', near(day2Stored && day2Stored['1'], day2Target) && !!day2Stored['0'], JSON.stringify(day2Stored));

  await page.locator('#dateTabs [data-i]').nth(0).click();
  await page.waitForTimeout(1500);
  const day1Auto = await view();
  rec('D15 저장된 기본값이 있는 일차는 넓은 자동 맞춤 대신 그 기본값으로 열린다', same(day1Auto, savedTarget, 0.0012), `${JSON.stringify(day1Auto)} vs 저장값 ${JSON.stringify(savedTarget)}`);

  await page.evaluate(() => { const m = window.__maps['journeyDayMap']; m.setView([35.1705, 136.8834], 15, { animate: false }); });
  await page.waitForTimeout(500);
  const commonTarget = await view();
  await longPress();
  await page.click('#mapViewSaveTrip');
  await page.waitForTimeout(700);
  const commonStored = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('journey-note-trips'))[0];
    return { common: t.mapView || null, days: t.dayMapViews || null };
  });
  rec('D16 “여행 전체 공통”은 중심·배율을 여행 공통값으로 저장하고 이 일차의 따로 저장값은 정리한다(지금 화면 그대로 복귀)', near(commonStored.common, commonTarget) && !(commonStored.days && commonStored.days['0']) && near(commonStored.days && commonStored.days['1'], { lat: day2Target.lat, lng: day2Target.lng, zoom: commonTarget.zoom }), JSON.stringify(commonStored));

  const day1Common = await view();
  await page.locator('#dateTabs [data-i]').nth(1).click();
  await page.waitForTimeout(1500);
  const day2Common = await view();
  rec('D17 여행 공통은 1~2일차 모두 같은 배율로 열린다(자기 중심은 유지)', Math.abs(day1Common.zoom - commonTarget.zoom) < 0.01 && Math.abs(day2Common.zoom - commonTarget.zoom) < 0.01 && Math.abs(day2Common.lat - day2Target.lat) < 0.001 && Math.abs(day2Common.lng - day2Target.lng) < 0.001, `1일차 ${JSON.stringify(day1Common)} / 2일차 ${JSON.stringify(day2Common)}`);
  await page.screenshot({ path: path.join(SHOTS, 'map-default-390x844.png') });

  // ⑩ 새로고침·오프라인에서도 저장한 화면으로 열린다 (말풍선은 다시 뜨지 않는다)
  state.loads++;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await page.waitForTimeout(2200);
  const reloaded = await view();
  const hintAfterReload = await page.evaluate(() => document.getElementById('journeyMapHint').hidden);
  rec('D18 새로고침해도 저장한 기본값으로 열리고 말풍선은 다시 뜨지 않는다', same(reloaded, commonTarget, 0.0012) && hintAfterReload === true, `${JSON.stringify(reloaded)} / hintHidden=${hintAfterReload}`);

  await ctx.setOffline(true);
  state.loads++;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2400);
  const offlineView = await view();
  rec('D19 오프라인에서도 저장한 기본값이 그대로 적용된다', same(offlineView, commonTarget, 0.0012), JSON.stringify(offlineView));
  await ctx.setOffline(false);

  // ⑪ 같은 지도에서 처음부터 다시: 말풍선 탭으로 닫으면 기록되고 다시 뜨지 않는다
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Tokyo' });
  await routeAll(ctx2);
  const second = await newPage(ctx2, { seedOnce: false });
  await second.page.addInitScript(() => {
    // 저장값이 없는 새 여행 상태로 한 번만 되돌린다(문서 필드·사본·안내 기록 제거)
    if (localStorage.getItem('journey-note-e2e-clean') === '1') return;
    const trips = JSON.parse(localStorage.getItem('journey-note-trips') || '[]');
    trips.forEach(t => { delete t.mapView; delete t.dayMapViews; });
    localStorage.setItem('journey-note-trips', JSON.stringify(trips));
    Object.keys(localStorage).filter(k => k.startsWith('journey-note-map-')).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('journey-note-e2e-clean', '1');
  });
  state.loads++;
  await second.page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await second.page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await second.page.waitForTimeout(2000);
  const hintFirst = await second.page.evaluate(() => !document.getElementById('journeyMapHint').hidden);
  await second.page.locator('#journeyMapHint').tap();
  await second.page.waitForTimeout(300);
  const hintTapped = await second.page.evaluate(() => ({ hidden: document.getElementById('journeyMapHint').hidden, flag: localStorage.getItem('journey-note-map-hint-demo-trip') }));
  await second.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await second.page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await second.page.waitForTimeout(2000);
  state.loads++;
  const hintAfter = await second.page.evaluate(() => document.getElementById('journeyMapHint').hidden);
  rec('D20 첫 1회 말풍선은 탭하면 사라지고, 새로고침해도 다시 뜨지 않는다', hintFirst === true && hintTapped.hidden === true && hintTapped.flag === '1' && hintAfter === true, JSON.stringify({ hintFirst, hintTapped, hintAfter }));

  // ⑫ 딤·Esc 로도 닫힌다
  const b2 = await second.page.locator('#journeyMapHome').boundingBox();
  await second.page.mouse.move(b2.x + 22, b2.y + 22);
  await second.page.mouse.down();
  await second.page.waitForTimeout(650);
  await second.page.mouse.up();
  await second.page.waitForTimeout(200);
  const openedByMouse = await second.page.evaluate(() => !document.getElementById('mapViewSheet').hidden);
  await second.page.evaluate(() => document.getElementById('mapViewDim').click());
  await second.page.waitForTimeout(200);
  const closedByDim = await second.page.evaluate(() => document.getElementById('mapViewSheet').hidden);
  await second.page.evaluate(() => {
    const b = document.getElementById('journeyMapHome');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 0, clientY: 0 }));
  });
  await second.page.waitForTimeout(650);
  await second.page.evaluate(() => {
    const b = document.getElementById('journeyMapHome');
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
  });
  await second.page.waitForTimeout(200);
  const openedByTouch = await second.page.evaluate(() => !document.getElementById('mapViewSheet').hidden);
  await second.page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await second.page.waitForTimeout(200);
  const closedByEsc = await second.page.evaluate(() => document.getElementById('mapViewSheet').hidden);
  rec('D21 딤 탭·Esc 로 닫히고, 터치 길게 누르기에도 시트가 열린다', openedByMouse && closedByDim && openedByTouch && closedByEsc, JSON.stringify({ openedByMouse, closedByDim, openedByTouch, closedByEsc }));

  // ⑬ 동기화(3-way 병합) 호환 — 일차별 저장은 서로 다른 일차면 충돌 없이 함께 남는다
  const merged = await second.page.evaluate(() => {
    const clone = o => JSON.parse(JSON.stringify(o));
    const base = { trips: clone(JSON.parse(localStorage.getItem('journey-note-trips'))) };
    const local = clone(base), remote = clone(base);
    local.trips[0].dayMapViews = { '0': { lat: 35.17, lng: 136.88, zoom: 15 } };
    remote.trips[0].mapView = { lat: 35.16, lng: 136.9, zoom: 13 };
    const out = mergeJourney(base, local, remote, false);
    return { conflicts: out.conflicts.length, days: out.payload.trips[0].dayMapViews || null, common: out.payload.trips[0].mapView || null };
  });
  rec('D22 동기화 병합에서도 mapView·dayMapViews 가 충돌 없이 함께 남는다', merged.conflicts === 0 && merged.days && merged.days['0'] && merged.common && merged.common.zoom === 13, JSON.stringify(merged));

  // ⑭ 지도 크기·가로 넘침·터치 타겟 (기존 화면 그대로)
  const layout = await second.page.evaluate(() => {
    const h = Math.round(document.getElementById('journeyDayPreview').getBoundingClientRect().height);
    const docW = document.documentElement.scrollWidth;
    const small = [];
    document.querySelectorAll('button, a[href], input, select, [role="button"]').forEach(el => {
      if (el.closest('.leaflet-container, .leaflet-control, #mapPanel, .quick-map, dialog, #mapViewSheet')) return;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') return;
      if (r.bottom < 0 || r.top > innerHeight) return;
      let w = r.width, hh = r.height;
      const a = getComputedStyle(el, '::after');
      if (a && a.content !== 'none' && a.position === 'absolute') {
        const px = v => Math.abs(parseFloat(v) || 0);
        w += px(a.left) + px(a.right); hh += px(a.top) + px(a.bottom);
      }
      if (w < 44 || hh < 44) small.push(`${el.id ? '#' + el.id : el.className || el.tagName} ${Math.round(w)}x${Math.round(hh)}`);
    });
    return { h, docW, small };
  });
  rec('D23 지도 높이 44%(370px)·가로 넘침 없음·새 버튼 44px 이상', layout.h === 370 && layout.docW <= 390 && layout.small.length === 0, JSON.stringify(layout));

  rec('D24 Google Places·Geocoding 호출 0건', state.googleService.length === 0, `${state.googleService.length}건`);
  const bootstrap = state.google.filter(h => /maps\/api\/js/.test(h)).length;
  rec('D25 Google 지도 JS 부트스트랩 로드당 1회 이하', bootstrap <= state.loads, `${bootstrap}회 / 로드 ${state.loads}회`);
  rec('D26 페이지 오류 없음(두 세션)', errors.length === 0 && second.errors.length === 0, [...errors, ...second.errors].slice(0, 3).join(' | '));

  const passed = results.filter(r => r.ok).length;
  console.log(`\n== 시안 C 지도 기본값: ${passed}/${results.length} 통과 ==`);
  fs.writeFileSync(path.join(SHOTS, 'map-default-last-run.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 1));
  await browser.close();
  srv.close();
  process.exit(passed === results.length ? 0 : 1);
})();
