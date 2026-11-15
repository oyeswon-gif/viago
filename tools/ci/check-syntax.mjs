// tools/ci/check-syntax.mjs — 모든 JS 와 index.html 안의 인라인 스크립트 문법 검사
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT, walk, read, report } from './lib.mjs';

let ok = true;

// 1) 저장소의 .js 파일 (vendor 는 서드파티라 제외)
const files = walk('.').filter(f => f.endsWith('.js') && !f.startsWith('vendor/'));
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    new vm.Script(src, { filename: f });
  } catch (e) {
    ok = report(`문법 ${f}`, false, e.message) && ok;
  }
}
ok = report(`문법: JS ${files.length}개`, ok) && ok;

// 2) index.html 인라인 스크립트 (src 없는 <script>)
const html = read('index.html');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
let inlineOk = true;
inline.forEach((code, i) => {
  try {
    new vm.Script(code, { filename: `index.html#inline${i + 1}` });
  } catch (e) {
    inlineOk = report(`문법 index.html 인라인 스크립트 #${i + 1}`, false, e.message) && inlineOk;
  }
});
ok = report(`문법: 인라인 스크립트 ${inline.length}개`, inlineOk) && ok;

// 3) 태그 짝: script/style/head/body 개수 (문자열 치환 사고 방지)
const count = (re) => (html.match(re) || []).length;
const tagsOk = count(/<script\b/gi) === count(/<\/script>/gi) && count(/<style\b/gi) === count(/<\/style>/gi) &&
  count(/<body\b/gi) === 1 && count(/<\/body>/gi) === 1 && count(/<head\b/gi) === 1 && count(/<\/head>/gi) === 1;
ok = report('구조: script·style·head·body 태그 짝', tagsOk,
  tagsOk ? '' : `script ${count(/<script\b/gi)}/${count(/<\/script>/gi)}, style ${count(/<style\b/gi)}/${count(/<\/style>/gi)}`) && ok;

process.exit(ok ? 0 : 1);
