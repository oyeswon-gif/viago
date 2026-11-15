// tests/e2e/planb-brief.mjs — 2순위 기능(일정별 플랜 B · 전날 브리핑) 검증
// 실행: npm ci && npx playwright install chromium && node tests/e2e/planb-brief.mjs
// 확인: ① 편집 화면에서 플랜 B 입력 → 저장 → 카드 배지 + 펼침 ② 새로고침·오프라인에서 유지
//       ③ 마지막 날은 '귀국 브리핑' ④ 시트가 지도 44%·타임라인 공간을 잡아먹지 않음
//       ⑤ 터치 타겟 44px ⑥ Google Places·Geocoding 호출 0건 ⑦ 동기화(3-way 병합) 호환
//       ⑧ 플랜 B 없는 기존 데이터(rev 160 형태) 그대로 동작 — 마이그레이션 없음
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'tests/e2e/shots');
const PORT = Number(process.env.PORT || 8933);
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

  const state = { google: [], googleService: [], loads: 0 };
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    const host = u.hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
    if (/googleapis\.com$/.test(host) || /gstatic\.com$/.test(host) || /(^|\.)google\.com$/.test(host)) {
      state.google.push(u.href);
      if (/places|geocode|directions|distancematrix/.test(u.pathname)) state.googleService.push(u.href);
    }
    return route.abort();
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // 첫 실행에서만 시드를 넣는다(새로고침 때 사용자가 고친 값을 덮어쓰지 않도록).
  await page.addInitScript(t => {
    if (localStorage.getItem('journey-note-e2e-seed') === 'v1') return;
    localStorage.setItem('journey-note-trips', JSON.stringify(t));
    localStorage.setItem('journey-note-current-trip', 'demo-trip');
    localStorage.setItem('journey-note-voter', '테스터');
    localStorage.setItem('journey-note-e2e-seed', 'v1');
  }, seed);

  state.loads++;
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await page.waitForTimeout(1800);
  await page.locator('#dateTabs [data-i]').nth(0).click();
  await page.waitForTimeout(700);

  // ⑧ 하위 호환: planB 가 없는 기존 데이터 — 배지가 없고 그대로 열린다
  const compat = await page.evaluate(() => ({
    cards: document.querySelectorAll('#timeline .place').length,
    pills: document.querySelectorAll('.place-planb-btn').length,
    blocks: document.querySelectorAll('.place-planb').length
  }));
  rec('P1 플랜 B 없는 기존 일정이 그대로 열린다(마이그레이션 없음)', compat.cards === 4 && compat.pills === 0 && compat.blocks === 0, JSON.stringify(compat));

  const before = await page.evaluate(() => ({ h: Math.round(document.querySelector('#journeyDayPreview').getBoundingClientRect().height), rows: document.querySelectorAll('#timeline .swipe-row').length, legs: document.querySelectorAll('#timeline .trip-leg').length }));

  // 편집 화면에서 플랜 B 입력 → 저장
  await page.evaluate(() => openEditDialog(1));
  await page.waitForSelector('#editPlanB', { state: 'visible', timeout: 8000 });
  const dialogField = await page.evaluate(() => {
    const input = document.querySelector('#editPlanB');
    const label = input && input.closest('label');
    return { exists: !!input, label: label ? label.textContent.replace(/\s+/g, ' ').trim().slice(0, 12) : '', hint: label ? !!label.querySelector('small') : false };
  });
  await page.fill('#editPlanB', '비 오면 근처 상가 지하 푸드코트 · 5분');
  await page.click('#editConfirm');
  await page.waitForTimeout(900);
  const saved = await page.evaluate(() => {
    const card = document.querySelectorAll('#timeline .place')[1];
    const pill = card.querySelector('.place-planb-btn'), block = card.querySelector('.place-planb');
    const trips = JSON.parse(localStorage.getItem('journey-note-trips') || '[]');
    return {
      pill: !!pill, pillText: pill ? pill.textContent.trim() : '', expanded: pill ? pill.getAttribute('aria-expanded') : null,
      blockDisplay: block ? getComputedStyle(block).display : 'missing', blockText: block ? block.textContent.replace(/\s+/g, ' ').trim() : '',
      stored: (trips[0].days[0].places[1] || {}).planB || '',
      othersUntouched: trips[0].days[0].places.filter((p, i) => i !== 1).every(p => p.planB === undefined) && trips[0].days[1].places.every(p => p.planB === undefined)
    };
  });
  rec('P2 편집 화면에 플랜 B 입력란과 안내가 있다', dialogField.exists && /플랜 B/.test(dialogField.label) && dialogField.hint, JSON.stringify(dialogField));
  rec('P3 저장하면 카드에 플랜 B 배지가 붙고 접힌 채로 있다', saved.pill && saved.pillText === '플랜 B' && saved.expanded === 'false' && saved.blockDisplay === 'none', JSON.stringify(saved));
  rec('P4 저장값이 해당 장소에만 planB 로 들어간다(다른 장소·일차는 그대로)', saved.stored === '비 오면 근처 상가 지하 푸드코트 · 5분' && saved.othersUntouched, saved.stored);

  // 배지를 누르면 인라인으로 대체 내용이 펼쳐지고, 카드 탭(지도 미리보기)으로 새지 않는다
  await page.evaluate(() => document.querySelectorAll('#timeline .place-planb-btn')[0].click());
  await page.waitForTimeout(400);
  const expand = await page.evaluate(() => {
    const card = document.querySelectorAll('#timeline .place')[1], block = card.querySelector('.place-planb');
    return { open: card.classList.contains('planb-open'), display: block ? getComputedStyle(block).display : '', text: block ? block.textContent.replace(/\s+/g, ' ').trim() : '', quickOpen: !!document.querySelector('#quickMap.open'), expanded: card.querySelector('.place-planb-btn').getAttribute('aria-expanded') };
  });
  rec('P5 플랜 B 배지를 누르면 대체 내용이 카드 안에서 펼쳐진다', expand.open && expand.display !== 'none' && /푸드코트/.test(expand.text) && expand.expanded === 'true', JSON.stringify(expand));
  rec('P6 배지 탭이 카드 탭(지도 미리보기)으로 새지 않는다', expand.quickOpen === false);

  // 지도 44%·타임라인 구조는 그대로
  const after = await page.evaluate(() => ({
    h: Math.round(document.querySelector('#journeyDayPreview').getBoundingClientRect().height),
    docW: document.documentElement.scrollWidth,
    rows: document.querySelectorAll('#timeline .swipe-row').length,
    legs: document.querySelectorAll('#timeline .trip-leg').length
  }));
  rec('P7 플랜 B 를 넣어도 지도 높이(44%)·카드 수·이동 pill 이 그대로다', after.h === before.h && after.rows === before.rows && after.legs === before.legs && after.docW <= 390, `h ${before.h}→${after.h}, rows ${after.rows}, legs ${after.legs}, docW=${after.docW}`);
  await page.screenshot({ path: path.join(SHOTS, 'planb-390x844.png') });

  // 새로고침(로컬 저장) 후에도 유지
  state.loads++;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.locator('#dateTabs [data-i]').nth(0).click();
  await page.waitForTimeout(600);
  const persisted = await page.evaluate(() => {
    const card = document.querySelectorAll('#timeline .place')[1];
    card.querySelector('.place-planb-btn')?.click();
    return { pills: document.querySelectorAll('.place-planb-btn').length, text: (document.querySelector('.place-planb') || {}).textContent || '' };
  });
  rec('P8 새로고침 뒤에도 플랜 B 가 남아 있고 다시 펼쳐진다', persisted.pills === 1 && /푸드코트/.test(persisted.text), JSON.stringify(persisted));

  // 전날 브리핑: 1일차(03.01)를 보는 중 → 내일(2일차 03.02)
  const brief = await page.evaluate(async () => {
    document.querySelector('#briefBtn').click();
    await new Promise(r => setTimeout(r, 350));
    const sheet = document.querySelector('#dayBrief'), card = document.querySelector('.brief-card');
    const rect = card.getBoundingClientRect();
    return {
      visible: !sheet.hidden,
      title: document.querySelector('#briefTitle').textContent.trim(),
      sub: document.querySelector('#briefSub').textContent.trim(),
      base: document.querySelector('#briefBase').textContent.trim(),
      secs: [...document.querySelectorAll('#briefBody .brief-sec h4')].map(h => h.textContent.replace(/\s+/g, ' ').trim()),
      order: [...document.querySelectorAll('#briefBody .brief-order li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()),
      leg: (document.querySelector('#briefBody .brief-leg') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(),
      cardH: Math.round(rect.height), cardW: Math.round(rect.width), cardTop: Math.round(rect.top),
      openLabel: document.querySelector('#briefOpenDay').textContent.trim()
    };
  });
  rec('P9 상단 버튼으로 전날 브리핑 시트가 열린다(내일 = 2일차 03.02)', brief.visible && brief.title === '전날 브리핑' && /내일 · 2일차 03\.02 화 · 3곳/.test(brief.sub) && /오늘 1일차/.test(brief.base), `${brief.title} / ${brief.sub} / ${brief.base}`);
  rec('P10 ① 예약 강조 · ② 전체 순서·첫 이동 · ③ 플랜 B/주의 요약이 한 화면에 있다', brief.secs.length === 3 && /예약 확정/.test(brief.secs[0]) && /일정 순서/.test(brief.secs[1]) && /플랜 B/.test(brief.secs[2]) && brief.order.length === 3 && /첫 이동 · 도보/.test(brief.leg), JSON.stringify({ secs: brief.secs, leg: brief.leg }));
  rec('P11 시트는 화면 폭을 쓰고 화면 높이의 86%를 넘지 않는다(레이아웃을 밀지 않음)', brief.cardW >= 380 && brief.cardH <= Math.round(844 * 0.87) && brief.cardH > 300 && brief.cardTop > 0, `w=${brief.cardW}, h=${brief.cardH}, top=${brief.cardTop}`);
  await page.screenshot({ path: path.join(SHOTS, 'brief-390x844.png') });

  const whileOpen = await page.evaluate(() => ({
    mapH: Math.round(document.querySelector('#journeyDayPreview').getBoundingClientRect().height),
    docW: document.documentElement.scrollWidth,
    mapStillVisible: getComputedStyle(document.querySelector('#journeyDayPreview')).display !== 'none',
    sheetOnTop: (() => { const el = document.elementFromPoint(195, 700); return !!(el && el.closest('#dayBrief')); })()
  }));
  rec('P12 브리핑 시트가 지도 위에 뜨고 지도 44%·가로 넘침이 그대로다', whileOpen.mapH === before.h && whileOpen.docW <= 390 && whileOpen.mapStillVisible && whileOpen.sheetOnTop, JSON.stringify(whileOpen));

  // 닫기 + '일정 열기'로 해당 일차로 이동
  await page.evaluate(() => document.querySelector('#briefOpenDay').click());
  await page.waitForTimeout(700);
  const jumped = await page.evaluate(() => ({
    closed: document.querySelector('#dayBrief').hidden, day: dayIndex,
    cards: document.querySelectorAll('#timeline .place').length,
    activeTab: (document.querySelector('#dateTabs .date-tab.active') || {}).textContent || ''
  }));
  rec('P13 「2일차 일정 열기」가 시트를 닫고 그 날짜로 이동한다', jumped.closed && jumped.day === 1 && jumped.cards === 3 && /2일차/.test(jumped.activeTab), JSON.stringify(jumped));

  // 마지막 날: 플랜 B·주의 메모를 채운 뒤 귀국 브리핑 확인
  await page.evaluate(() => openEditDialog(0));
  await page.waitForSelector('#editPlanB', { state: 'visible' });
  await page.fill('#editPlaceNote', '현금만 가능 · 대표 메뉴 1,800엔');
  await page.fill('#editPlanB', '카드 되는 옆 상점가로 대체');
  await page.click('#editConfirm');
  await page.waitForTimeout(800);
  await page.evaluate(() => openEditDialog(1));
  await page.waitForSelector('#editPlanB', { state: 'visible' });
  await page.fill('#editPlanB', '웨이팅 길면 근처 다른 국수집');
  await page.click('#editConfirm');
  await page.waitForTimeout(800);

  const ret = await page.evaluate(async () => {
    document.querySelector('#briefBtn').click();
    await new Promise(r => setTimeout(r, 350));
    const out = {
      title: document.querySelector('#briefTitle').textContent.trim(),
      sub: document.querySelector('#briefSub').textContent.trim(),
      hint: [...document.querySelectorAll('#briefBody .brief-hint')].map(h => h.textContent.trim()),
      chips: [...document.querySelectorAll('#briefBody .brief-chip')].map(c => c.textContent.trim()),
      plans: [...document.querySelectorAll('#briefBody .brief-plan')].map(p => p.textContent.replace(/\s+/g, ' ').trim()),
      marks: [...document.querySelectorAll('#briefBody .brief-mark')].map(m => m.textContent.trim()),
      resv: [...document.querySelectorAll('#briefBody .brief-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim())
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 220));
    out.escClosed = document.querySelector('#dayBrief').hidden;
    return out;
  });
  rec('P14 마지막 날에는 귀국 브리핑(귀국 요약)으로 바뀐다', ret.title === '귀국 브리핑' && /마지막 날/.test(ret.sub) && ret.hint.length > 0, `${ret.title} / ${ret.sub}`);
  rec('P15 ③플랜 B·주의 메모에 등록 건과 주의 키워드(현금)가 모인다', ret.plans.length === 2 && ret.chips.some(c => /현금/.test(c)), JSON.stringify({ plans: ret.plans, chips: ret.chips }));
  rec('P16 일정 순서 목록에도 플랜 B 표시가 붙는다', ret.marks.length === 2 && ret.marks.every(m => m === '플랜 B'), ret.marks.join(','));
  rec('P17 Esc 로 시트가 닫힌다', ret.escClosed === true);

  // 터치 타겟 44px (새로 추가한 버튼 포함)
  await page.locator('#dateTabs [data-i]').nth(0).click();
  await page.waitForTimeout(500);
  const small = await page.evaluate(() => {
    const sel = 'button, a[href], input, select, [role="button"]';
    const out = [];
    document.querySelectorAll(sel).forEach(el => {
      if (el.closest('.leaflet-container, .leaflet-control, #mapPanel, .quick-map, dialog')) return;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') return;
      if (r.bottom < 0 || r.top > innerHeight) return;
      let w = r.width, h = r.height;
      const a = getComputedStyle(el, '::after');
      if (a && a.content !== 'none' && a.position === 'absolute') {
        const px = v => Math.abs(parseFloat(v) || 0);
        w += px(a.left) + px(a.right); h += px(a.top) + px(a.bottom);
      }
      if (w < 44 || h < 44) out.push(`${(el.id ? '#' + el.id : el.className || el.tagName).toString().slice(0, 30)} ${Math.round(w)}x${Math.round(h)}`);
    });
    return out;
  });
  rec('P18 새 버튼(브리핑·플랜 B 배지)이 44px 이상', small.length === 0, small.slice(0, 5).join(' / '));

  // 오프라인 재실행에서도 플랜 B·브리핑이 동작한다
  await ctx.setOffline(true);
  state.loads++;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2300);
  const offline = await page.evaluate(async () => {
    const tab = document.querySelectorAll('#dateTabs [data-i]')[0];
    if (tab) tab.click();
    await new Promise(r => setTimeout(r, 500));
    document.querySelector('#briefBtn').click();
    await new Promise(r => setTimeout(r, 350));
    return {
      pills: document.querySelectorAll('.place-planb-btn').length,
      sheetOpen: !document.querySelector('#dayBrief').hidden,
      plans: [...document.querySelectorAll('#briefBody .brief-plan')].length,
      status: (document.querySelector('#syncStatus') || {}).textContent || ''
    };
  });
  rec('P19 오프라인에서도 플랜 B 카드와 전날 브리핑이 그대로 뜬다', offline.pills >= 1 && offline.sheetOpen && offline.plans >= 1, JSON.stringify(offline));
  await ctx.setOffline(false);

  // 동기화(3-way 병합) 호환 — planB 는 선택 필드라 겹치지 않으면 양쪽이 함께 남는다
  const merged = await page.evaluate(() => {
    const clone = o => JSON.parse(JSON.stringify(o));
    const base = { trips: clone(JSON.parse(localStorage.getItem('journey-note-trips'))) };
    const local = clone(base);
    local.trips[0].days[0].places[1].planB = '현지에서 수정한 플랜 B';
    const remote = clone(base);
    remote.trips[0].days[0].places[2].planB = '주희가 넣은 플랜 B';
    remote.trips[0].days[1].places.push({ id: 'remote-new', name: '새로 추가된 곳', note: '동기화 확인', kind: '장소' });
    const out = mergeJourney(base, local, remote, false);
    const a = out.payload.trips[0].days[0].places;
    return {
      conflicts: out.conflicts.length, localKept: (a[1] || {}).planB || '', remoteKept: (a[2] || {}).planB || '',
      added: out.payload.trips[0].days[1].places.some(p => p.id === 'remote-new'), legacyUntouched: (a[0] || {}).planB === undefined
    };
  });
  rec('P20 동기화 병합에서도 planB 가 살아남고 겹치지 않으면 충돌이 없다', merged.conflicts === 0 && merged.localKept === '현지에서 수정한 플랜 B' && merged.remoteKept === '주희가 넣은 플랜 B' && merged.added && merged.legacyUntouched, JSON.stringify(merged));

  // 플랜 B 를 지우면 필드도 배지도 사라진다(빈 값을 저장하지 않는다)
  await page.evaluate(() => {
    document.querySelector('#dayBrief').hidden = true;
    openEditDialog(1);
  });
  await page.waitForSelector('#editPlanB', { state: 'visible' });
  await page.fill('#editPlanB', '');
  await page.click('#editConfirm');
  await page.waitForTimeout(900);
  const cleared = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('journey-note-trips'))[0].days[0].places[1];
    return { hasKey: Object.prototype.hasOwnProperty.call(p, 'planB'), pills: document.querySelectorAll('.place-planb-btn').length };
  });
  rec('P21 플랜 B 를 비우면 필드를 지우고 배지도 사라진다', cleared.hasKey === false && cleared.pills === 0, JSON.stringify(cleared));

  // Google 호출 0건 유지 (페이지 로드 수만큼 지도 부트스트랩 1회까지 허용)
  rec('P22 Google Places·Geocoding 호출 0건', state.googleService.length === 0, `${state.googleService.length}건`);
  const bootstrap = state.google.filter(h => /maps\/api\/js/.test(h)).length;
  rec('P23 Google 지도 JS 부트스트랩 로드당 1회 이하', bootstrap <= state.loads, `${bootstrap}회 / 로드 ${state.loads}회`);
  rec('P24 페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

  const passed = results.filter(r => r.ok).length;
  console.log(`\n== 플랜 B·전날 브리핑: ${passed}/${results.length} 통과 ==`);
  fs.writeFileSync(path.join(SHOTS, 'planb-brief-last-run.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 1));
  await browser.close();
  srv.close();
  process.exit(passed === results.length ? 0 : 1);
})();
