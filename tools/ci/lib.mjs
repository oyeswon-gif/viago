// tools/ci/lib.mjs — CI 검사 공용 함수 (의존성 없음)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const name of fs.readdirSync(abs)) {
    if (name === 'node_modules' || name === 'vendor' || name.startsWith('.')) continue;
    const rel = path.join(dir, name);
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

// service-worker.js 의 VERSION, index.html 의 ?v= 값, 껍데기 자산 목록
export function shellState() {
  const sw = read('service-worker.js');
  const html = read('index.html');
  const version = (sw.match(/const VERSION\s*=\s*'([^']+)'/) || [])[1] || null;
  const files = (() => {
    const m = sw.match(/const SHELL_FILES\s*=\s*\[([\s\S]*?)\]/);
    if (!m) return [];
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  })();
  const queries = [...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]);
  const swQuery = (html.match(/service-worker\.js\?v=(\d+)/) || [])[1] || null;
  return { sw, html, version, files, queries, swQuery };
}

// 껍데기 지문: SW VERSION 과 무관하게 "파일 내용"만 본다.
export function shellFingerprint(files) {
  const hash = crypto.createHash('sha256');
  // 워커 자체도 껍데기다: 워커를 고치면 VERSION 도 함께 올리게 한다.
  for (const f of [...files, './service-worker.js'].sort()) {
    const rel = f === './' ? 'index.html' : f.replace(/^\.\//, '');
    if (!exists(rel)) { hash.update(`MISSING:${rel}`); continue; }
    hash.update(rel + ':');
    hash.update(fs.readFileSync(path.join(ROOT, rel)));
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 16);
}

export function report(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}
