// tools/ci/check-shell.mjs — 껍데기 일관성: SW 버전·?v= 쿼리·캐시 목록·manifest·head·지문
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, read, exists, shellState, shellFingerprint, report } from './lib.mjs';

const state = shellState();
const html = state.html;
let ok = true;
const fail = (n, d) => { ok = report(n, false, d) && ok; };
const pass = (n, d) => report(n, true, d);

// 1) SW 버전
if (!state.version) fail('SW VERSION 상수', 'service-worker.js 에 const VERSION 이 없습니다');
else pass('SW VERSION', state.version);

// 2) ?v= 쿼리 통일
const uniq = [...new Set(state.queries)];
if (!state.queries.length) fail('?v= 쿼리', 'index.html 에 ?v= 쿼리가 없습니다 (옛 캐시 방지용)');
else if (uniq.length !== 1) fail('?v= 쿼리 통일', `서로 다른 값: ${uniq.join(', ')}`);
else pass('?v= 쿼리 통일', `?v=${uniq[0]} (${state.queries.length}곳)`);

// 3) SW 등록 쿼리 = 자산 쿼리
if (!state.swQuery) fail('SW 등록 쿼리', 'index.html 에서 service-worker.js?v= 를 찾지 못했습니다');
else if (uniq.length === 1 && state.swQuery !== uniq[0]) fail('SW 등록 쿼리', `?v=${state.swQuery} ≠ 자산 ?v=${uniq[0]}`);
else pass('SW 등록 쿼리 일치', `?v=${state.swQuery}`);

// 4) 캐시 목록 파일 존재
const missingShell = state.files.map(f => (f === './' ? 'index.html' : f.replace(/^\.\//, ''))).filter(f => !exists(f));
if (missingShell.length) fail('SHELL_FILES 파일 존재', `없음: ${missingShell.join(', ')}`);
else pass('SHELL_FILES 파일 존재', `${state.files.length}개`);

// 5) index.html 이 참조하는 로컬 껍데기 자산이 실제로 있고 캐시 목록에 들어 있는지
const refs = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)(?:\?[^"#]*)?"/g)].map(m => m[1]);
const localRefs = [...new Set(refs)].filter(f => !f.startsWith('http'));
const missingRefs = localRefs.filter(f => !exists(f));
if (missingRefs.length) fail('index.html 참조 파일 존재', `404 대상: ${missingRefs.join(', ')}`);
else pass('index.html 참조 파일 존재', `${localRefs.length}개`);

const shellList = new Set(state.files.map(f => f.replace(/^\.\//, '')));
const unCached = localRefs.filter(f => /\.(js|css|webmanifest|png|svg|webp)$/.test(f) && !shellList.has(f) && !/^app-icon/.test(f) && !/^splash\//.test(f));  // splash/ 는 iOS 시작 화면 전용
if (unCached.length) fail('참조 자산이 캐시 목록에 포함', `SHELL_FILES 에 없음: ${unCached.join(', ')}`);
else pass('참조 자산 캐시 목록 포함');

// 6) manifest
let mf = null;
try { mf = JSON.parse(read('manifest.webmanifest')); } catch (e) { fail('manifest JSON', e.message); }
if (mf) {
  const need = ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color', 'icons'];
  const lack = need.filter(k => !mf[k]);
  if (lack.length) fail('manifest 필수 필드', `없음: ${lack.join(', ')}`);
  else pass('manifest 필수 필드', `${mf.name} · ${mf.display}`);
  if (!['standalone', 'fullscreen', 'minimal-ui'].includes(mf.display)) fail('manifest display', mf.display);
  const sizes = (mf.icons || []).map(i => i.sizes);
  if (!sizes.includes('192x192') || !sizes.includes('512x512')) fail('manifest 아이콘 192·512', sizes.join(','));
  else pass('manifest 아이콘 192·512');
  const missingIcons = (mf.icons || []).map(i => i.src.replace(/^\.\//, '')).filter(f => !exists(f));
  if (missingIcons.length) fail('manifest 아이콘 파일 존재', missingIcons.join(', '));
  else pass('manifest 아이콘 파일 존재');
  if (!(mf.icons || []).some(i => /maskable/.test(i.purpose || ''))) fail('maskable 아이콘', 'purpose 에 maskable 없음');
  else pass('maskable 아이콘');
  const scope = (mf.scope || '').trim();
  if (scope && !(mf.start_url || '').startsWith('.')) fail('manifest start_url/scope', `${mf.start_url} / ${scope}`);
  else pass('manifest start_url·scope', `${mf.start_url} · ${scope || '(없음)'}`);
}

// 7) head — 중복 메타·뷰포트·iOS 메타
const head = (html.match(/<head>([\s\S]*?)<\/head>/i) || [])[1] || '';
const dup = (re, name) => {
  const n = (head.match(re) || []).length;
  if (n > 1) fail(`head 중복: ${name}`, `${n}개`);
  else if (n === 0) fail(`head 필수: ${name}`, '없음');
  else pass(`head ${name}`);
};
dup(/<meta\s+name="theme-color"/gi, 'theme-color');
dup(/<meta\s+name="apple-mobile-web-app-capable"/gi, 'apple-mobile-web-app-capable');
dup(/<link\s+rel="apple-touch-icon"/gi, 'apple-touch-icon');
dup(/<link\s+rel="manifest"/gi, 'manifest link');
dup(/<meta\s+name="viewport"/gi, 'viewport');

const viewport = (head.match(/<meta\s+name="viewport"[^>]*>/) || [''])[0];
if (!/viewport-fit=cover/.test(viewport)) fail('viewport-fit=cover', viewport || 'viewport meta 없음');
else pass('viewport-fit=cover');
if (!/<meta\s+name="mobile-web-app-capable"/i.test(head)) fail('mobile-web-app-capable', '표준 메타 없음');
else pass('mobile-web-app-capable');
if (!/<html[^>]+lang="ko"/i.test(html)) fail('html lang', 'lang=ko 없음');
else pass('html lang');
if (!/<title>[^<]{2,}<\/title>/i.test(head)) fail('title', '없음');
else pass('title');
if (!/<meta\s+name="description"/i.test(head)) fail('meta description', '없음');
else pass('meta description');

// 스플래시(apple-touch-startup-image) 파일 존재 — 2026-11-16 404 수정 확인
const splash = [...head.matchAll(/<link\s+rel="apple-touch-startup-image"[^>]*href="([^"]+)"/g)].map(m => m[1]);
const missingSplash = splash.map(h => h.replace(/^\//, '')).filter(f => !exists(f));
if (splash.length && missingSplash.length) fail('iOS 스플래시 파일 존재', `404 대상: ${missingSplash.join(', ')}`);
else if (splash.length) pass('iOS 스플래시 파일 존재', `${splash.length}개`);
else fail('iOS 스플래시', 'apple-touch-startup-image 없음(홈 화면 앱 시작 화면)');

// 8) 껍데기 지문 (코드만 고치고 SW 버전을 안 올린 경우를 막는다)
const stampPath = 'tools/ci/shell-fingerprint.json';
if (!exists(stampPath)) fail('껍데기 지문', `${stampPath} 없음 — node tools/ci/stamp.mjs --init`);
else {
  const stamp = JSON.parse(read(stampPath));
  const fp = shellFingerprint(state.files);
  if (fp !== stamp.hash) fail('껍데기 지문', `파일 내용이 바뀌었습니다 → node tools/ci/stamp.mjs --bump (새 VERSION·?v= 로 갱신)`);
  else if (state.version !== stamp.version) fail('껍데기 버전', `SW ${state.version} ≠ 기록 ${stamp.version} → node tools/ci/stamp.mjs --bump`);
  else if (uniq.length === 1 && uniq[0] !== String(stamp.assetQuery)) fail('껍데기 자산 쿼리', `?v=${uniq[0]} ≠ 기록 ?v=${stamp.assetQuery}`);
  else pass('껍데기 지문', `${stamp.version} · ?v=${stamp.assetQuery} · ${fp}`);
}

// 9) .gitignore
const gi = exists('.gitignore') ? read('.gitignore') : '';
if (!/\.env/.test(gi)) fail('.gitignore', '.env 항목 없음');
else pass('.gitignore');

process.exit(ok ? 0 : 1);
