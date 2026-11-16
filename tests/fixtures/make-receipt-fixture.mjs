// tests/fixtures/make-receipt-fixture.mjs — 일본 종이 영수증 모의 이미지 생성(개인정보 없는 합성 데이터)
//   node tests/fixtures/make-receipt-fixture.mjs   → tests/fixtures/receipt-jp-donki.png
//   OCR(jpn) 실측 검증(tests/e2e/expenses-tab.mjs)에 쓰는 고정 픽스처를 다시 만든다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'receipt-jp-donki.png');

const rows = [
  ['お買上点数 5点', ''],
  ['菓子パン', '198'],
  ['ミネラルウォーター', '98'],
  ['洗剤', '498'],
  ['電池', '328'],
  ['タオル', '548'],
];
const sums = [
  ['小計', '1,670'],
  ['(内消費税 10%)', '152'],
  ['合計', '1,670'],
  ['お預り', '2,000'],
  ['お釣り', '330'],
];

const line = ([label, amount]) => `<tr><td>${label}</td><td class="num">${amount}</td></tr>`;

const html = `<!doctype html><meta charset="utf-8">
<style>
  @page { margin: 0 }
  body { margin:0; background:#e9e7e2; padding:26px; font-family:'Noto Sans CJK JP','IPAGothic','TakaoGothic',sans-serif; }
  .paper { width:392px; margin:0 auto; background:#fffdf8; padding:20px 18px 22px; box-shadow:0 1px 4px rgba(0,0,0,.18); color:#1b1b1b; }
  h1 { font-size:15px; text-align:center; letter-spacing:.4px; margin:0 0 10px; font-weight:600 }
  .store { text-align:center; font-size:15px; font-weight:700; margin:0 0 3px }
  .meta,.addr { text-align:center; font-size:10px; color:#333; margin:1px 0; }
  .hr { border-top:1px dashed #555; margin:8px 0 }
  table { width:100%; border-collapse:collapse; font-size:11.5px; }
  td { padding:2.5px 0; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .big td { font-size:13px; font-weight:700; padding-top:4px }
  .foot { text-align:center; font-size:10px; color:#333; margin-top:9px }
</style>
<div class="paper">
  <h1>領 収 書</h1>
  <p class="store">ドン・キホーテ 新宿店</p>
  <p class="addr">東京都新宿区西新宿1-1-1</p>
  <p class="meta">TEL 03-1234-5678</p>
  <p class="meta">2025年12月10日 14:32</p>
  <p class="meta">レジ 03　担当 佐藤</p>
  <div class="hr"></div>
  <table>${rows.map(line).join('')}</table>
  <div class="hr"></div>
  <table>${sums.map(line).join('')}</table>
  <div class="hr"></div>
  <table class="big"><tr><td>合計</td><td class="num">1,670</td></tr></table>
  <p class="foot">VISA クレジット<br>ありがとうございました</p>
</div>`;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 460, height: 640 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.waitForTimeout(300);
const paper = page.locator('.paper');
await paper.screenshot({ path: OUT });
await browser.close();
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
