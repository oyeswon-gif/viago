// tests/e2e/expenses-tab.mjs — 정산·가계부 탭 (v30) 검증
// 실행: node tests/e2e/expenses-tab.mjs   (외부 의존 없이 로컬 서버 + Playwright)
// 확인: ① 하단 탭 일정·오늘·정산·환율(지도 버튼 제거, #mapPanel·setView('map')은 유지)
//       ② 총 지출·낸 사람 비율·원화 환산 ③ 1/2 정산 계산 ④ 카테고리 합계·필터
//       ⑤ 지출 추가(실시간 원화 환산)·삭제 ⑥ 정산 완료 표시 ⑦ 44px 터치 타겟
//       ⑧ 일정 탭 '전체 동선' → 지도 패널 진입·복귀 ⑨ Google Places/Geocoding 0건
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

// 환율은 고정값(1엔 = 8.00원)을 심어 계산을 결정적으로 만든다. 지출 저장은 엔화뿐이다.
const RATE = { rates: { KRW: 1, JPY: 0.125, IDR: 11.7 }, base: 'KRW', provider: 'ExchangeRate-API', providerUpdatedAt: new Date().toISOString(), fetchedAt: Date.now(), live: true };
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/demo-trip.json'), 'utf8')).trips;
seed[0].destination = '나고야';
seed[0].name = '나고야 여행';
seed[0].expenses = [
  { id: 'seed-1', title: '로바타야키 이부시긴', amountJpy: 9800, payer: '재원', category: '식비', createdAt: '2026-12-10T21:00:00+09:00' },
  { id: 'seed-2', title: '스이카 충전', amountJpy: 6000, payer: '주희', category: '교통', createdAt: '2026-12-11T12:10:00+09:00' },
  { id: 'seed-3', title: '고토니 스시', amountJpy: 12400, payer: '재원', category: '식비', createdAt: '2026-12-11T19:30:00+09:00' }
];

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache', 'service-worker-allowed': '/' });
  r.end(fs.readFileSync(f));
});

const yenToWon = yen => '₩' + new Intl.NumberFormat('ko-KR').format(Math.round(yen * 8));
const num = text => Number(String(text).replace(/[^0-9-]/g, '')) || 0;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Tokyo' });

  const state = { google: [], googleService: [] };
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    const host = u.hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
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
  page.on('dialog', d => d.accept());
  await page.addInitScript(([trips, rate]) => {
    localStorage.setItem('journey-note-trips', JSON.stringify(trips));
    localStorage.setItem('journey-note-current-trip', 'demo-trip');
    localStorage.setItem('journey-note-voter', '재원');
    localStorage.setItem('journey-note-exchange-rate', JSON.stringify(rate));
  }, [seed, RATE]);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await page.waitForTimeout(2000);

  // E1 — 하단 탭 구성과 지도 DOM 보존
  const tabs = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('.nav-item')].map(x => x.textContent.trim()),
    views: [...document.querySelectorAll('.nav-item')].map(x => x.dataset.view),
    mapPanel: !!document.querySelector('#mapPanel'),
    mapView: typeof setView === 'function'
  }));
  rec('E1 하단 탭이 일정·오늘·정산·환율 4개다', tabs.labels.join('|') === '일정|오늘|정산|환율' && !tabs.views.includes('map'), tabs.labels.join('|'));
  rec('E1b 지도 버튼은 없어도 #mapPanel 과 setView 는 남아 있다', tabs.mapPanel && tabs.mapView, JSON.stringify(tabs));

  // E2 — 정산 탭 열기
  await page.locator('.nav-item[data-view="expenses"]').click();
  await page.waitForTimeout(900);
  const opened = await page.evaluate(() => ({
    active: document.querySelector('.nav-item.active')?.dataset.view,
    panel: getComputedStyle(document.querySelector('#expensesPanel')).display,
    itinerary: getComputedStyle(document.querySelector('#itineraryPanel')).display,
    heading: document.querySelector('.expenses-head h2')?.textContent,
    rate: document.querySelector('#expensesRate')?.textContent,
    rateBadge: document.querySelector('#expensesRate')?.getBoundingClientRect().width > 0
  }));
  rec('E2 정산 탭을 누르면 정산 화면만 보인다', opened.active === 'expenses' && opened.panel === 'block' && opened.itinerary === 'none', JSON.stringify(opened));
  rec('E2b 헤더에 정산 제목과 1엔 환율 배지가 있다', opened.heading === '정산' && /^1엔 8\.00원$/.test(opened.rate || ''), `${opened.heading} / ${opened.rate}`);

  // E3 — 총 지출·낸 사람 비율·원화 환산
  const total = await page.evaluate(() => {
    const card = document.querySelector('.expense-total');
    return {
      yen: card.querySelector('.expense-total-line strong')?.textContent,
      won: card.querySelector('.expense-total-line span')?.textContent,
      count: card.querySelector('.expense-total-top span:last-child')?.textContent,
      segments: [...card.querySelectorAll('.expense-bar i')].map(i => Math.round(i.getBoundingClientRect().width)),
      legend: [...card.querySelectorAll('.expense-bar-legend span')].map(x => x.textContent.trim()),
      bar: Math.round(card.querySelector('.expense-bar').getBoundingClientRect().width)
    };
  });
  rec('E3 총 지출이 엔화 합계와 원화 환산으로 보인다', num(total.yen) === 28200 && total.won.replace(/\s/g, '') === '≈' + yenToWon(28200) && total.count === '3건', `${total.yen} ${total.won} ${total.count}`);
  const sumSeg = total.segments.reduce((a, b) => a + b, 0);
  rec('E3b 낸 사람 비율 바가 두 사람 합계와 맞는다', total.segments.length === 2 && Math.abs(sumSeg - total.bar) <= 1, total.segments.join('+') + ' / ' + total.bar);
  rec('E3c 각자 합계가 보인다', total.legend.includes('재원 ¥22,200') && total.legend.includes('주희 ¥6,000'), total.legend.join(' | '));

  // E4 — 1/2 정산 계산
  const settle = await page.evaluate(() => ({
    label: document.querySelector('.expense-settle-label')?.textContent,
    line: document.querySelector('.expense-settle-line')?.textContent.replace(/\s+/g, ' ').trim(),
    sub: document.querySelector('.expense-settle-sub')?.textContent,
    button: document.querySelector('#expenseSettleDone')?.textContent,
    user: document.querySelector('#expensesSub')?.textContent
  }));
  rec('E4 반씩 정산하면 적게 낸 사람이 더 낸 사람에게 보낸다', settle.label === '반씩 정산하면' && settle.line === '주희 → 재원 ¥8,100' && settle.button === '정산 완료', JSON.stringify(settle));
  rec('E4b 정산 금액의 원화 환산이 붙는다', (settle.sub || '').replace(/\s/g, '').includes('≈' + yenToWon(8100)), settle.sub);

  // E5 — 카테고리 4칸 요약
  const cats = await page.evaluate(() => [...document.querySelectorAll('.expense-cat')].map(x => ({ name: x.dataset.cat, sum: x.querySelector('b')?.textContent })));
  rec('E5 카테고리 4칸 요약(식비·교통·쇼핑·관광)', cats.map(c => c.name).join('|') === '식비|교통|쇼핑|관광' && cats[0].sum === '¥22,200' && cats[1].sum === '¥6,000', JSON.stringify(cats));

  // E6 — 금액 입력 시 실시간 원화 환산
  await page.locator('#expenseAmount').fill('3400');
  await page.waitForTimeout(300);
  const preview = await page.textContent('#expenseAmountWon');
  rec('E6 엔화 금액을 넣으면 원화 환산이 바로 보인다', preview.replace(/\s/g, '') === '≈' + yenToWon(3400), preview);

  // E7 — 지출 추가
  await page.locator('#expenseTitle').fill('고토니 스시 추가');
  await page.locator('#expensePayers [data-payer="재원"]').click();
  await page.locator('#expenseChips [data-pick="식비"]').click();
  await page.locator('#expenseAdd').click();
  await page.waitForTimeout(700);
  const afterAdd = await page.evaluate(() => ({
    total: document.querySelector('.expense-total-line strong')?.textContent,
    won: document.querySelector('.expense-total-line span')?.textContent,
    count: document.querySelector('.expense-total-top span:last-child')?.textContent,
    added: [...document.querySelectorAll('.expense-row')].map(row => row.textContent.replace(/\s+/g, ' ').trim()).find(text => text.includes('고토니 스시 추가')) || '',
    settle: document.querySelector('.expense-settle-line')?.textContent.replace(/\s+/g, ' ').trim(),
    amount: document.querySelector('#expenseAmount')?.value,
    stored: JSON.parse(localStorage.getItem('journey-note-trips'))[0].expenses.find(item => item.title === '고토니 스시 추가')
  }));
  rec('E7 추가하면 총 지출·원화·건수가 함께 바뀐다', num(afterAdd.total) === 31600 && afterAdd.won.replace(/\s/g, '') === '≈' + yenToWon(31600) && afterAdd.count === '4건', JSON.stringify(afterAdd));
  rec('E7b 새 지출이 결제자·금액과 함께 목록에 보인다', /고토니 스시 추가/.test(afterAdd.added) && /¥3,400/.test(afterAdd.added) && /재원 결제/.test(afterAdd.added), afterAdd.added);
  rec('E7c 1/2 정산이 다시 계산된다', afterAdd.settle === '주희 → 재원 ¥9,800', afterAdd.settle);
  rec('E7d 저장은 엔화 금액·낸 사람·카테고리로 남는다', afterAdd.stored?.amountJpy === 3400 && afterAdd.stored?.payer === '재원' && afterAdd.stored?.category === '식비' && afterAdd.amount === '', JSON.stringify(afterAdd.stored));

  // E8 — 정산 완료 표시
  await page.locator('#expenseSettleDone').click();
  await page.waitForTimeout(600);
  const settled = await page.evaluate(() => ({
    cls: document.querySelector('.expense-settle')?.className,
    label: document.querySelector('.expense-settle-label')?.textContent,
    undo: !!document.querySelector('#expenseSettleUndo'),
    saved: JSON.parse(localStorage.getItem('journey-note-trips'))[0].expenseSettlement?.signature
  }));
  rec('E8 정산 완료를 누르면 완료 상태로 바뀐다', /settled/.test(settled.cls || '') && settled.label === '정산 완료' && settled.undo && !!settled.saved, JSON.stringify(settled));
  await page.locator('#expenseSettleUndo').click();
  await page.waitForTimeout(400);
  const undone = await page.evaluate(() => ({ undo: !!document.querySelector('#expenseSettleDone'), label: document.querySelector('.expense-settle-label')?.textContent }));
  rec('E8b 되돌리기로 정산 표시를 풀 수 있다', undone.undo && undone.label === '반씩 정산하면', JSON.stringify(undone));

  // E9 — 카테고리 필터
  await page.locator('.expense-cat[data-cat="쇼핑"]').click();
  await page.waitForTimeout(400);
  const filtered = await page.evaluate(() => ({
    empty: document.querySelector('.expense-empty')?.textContent || '',
    rows: document.querySelectorAll('.expense-row').length,
    all: document.querySelector('#expensesListAll')?.textContent
  }));
  rec('E9 카테고리를 누르면 그 카테고리만 남는다', filtered.rows === 0 && /쇼핑 지출이 아직 없어요/.test(filtered.empty) && /해제/.test(filtered.all), JSON.stringify(filtered));
  await page.locator('#expensesListAll').click();
  await page.waitForTimeout(400);
  const cleared = await page.evaluate(() => document.querySelectorAll('.expense-row').length);
  rec('E9b 전체로 돌아오면 모든 지출이 보인다', cleared === 4, String(cleared));

  // E10 — 삭제(가장 위 = 가장 최근 지출 ¥12,400)
  await page.locator('.expense-del').first().click();
  await page.waitForTimeout(600);
  const afterDelete = await page.evaluate(() => ({
    total: document.querySelector('.expense-total-line strong')?.textContent,
    count: document.querySelector('.expense-total-top span:last-child')?.textContent,
    titles: [...document.querySelectorAll('.expense-row strong')].map(x => x.textContent),
    stored: JSON.parse(localStorage.getItem('journey-note-trips'))[0].expenses.length
  }));
  rec('E10 항목을 삭제하면 합계에서 빠진다', num(afterDelete.total) === 19200 && afterDelete.count === '3건' && afterDelete.stored === 3 && !afterDelete.titles.includes('고토니 스시'), JSON.stringify(afterDelete));

  // E11 — 44px 터치 타겟(정산 화면)
  const small = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.expenses-panel button, .expenses-panel input, .expenses-panel [role="button"]').forEach(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') return;
      let w = r.width, h = r.height;
      const after = getComputedStyle(el, '::after');
      if (after && after.content !== 'none' && after.position === 'absolute') {
        const px = v => Math.abs(parseFloat(v) || 0);
        w += px(after.left) + px(after.right); h += px(after.top) + px(after.bottom);
      }
      if (h < 44 || w < 44) bad.push(`${el.id || el.className} ${Math.round(w)}x${Math.round(h)}`);
    });
    return bad;
  });
  rec('E11 정산 화면 터치 타겟 44px 이상', small.length === 0, small.slice(0, 5).join(' / '));

  await page.screenshot({ path: path.join(SHOTS, 'expenses-390x844.png') });
  await page.screenshot({ path: path.join(SHOTS, 'expenses-390x844-full.png'), fullPage: true });

  // E12 — 일정 탭 '전체 동선' → 지도 패널 → 일정 복귀 (탭에서 지도를 빼도 기능은 살아 있다)
  await page.locator('.nav-item[data-view="schedule"]').click();
  await page.waitForTimeout(800);
  await page.locator('#journeyPreviewOpen').click();
  await page.waitForTimeout(900);
  const mapState = await page.evaluate(() => ({
    active: document.querySelector('.nav-item.active')?.dataset.view,
    mapDisplay: getComputedStyle(document.querySelector('#mapPanel')).display,
    mapShown: document.querySelector('#mapPanel').classList.contains('mobile-active'),
    itinerary: getComputedStyle(document.querySelector('#itineraryPanel')).display,
    heading: document.querySelector('#mapHeading')?.textContent
  }));
  rec('E12 일정 탭 전체 동선으로 지도가 열린다', mapState.active === 'map' || mapState.mapShown, JSON.stringify(mapState));
  rec('E12b 지도 화면에서 일정 패널이 숨는다', mapState.mapDisplay !== 'none' && mapState.itinerary === 'none', JSON.stringify(mapState));
  await page.locator('.nav-item[data-view="schedule"]').click();
  await page.waitForTimeout(700);
  const backState = await page.evaluate(() => ({
    active: document.querySelector('.nav-item.active')?.dataset.view,
    itinerary: getComputedStyle(document.querySelector('#itineraryPanel')).display,
    cards: document.querySelectorAll('#timeline .place').length,
    map: getComputedStyle(document.querySelector('#mapPanel')).display
  }));
  rec('E12c 일정 탭으로 다시 돌아온다', backState.active === 'schedule' && backState.itinerary !== 'none' && backState.cards >= 3 && backState.map === 'none', JSON.stringify(backState));

  rec('E13 Google Places·Geocoding 호출 0건', state.googleService.length === 0, `${state.googleService.length}건`);
  rec('E14 페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

  const passed = results.filter(r => r.ok).length;
  console.log(`\n== 정산·가계부: ${passed}/${results.length} 통과 ==`);
  fs.writeFileSync(path.join(SHOTS, 'expenses-last-run.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 1));
  await browser.close();
  srv.close();
  process.exit(passed === results.length ? 0 : 1);
})();
