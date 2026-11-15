// tools/ci/stamp.mjs — 껍데기 지문 기록/갱신
//   node tools/ci/stamp.mjs --init   : 지금 상태로 지문 파일을 처음 만든다(최초 1회용. 내용을 고친 뒤에는 --bump)
//   node tools/ci/stamp.mjs --bump   : SW VERSION 과 index.html 의 ?v= 를 함께 올리고 지문을 기록한다
//   node tools/ci/stamp.mjs --check  : check-shell.mjs 와 같은 검사를 지문만 확인
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, read, shellState, shellFingerprint } from './lib.mjs';

const mode = process.argv.includes('--bump') ? 'bump' : process.argv.includes('--init') ? 'init' : 'check';
const stampPath = path.join(ROOT, 'tools/ci/shell-fingerprint.json');
const state = shellState();

const bumpNumber = (v) => {
  const m = /^([a-z]*)(\d+)$/.exec(v || '');
  return m ? m[1] + (Number(m[2]) + 1) : null;
};

if (mode === 'check') {
  const stamp = JSON.parse(read('tools/ci/shell-fingerprint.json'));
  const fp = shellFingerprint(state.files);
  console.log(JSON.stringify({ ...stamp, now: fp, match: fp === stamp.hash && stamp.version === state.version }, null, 1));
  process.exit(0);
}

let version = state.version;
let assetQuery = state.queries[0] ? Number(state.queries[0]) : null;

if (mode === 'bump') {
  const nextVersion = bumpNumber(state.version);
  if (!nextVersion) { console.error(`VERSION 형식을 올릴 수 없습니다: ${state.version}`); process.exit(1); }
  if (assetQuery == null) { console.error('index.html 에 ?v= 쿼리가 없습니다'); process.exit(1); }
  version = nextVersion;
  assetQuery = assetQuery + 1;

  const swPath = path.join(ROOT, 'service-worker.js');
  fs.writeFileSync(swPath, read('service-worker.js').replace(/const VERSION\s*=\s*'[^']+';/, `const VERSION = '${version}';`));

  const htmlPath = path.join(ROOT, 'index.html');
  const oldQuery = state.queries[0];
  let html = read('index.html').split(`?v=${oldQuery}`).join(`?v=${assetQuery}`);
  fs.writeFileSync(htmlPath, html);
  console.log(`SW VERSION ${state.version} → ${version}, ?v=${oldQuery} → ?v=${assetQuery}`);
}

const after = shellState();
const fp = shellFingerprint(after.files);
fs.writeFileSync(stampPath, JSON.stringify({
  version: after.version,
  assetQuery: after.queries[0] || assetQuery,
  hash: fp,
  note: '껍데기(HTML·JS·CSS·아이콘·manifest) 내용 지문. 코드를 고치면 node tools/ci/stamp.mjs --bump 로 VERSION·?v= 와 함께 갱신합니다.'
}, null, 2) + '\n');
console.log(`기록: ${after.version} · ?v=${after.queries[0]} · ${fp}`);
