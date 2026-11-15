// tools/ci/verify-live.mjs — 배포 확인: GitHub Pages 라이브가 로컬과 같은지(해시 일치)와 SW 버전·?v= 를 확인한다.
//   node tools/ci/verify-live.mjs            # 기본: https://oyeswon-gif.github.io/viago/
//   node tools/ci/verify-live.mjs https://…  # 다른 주소
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, read, exists, report } from './lib.mjs';

const BASE = (process.argv[2] || 'https://oyeswon-gif.github.io/viago/').replace(/\/?$/, '/');
const FILES = ['index.html', 'service-worker.js', 'journey-design.css', 'manifest.webmanifest', 'viago-auth-client.js', 'journey-preview.js'];
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let ok = true;
for (const file of FILES) {
  if (!exists(file)) continue;
  const local = sha(fs.readFileSync(path.join(ROOT, file)));
  let remote = '';
  try {
    const res = await fetch(`${BASE}${file}?cb=${Date.now()}`, { cache: 'no-store' });
    remote = res.ok ? sha(Buffer.from(await res.arrayBuffer())) : `HTTP ${res.status}`;
  } catch (e) {
    remote = 'fetch 오류: ' + e.message;
  }
  if (local !== remote) ok = report(`라이브 일치: ${file}`, false, `로컬 ${local.slice(0, 12)} ≠ 라이브 ${String(remote).slice(0, 12)}`);
  else report(`라이브 일치: ${file}`, true, local.slice(0, 12));
}

try {
  const html = await (await fetch(`${BASE}?cb=${Date.now()}`, { cache: 'no-store' })).text();
  const sw = await (await fetch(`${BASE}service-worker.js?cb=${Date.now()}`, { cache: 'no-store' })).text();
  const liveVersion = (sw.match(/VERSION\s*=\s*'([^']+)'/) || [])[1];
  const localVersion = (read('service-worker.js').match(/VERSION\s*=\s*'([^']+)'/) || [])[1];
  const queries = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  ok = report('SW VERSION', liveVersion === localVersion, `라이브 ${liveVersion} / 로컬 ${localVersion}`) && ok;
  ok = report('자산 ?v=', queries.length === 1, queries.join(', ')) && ok;
} catch (e) {
  ok = report('라이브 메타 확인', false, e.message) && ok;
}

console.log(ok ? '\n✅ 라이브가 로컬과 일치합니다 — 배포 완료로 보고해도 됩니다.' : '\n❌ 라이브가 로컬과 다릅니다 — Pages 빌드 상태를 확인하세요(1~2분 소요).');
process.exit(ok ? 0 : 1);
