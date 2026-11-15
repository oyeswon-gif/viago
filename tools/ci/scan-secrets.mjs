// tools/ci/scan-secrets.mjs — 비밀키·토큰·개인정보가 공개 저장소로 들어오는 것을 막는다.
// 저장소는 public 이다. 브라우저용 Maps 키만 허용 목록(tools/ci/allowlist.json)에 근거와 함께 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk, report } from './lib.mjs';

const TEXT = /\.(html|js|mjs|css|json|webmanifest|md|txt|yml|yaml|py|sh|rules)$/i;
const SKIP = /^(node_modules|vendor|\.git)\//;
const SELF = /^tools\/ci\/allowlist\.json$/;   // 허용 목록 파일은 값이 곧 근거라 스캔에서 뺀다
const files = walk('.').filter(f => TEXT.test(f) && !SKIP.test(f) && !SELF.test(f));

const allowlist = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ci/allowlist.json'), 'utf8')); } catch (e) { return []; }
})();
const allowed = (value, file) => allowlist.some(a => a.value === value && (!a.file || a.file === file));

const RULES = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, what: '개인키' },
  { id: 'service-account', re: /"type"\s*:\s*"service_account"/g, what: 'Firebase 서비스 계정 키' },
  { id: 'private-key-field', re: /"private_key"\s*:/g, what: '서비스 계정 private_key 필드' },
  { id: 'google-api-key', re: /AIza[0-9A-Za-z_\-]{35}/g, what: 'Google API 키' },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, what: 'AWS 액세스 키' },
  { id: 'slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g, what: 'Slack 토큰' },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g, what: 'GitHub 토큰' },
  { id: 'stripe-key', re: /\bsk_live_[0-9A-Za-z]{10,}/g, what: 'Stripe 라이브 키' },
  { id: 'jwt-bearer', re: /Bearer\s+eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, what: '실제 Bearer JWT' },
  { id: 'oauth-secret', re: /(?:client_secret|refresh_token)\s*[:=]\s*["'][^"']{12,}["']/g, what: 'OAuth 시크릿' },
  { id: 'korean-rrn', re: /\b\d{6}-?[1-4]\d{6}\b/g, what: '주민등록번호 형태' },
  { id: 'korean-phone', re: /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, what: '휴대전화 번호' }
];

let ok = true;
let hits = 0;
for (const file of files) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lines = text.split('\n');
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line))) {
        hits++;
        if (allowed(m[0], file)) continue;
        ok = report(`${rule.what} 노출 의심`, false, `${file}:${i + 1} — ${m[0].slice(0, 12)}…`);
      }
    }
  }
}

if (ok) report('비밀키·개인정보 스캔', true, `파일 ${files.length}개 · 허용 ${allowlist.length}건 · 걸림 0건`);
else report('비밀키·개인정보 스캔', false, `허용 목록에 근거를 적거나 값을 지우세요 (tools/ci/allowlist.json)`);
process.exit(ok ? 0 : 1);
