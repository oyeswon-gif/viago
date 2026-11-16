// tools/gen-splash.mjs — iOS 시작 화면(apple-touch-startup-image) 7종을 #launchCover 와 같은 그림으로 다시 만든다.
//   node tools/gen-splash.mjs                 # splash/*.png 7종을 지금의 #launchCover 그대로 다시 그린다
//   node tools/gen-splash.mjs --only 393x852  # 한 규격만
//
// 원리
//  - journey-design.css 의 #launchCover 규칙과 index.html 의 #launchCover 마크업을 **그대로 읽어** 한 장짜리
//    HTML 로 세우고, 아이폰 화면 크기(CSS px)로 열어 3배 해상도로 찍는다. 그림을 손으로 그리지 않으므로
//    앱이 직접 그리는 실행 화면과 구도가 어긋나지 않는다(app-icon 도 같은 파일을 쓴다).
//  - 글꼴: iOS 는 -apple-system(SF Pro / Apple SD Gothic Neo)로 그리지만 리눅스 렌더러에는 없다.
//    앱의 첫 글꼴 이름인 Pretendard(SF 와 자간·자형이 가장 가까운 무료 글꼴)를 받아 쓴다.
//    내려받은 글꼴은 tools/.splash-fonts/(git 제외)에만 둔다 — 배포본에는 들어가지 않는다.
//  - 393x852 는 재원 님 아이폰(1179×2556)의 규격이다. 이 파일이 가장 중요하다.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, read } from './ci/lib.mjs';
import { chromium } from 'playwright';

const SCALE = 3;                       // 아이폰 세로 화면은 모두 3배(414x896 의 2배 기기는 같은 파일을 쓴다)
const SIZES = [[375, 812], [390, 844], [393, 852], [402, 874], [414, 896], [430, 932], [440, 956]];
const FONT_DIR = path.join(ROOT, 'tools/.splash-fonts');
const FONTS = [
  ['Pretendard-Medium.woff2', 500],
  ['Pretendard-SemiBold.woff2', 600],
  ['Pretendard-Bold.woff2', 700],
  ['Pretendard-ExtraBold.woff2', 800]
];
const FONT_URL = (name) => `https://unpkg.com/pretendard@1.3.9/dist/web/static/woff2/${name}`;
const STAMP = path.join(ROOT, 'tools/ci/splash-fingerprint.json');

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i > 0 ? process.argv[i + 1] : null;
})();

// 1) 앱이 쓰는 실행 화면 그대로: CSS 규칙과 마크업을 index.html / journey-design.css 에서 뽑는다.
function launchCss() {
  const css = read('journey-design.css');
  const start = css.indexOf('/* 실행 화면(v33)');
  const end = css.indexOf('.shell{transform:none', start);
  if (start < 0 || end < 0) throw new Error('journey-design.css 에서 #launchCover 규칙을 찾지 못했습니다');
  return css.slice(start, end).trim();
}

function launchMarkup() {
  const html = read('index.html');
  const m = html.match(/<div id="launchCover"[\s\S]*?<\/div><\/div>/);
  if (!m) throw new Error('index.html 에서 #launchCover 마크업을 찾지 못했습니다');
  // 인쇄용 그림은 512 아이콘을 쓴다 — 216 기기 픽셀(72 CSS px × 3)로 줄여 찍어도 또렷하다.
  return m[0].replace(/src="\.\/app-icon-\d+\.png([^"]*)"/, 'src="./app-icon-512.png"');
}

const rootFont = (() => {
  const m = read('index.html').match(/:root\{[^}]*font-family:([^;]+);[^}]*font-synthesis:none/);
  return (m ? m[1].trim() : 'Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo",sans-serif');
})();

function pageHtml() {
  const faces = FONTS.map(([file, weight]) => `@font-face{font-family:Pretendard;src:url("/tools/.splash-fonts/${file}") format("woff2");font-weight:${weight};font-style:normal;font-display:block}`).join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<style>
${faces}
:root{font-family:${rootFont};font-synthesis:none}
html,body{margin:0;padding:0;background:#f9fcff}
*{box-sizing:border-box}
${launchCss()}
</style></head>
<body>${launchMarkup()}</body></html>`;
}

// 2) 글꼴 준비(없으면 받아 둔다)
async function ensureFonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  for (const [file] of FONTS) {
    const dest = path.join(FONT_DIR, file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) continue;
    const res = await fetch(FONT_URL(file));
    if (!res.ok) throw new Error(`글꼴을 받지 못했습니다: ${file} HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`글꼴 준비: ${file}`);
  }
}

// 3) 렌더: 로컬 서버(file:// 는 글꼴·이미지 로딩이 막힌다) → 화면 크기별 3배 캡처
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  r.end(fs.readFileSync(f));
});

// 4) 용량: 사진 아이콘 + 부드러운 그라데이션이라 트루컬러 PNG 는 500~650KB 다. 256색으로 줄여도
//    평균 차이 0.1/255 로 눈에 띄지 않고 1/3 크기가 된다(아이폰이 시작 화면을 한 번 받아 두면 끝이지만,
//    처음 설치할 때 모바일 회선으로 4MB 를 받지 않게 한다). Pillow 가 없으면 트루컬러로 둔다.
function shrinkPng(file) {
  const before = fs.statSync(file).size;
  const py = spawnSync('python3', ['-c', `
import sys
from PIL import Image
p = sys.argv[1]
im = Image.open(p).convert('RGB')
im.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG).save(p, optimize=True)
`, file], { stdio: 'ignore' });
  if (py.status !== 0) { console.log(`  (용량 줄이기 건너뜀 — Pillow 없음) ${Math.round(before / 1024)}KB`); return; }
  const after = fs.statSync(file).size;
  console.log(`  ${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB`);
}

// 5) 지문: 지금의 그림이 맞다는 것을 CI 가 확인할 수 있게 해시를 기록한다(옛 파란 화살표로 되돌아가면 CI 가 막는다).
function recordFingerprint() {
  let prev = { files: {} };
  try { prev = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch (e) {}
  const files = { ...(prev.files || {}) };
  for (const [w, h] of SIZES) {
    const rel = `splash/${w}x${h}.png`;
    const buf = fs.readFileSync(path.join(ROOT, rel));
    files[rel] = { px: [buf.readUInt32BE(16), buf.readUInt32BE(20)], bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  }
  fs.writeFileSync(STAMP, JSON.stringify({
    note: 'iOS 시작 화면 7종(#launchCover 와 같은 그림). tools/gen-splash.mjs 가 다시 그리고 이 지문도 다시 씁니다. 지문이 바뀌면 node tools/ci/stamp.mjs --bump 로 ?v= 도 올려 iPhone 캐시를 갱신하세요.',
    files
  }, null, 2) + '\n');
  console.log(`기록: ${Object.keys(files).length}종 → tools/ci/splash-fingerprint.json`);
}

await ensureFonts();
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const PORT = srv.address().port;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: SCALE, viewport: { width: 393, height: 852 } });
  await page.route('**/__splash.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml() }));
  const targets = SIZES.filter(([w, h]) => !only || only === `${w}x${h}`);
  if (!targets.length) throw new Error(`--only ${only} 규격이 목록에 없습니다`);
  for (const [w, h] of targets) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${PORT}/__splash.html`, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.load('800 36px Pretendard');
      await document.fonts.load('600 13.5px Pretendard');
      await document.fonts.ready;
      const img = document.querySelector('.launch-mark');
      if (img && img.decode) { try { await img.decode(); } catch (e) {} }
    });
    await page.waitForTimeout(120);
    const out = path.join(ROOT, 'splash', `${w}x${h}.png`);
    await page.screenshot({ path: out });
    shrinkPng(out);
    const px = await page.evaluate(() => {
      const mark = document.querySelector('.launch-mark').getBoundingClientRect();
      const strong = document.querySelector('.launch-logo strong').getBoundingClientRect();
      return { mark: [Math.round(mark.x), Math.round(mark.y), Math.round(mark.width)], strongBottom: Math.round(strong.bottom) };
    });
    console.log(`splash/${w}x${h}.png  ${w * SCALE}×${h * SCALE}  아이콘 ${px.mark[2]}px @ (${px.mark[0]},${px.mark[1]})`);
  }
  recordFingerprint();
} finally {
  await browser.close();
  srv.close();
}
