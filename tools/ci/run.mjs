// tools/ci/run.mjs — 로컬·CI 공용 진입점: node tools/ci/run.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const steps = [
  ['문법 검사', 'tools/ci/check-syntax.mjs'],
  ['껍데기 일관성', 'tools/ci/check-shell.mjs'],
  ['비밀키·개인정보', 'tools/ci/scan-secrets.mjs'],
  ['회귀 불변식', 'tools/ci/regression.test.mjs']
];

let failed = [];
for (const [name, file] of steps) {
  console.log(`\n───── ${name} (${file}) ─────`);
  const r = spawnSync(process.execPath, [path.join(ROOT, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(name);
}

console.log('');
if (failed.length) {
  console.log(`❌ 실패: ${failed.join(', ')}`);
  console.log('고칠 곳은 docs/REGRESSION-CHECKLIST.md 의 해당 M# 항목입니다.');
  process.exit(1);
}
console.log('✅ 모든 검사 통과 — 배포 절차(docs/REGRESSION-CHECKLIST.md)로 넘어가세요.');
