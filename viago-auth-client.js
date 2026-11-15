// viago-auth-client.js — VIAGO 인증 클라이언트 + 동시 편집 보호 (v3 기준, 이전용 최종 빌드에 포함)
// 배포본에서는 익명 로그인(identitytoolkit)과 토큰 갱신(securetoken)을 직접 호출한다.
// 에뮬레이터 검증용으로만 authBaseUrl·secureTokenBaseUrl 을 지정할 수 있다(기본값은 실제 서비스 주소).
// ─────────────────────────────────────────────────────────────
// v3-auth = v2(viago-auth-client.v2.js) 의 인증·참여 + viago-sync-v3.js 의 저장 보호를 한 파일로 합친 것.
//
//  · 인증/참여: 익명 로그인 → 초대로 멤버 등록 (1회용은 '초대 소진 + 멤버 등록'을 한 :commit 으로,
//      다회용(multiUse)은 초대를 건드리지 않고 멤버만 등록 — 같은 링크로 여러 기기가 참여한다)
//  · 저장: 일정 저장을 `:commit` + `updateMask` + `currentDocument.updateTime` 사전 조건으로 보낸다.
//      1) 두 기기가 같은 시점에 저장하면 먼저 보낸 한 건만 통과(409), 나머지는 덮어쓰지 않고 3-way 병합.
//      2) 겹치지 않은 변경(서로 다른 항목)은 대화상자 없이 자동 병합해 저장.
//      3) 같은 항목을 다르게 고쳤으면 저장하지 않고 conflict 를 돌려준다 → 앱은 #syncConflict 로 물어본다.
//      4) 오프라인·앱 종료로 저장하지 못한 payload 는 localStorage 에 pending 으로 남기고,
//         다음 실행에서 최신 원격과 병합해 반영한다(오래된 기기가 최신 일정을 덮어쓰지 않는다).
//
// 의존성 없음(fetch·localStorage 만). 브라우저에서는 window.createViagoAuthV3, 테스트에서는 require.

const VIAGO_V3_DEFAULT_CONFIG = {
  firebaseApiKey: (typeof window !== 'undefined' && window.VIAGO_FIREBASE_API_KEY) || '',
  projectId: 'wedding-ring-app-810cd',
  roomCollection: 'viagoRooms',
  roomCode: (typeof window !== 'undefined' && window.VIAGO_ROOM_CODE) || '',
  storageKey: 'viago.auth.v3',
  updatedBy: '재원'
};

// journey-sync.js 의 mergeJourney 와 같은 규칙의 순수 3-way 병합(파일 자체에 포함해 단독 동작).
function mergeJourney(base, local, remote, preferRemote = false) {
  const conflicts = []; const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function merge(b, l, r, path) {
    if (eq(l, r)) return l; if (eq(l, b)) return r; if (eq(r, b)) return l;
    if (Array.isArray(l) && Array.isArray(r) && Array.isArray(b) && [...b, ...l, ...r].every(x => x && typeof x === 'object' && x.id)) {
      const bm = new Map(b.map(x => [x.id, x])), lm = new Map(l.map(x => [x.id, x])), rm = new Map(r.map(x => [x.id, x]));
      const reordered = !eq(l.filter(x => bm.has(x.id)).map(x => x.id), b.filter(x => lm.has(x.id)).map(x => x.id));
      const remoteReordered = !eq(r.filter(x => bm.has(x.id)).map(x => x.id), b.filter(x => rm.has(x.id)).map(x => x.id));
      if (reordered && remoteReordered && !eq(l.map(x => x.id), r.map(x => x.id))) conflicts.push(path + ' / 순서');
      const order = (reordered && !preferRemote ? [...l, ...r, ...b] : [...r, ...l, ...b]).map(x => x.id), seen = new Set(), out = [];
      for (const id of order) { if (seen.has(id)) continue; seen.add(id); const value = merge(bm.get(id), lm.get(id), rm.get(id), path + '/' + id); if (value !== undefined) out.push(value) } return out;
    }
    if (b && l && r && !Array.isArray(l) && !Array.isArray(r) && typeof b === 'object' && typeof l === 'object' && typeof r === 'object') {
      const out = {}; for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) { if (['__proto__', 'constructor', 'prototype'].includes(k)) continue; const v = merge(b[k], l[k], r[k], path + '/' + k); if (v !== undefined) out[k] = v } return out;
    }
    conflicts.push(path); return preferRemote ? r : l;
  }
  return { payload: merge(base, local, remote, '일정'), conflicts };
}

function viagoV3DocName(projectId, path) { return `projects/${projectId}/databases/(default)/documents/${path}`; }

// ── 세션 쿠키(iOS 사파리 → 홈 화면 추가) ────────────────────────────────
// 아이폰 '홈 화면에 추가'한 웹 앱은 사파리와 저장 공간이 분리되어 localStorage 가 복사되지 않는다.
// WebKit 은 iOS 17.2 부터 **쿠키만** 복사한다(document.cookie 로 심은 1st-party 쿠키 중
// Secure·SameSite=Lax·path 가 있는 것 — WebKit 'Safari 17.2' 릴리스 노트).
// 그래서 로그인(익명 세션)을 localStorage 와 함께 쿠키에도 남긴다.
//   · 사파리에서 초대를 받아 참여 → 쿠키에 세션이 심김
//   · 공유 → 홈 화면에 추가 → 앱이 그 쿠키를 물려받아 **같은 uid = 이미 멤버**로 시작
// 1회용 초대를 다시 쓰지 않고도 새 기기(앱)가 이어지고, 규칙·권한은 그대로다.
// 값은 갱신 토큰만 담는다(idToken 은 크고 수명이 짧다) — 앱이 시작할 때 갱신한다.
const VIAGO_SESSION_COOKIE = 'viago_session_v1';
const VIAGO_SESSION_COOKIE_DAYS = 30;
function viagoCookiePath() {
  if (typeof location === 'undefined' || !location.pathname) return '/viago/';
  const first = location.pathname.split('/').filter(Boolean)[0];
  return first ? '/' + first + '/' : '/';
}
function readViagoSessionCookie() {
  if (typeof document === 'undefined' || !document.cookie) return null;
  try {
    const prefix = VIAGO_SESSION_COOKIE + '=';
    const raw = document.cookie.split(';').map(s => s.trim()).find(s => s.indexOf(prefix) === 0);
    if (!raw) return null;
    const data = JSON.parse(decodeURIComponent(raw.slice(prefix.length)));
    if (!data || !data.u || !data.r) return null;
    return { uid: String(data.u), refreshToken: String(data.r), expiresAt: Number(data.e) || 0 };
  } catch (e) { return null }
}
function writeViagoSessionCookie(s) {
  if (typeof document === 'undefined' || !s || !s.uid || !s.refreshToken || s.external) return false;
  try {
    const value = encodeURIComponent(JSON.stringify({ u: s.uid, r: s.refreshToken, e: s.expiresAt || 0 }));
    const secure = (typeof location !== 'undefined' && location.protocol === 'https:') ? '; Secure' : '';
    document.cookie = `${VIAGO_SESSION_COOKIE}=${value}; path=${viagoCookiePath()}; max-age=${VIAGO_SESSION_COOKIE_DAYS * 86400}; SameSite=Lax${secure}`;
    return true;
  } catch (e) { return false }
}
function clearViagoSessionCookie() {
  if (typeof document === 'undefined') return;
  try { document.cookie = `${VIAGO_SESSION_COOKIE}=; path=${viagoCookiePath()}; max-age=0; SameSite=Lax`; } catch (e) {}
}

function createViagoAuthV3(opts) {
  const o = opts || {};
  const cfg = Object.assign({}, VIAGO_V3_DEFAULT_CONFIG, o.config || {});
  const f = o.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  const store = o.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const base = o.baseUrl || `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
  const authBase = o.authBaseUrl || 'https://identitytoolkit.googleapis.com';
  const tokenBase = o.secureTokenBaseUrl || 'https://securetoken.googleapis.com';
  const projectInBase = /\/projects\/([^/]+)\//.exec(base);
  if (projectInBase) cfg.projectId = projectInBase[1];
  const merge = o.mergeJourney || mergeJourney;
  const pendingKey = cfg.storageKey + '.pending';
  let session = null;
  let cookieSynced = false;

  async function f_(url, init) {
    try { return await f(url, init) }
    catch (e) { const err = new Error('offline'); err.network = true; err.cause = e; throw err }
  }

  // ── 인증 ─────────────────────────────────────────────
  function load() {
    if (store) { try { session = JSON.parse(store.getItem(cfg.storageKey) || 'null') } catch (e) { session = null } }
    // 홈 화면 앱: 사파리에서 '홈 화면에 추가'할 때 복사된 세션 쿠키로 이어받는다.
    //   · 쿠키에는 uid·갱신 토큰만 있다(idToken 은 없다). 그대로 쓰면 idToken 이 비어
    //     `Authorization: Bearer undefined` 로 나가 **모든 요청이 401** 이 된다
    //     → 멤버 확인·초대 읽기가 실패해 '만료/회수된 초대'처럼 보였다.
    //     그래서 idToken 이 없거나, 저장된 세션에 갱신 토큰이 없으면 쿠키 세션을 쓴다.
    const inherited = readViagoSessionCookie();
    if (!session || !session.uid || !session.refreshToken) {
      if (inherited) { save(inherited); return session }
    }
    // 세션이 있으면 쿠키도 최신으로 유지한다(다음 '홈 화면에 추가'가 이어받을 수 있게).
    if (session && !cookieSynced) { cookieSynced = true; writeViagoSessionCookie(session) }
    return session
  }
  function save(s) {
    session = s;
    if (store) { try { store.setItem(cfg.storageKey, JSON.stringify(s)) } catch (e) {} }
    if (s && !s.external) { cookieSynced = true; writeViagoSessionCookie(s) }
  }
  function decodeJwt(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) } catch (e) { return {} } }
  async function signInAnonymously() {
    const res = await f_(`${authBase}/v1/accounts:signUp?key=${encodeURIComponent(cfg.firebaseApiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
    });
    if (!res.ok) throw new Error('auth_failed');
    const d = await res.json(), p = decodeJwt(d.idToken);
    const s = { idToken: d.idToken, refreshToken: d.refreshToken, uid: d.localId, expiresAt: (p.exp || 0) * 1000 };
    save(s); return s;
  }
  async function refreshIfNeeded() {
    if (o.getIdToken) {
      const idToken = await o.getIdToken(), p = decodeJwt(idToken);
      session = { idToken, uid: (o.uidProvider && o.uidProvider()) || p.user_id || p.sub, expiresAt: (p.exp || 0) * 1000, external: true };
      return session;
    }
    if (!session) load();
    if (!session) return signInAnonymously();
    // idToken 이 없으면(쿠키에서 이어받은 세션) 만료 시각과 무관하게 갱신한다.
    if (session.idToken && Date.now() < session.expiresAt - 5 * 60 * 1000) return session;
    if (!session.refreshToken) return signInAnonymously();
    const res = await f_(`${tokenBase}/v1/token?key=${encodeURIComponent(cfg.firebaseApiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`
    });
    if (!res.ok) return signInAnonymously();
    const d = await res.json();
    const s = { idToken: d.id_token, refreshToken: d.refresh_token, uid: d.user_id, expiresAt: (decodeJwt(d.id_token).exp || 0) * 1000 };
    save(s); return s;
  }
  async function uid() { return (await refreshIfNeeded()).uid }
  async function authedFetch(path, options) {
    const opt = options || {};
    const send = (idToken) => f_(base + path, Object.assign({}, opt, {
      headers: Object.assign({}, opt.headers || {}, { Authorization: `Bearer ${idToken}` })
    }));
    let s = await refreshIfNeeded();
    const res = await send(s.idToken);
    if (res.status !== 401) return res;
    // 서버가 토큰을 거부했다(만료·기기 시계 오차·옛 세션). 이대로 두면 초대 읽기·멤버 확인이
    // 전부 401 이 되어 '만료된 초대'처럼 보인다 → 세션을 새로 만들고 한 번만 다시 보낸다.
    session = null; cookieSynced = false;
    try { if (store) store.removeItem(cfg.storageKey) } catch (e) {}
    clearViagoSessionCookie();
    s = await signInAnonymously();
    return send(s.idToken);
  }

  // ── 초대 참여(원자적): 초대 소진 + 멤버 등록을 한 커밋으로 ──
  async function joinWithInvite(token) {
    const me = await uid();
    let inviteDoc = null;
    const read = await authedFetch(`/viagoInvites/${encodeURIComponent(token)}`);
    if (read.ok) inviteDoc = await read.json();
    if (!inviteDoc) {
      // 없는 코드(잘렸거나 다른 여행의 코드)는 '만료·회수'와 구분해 알려 준다.
      if (read.status === 404) throw new Error('invite_not_found');
      const roomId = cfg.roomCode;
      if (roomId) {
        const memberTry = await authedFetch(`/${cfg.roomCollection}/${encodeURIComponent(roomId)}/members/${me}?currentDocument.exists=false`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { role: { stringValue: 'editor' }, invite: { stringValue: token }, joinedAt: { timestampValue: new Date().toISOString() } } })
        });
        if (memberTry.ok) { cfg.roomCode = roomId; return roomId }
      }
      throw new Error('invite_unusable');
    }
    const fields = inviteDoc.fields || {};
    const roomId = (fields.roomId && fields.roomId.stringValue) || cfg.roomCode;
    const role = (fields.role && fields.role.stringValue) || 'editor';
    if (!roomId) throw new Error('invite_unusable');
    const now = new Date().toISOString();
    const multiUse = !!(fields.multiUse && fields.multiUse.booleanValue === true);
    // 이미 다른 기기가 쓴 1회용 초대 — 쓰기를 시도하지 않고 이유를 정확히 알려 준다(게이트 문구 분기).
    const usedBy = (fields.usedBy && fields.usedBy.stringValue) || '';
    if (!multiUse && usedBy && usedBy !== me) throw new Error('invite_taken');
    // 다회용 초대: 초대 문서를 소모시키지 않고 내 멤버 문서만 만든다.
    //   같은 링크로 사파리·홈 화면 앱·다른 사람 기기·재설치한 기기가 각각 참여할 수 있다.
    if (multiUse) {
      const makeMember = await authedFetch(':commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [
            { update: { name: viagoV3DocName(cfg.projectId, `${cfg.roomCollection}/${roomId}/members/${me}`), fields: { role: { stringValue: role }, invite: { stringValue: token }, joinedAt: { timestampValue: now } } }, currentDocument: { exists: false } }
          ]
        })
      });
      if (makeMember.ok) { cfg.roomCode = roomId; return roomId }
      // 이미 이 기기(uid)가 멤버면 재접속으로 본다 — 규칙상 멤버 문서는 덮어쓸 수 없으므로 오류가 날 수 있다.
      if (makeMember.status === 409 || makeMember.status === 403) {
        const mine = await authedFetch(`/${cfg.roomCollection}/${encodeURIComponent(roomId)}/members/${me}`);
        if (mine.ok) { cfg.roomCode = roomId; return roomId }
        throw new Error(makeMember.status === 409 ? 'invite_taken' : 'join_denied');
      }
      throw new Error('join_failed');
    }
    const commit = await authedFetch(':commit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          { update: { name: viagoV3DocName(cfg.projectId, `viagoInvites/${token}`), fields: { usedBy: { stringValue: me }, usedAt: { timestampValue: now } } }, updateMask: { fieldPaths: ['usedBy', 'usedAt'] }, currentDocument: { updateTime: inviteDoc.updateTime } },
          { update: { name: viagoV3DocName(cfg.projectId, `${cfg.roomCollection}/${roomId}/members/${me}`), fields: { role: { stringValue: role }, invite: { stringValue: token }, joinedAt: { timestampValue: now } } }, currentDocument: { exists: false } }
        ]
      })
    });
    if (commit.ok) { cfg.roomCode = roomId; return roomId }
    if (commit.status === 409 || commit.status === 403) {
      const mine = await authedFetch(`/${cfg.roomCollection}/${encodeURIComponent(roomId)}/members/${me}`);
      if (mine.ok) { cfg.roomCode = roomId; return roomId }
      throw new Error(commit.status === 409 ? 'invite_taken' : 'join_denied');
    }
    throw new Error('join_failed');
  }
  async function amIMember(roomId) {
    const rid = roomId || cfg.roomCode;
    if (!rid) return false;
    const me = await uid();
    const res = await authedFetch(`/${cfg.roomCollection}/${encodeURIComponent(rid)}/members/${me}`);
    return res.ok;
  }

  // ── 역할 · 초대 발급 ──────────────────────────────────
  // 규칙상 초대 문서 생성은 관리자(콘솔)만 가능하다. 아래 createInvite 는 그 권한이 열려 있는
  // 구성(= 소유자에게 viagoInvites create 를 허용하는 규칙)에서만 성공하고, 아니면 403 을 그대로 돌려준다.
  async function myRole(roomId) {
    const rid = roomId || cfg.roomCode;
    if (!rid || !session) return null;
    try {
      const res = await authedFetch(`/${cfg.roomCollection}/${encodeURIComponent(rid)}/members/${session.uid}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const doc = await res.json();
      return (doc.fields && doc.fields.role && doc.fields.role.stringValue) || null;
    } catch (e) {
      if (e.network) throw e;
      return null;
    }
  }

  function randomToken() {
    const bytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  // 성공: {ok:true, token, expiresAt, multiUse} · 실패: {ok:false, status, reason}
  // 기본은 다회용(같은 링크로 여러 기기·재설치가 참여) 30일 초대다.
  async function createInvite(opts) {
    const o = opts || {};
    const rid = o.roomId || cfg.roomCode;
    if (!rid) return { ok: false, reason: 'no_room' };
    const token = randomToken();
    const days = Math.min(Math.max(Number(o.expiresInDays) || 30, 1), 30);
    // 규칙은 만료를 '지금 + 30일' 미만으로만 허용한다 → 기기 시계와 서버 시계 차이를 두고 5분 짧게 잡는다.
    const expiresAt = new Date(Date.now() + days * 86400000 - 5 * 60000).toISOString();
    const multiUse = o.multiUse !== false;
    const fields = {
      roomId: { stringValue: rid },
      role: { stringValue: o.role || 'editor' },
      expiresAt: { timestampValue: expiresAt },
      revoked: { booleanValue: false }
    };
    if (multiUse) fields.multiUse = { booleanValue: true };
    const write = {
      update: {
        name: viagoV3DocName(cfg.projectId, `viagoInvites/${token}`),
        fields: fields
      },
      currentDocument: { exists: false }
    };
    let res;
    try {
      res = await authedFetch(':commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [write] }) });
    } catch (e) {
      return { ok: false, reason: e.network ? 'offline' : 'network' };
    }
    if (res.ok) return { ok: true, token, expiresAt, roomId: rid, multiUse: multiUse };
    return { ok: false, status: res.status, reason: res.status === 403 ? 'denied' : 'error' };
  }

  // ── 읽기 ─────────────────────────────────────────────
  // { payload, revision, updateTime, raw } | null
  async function readRoom(roomId) {
    const rid = roomId || cfg.roomCode;
    if (!rid) return null;
    const res = await authedFetch(`/${cfg.roomCollection}/${encodeURIComponent(rid)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const doc = await res.json(), fields = doc.fields || {};
    let payload = null;
    try { payload = JSON.parse(fields.payload?.stringValue || 'null') } catch (e) { payload = null }
    return { payload, revision: parseInt(fields.revision?.integerValue || '0', 10), updateTime: doc.updateTime, fields, raw: doc };
  }

  // ── 저장(사전 조건 포함) ──────────────────────────────
  // { ok:true, updateTime, revision } | { ok:false, reason:'conflict'|'precondition'|'denied'|'offline'|'error' }
  async function saveRoom(args) {
    const rid = args.roomId || cfg.roomCode;
    const fields = {
      payload: { stringValue: JSON.stringify(args.payload) },
      revision: { integerValue: String(Number(args.revision)) },
      updatedAt: { timestampValue: new Date().toISOString() },
      updatedBy: { stringValue: args.updatedBy || cfg.updatedBy }
    };
    const write = { update: { name: viagoV3DocName(cfg.projectId, `${cfg.roomCollection}/${rid}`), fields }, updateMask: { fieldPaths: ['payload', 'revision', 'updatedAt', 'updatedBy'] } };
    if (args.expectedUpdateTime) write.currentDocument = { updateTime: args.expectedUpdateTime };
    let res;
    try {
      res = await authedFetch(':commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [write] }) });
    } catch (e) {
      if (e.network) return { ok: false, reason: 'offline' };
      return { ok: false, reason: 'error', text: String(e && e.message) };
    }
    if (res.ok) {
      const body = await res.json();
      return { ok: true, updateTime: body.writeResults?.[0]?.updateTime || body.commitTime || null, revision: Number(args.revision) };
    }
    const text = await res.text().catch(() => '');
    if (res.status === 403) return { ok: false, reason: 'denied', status: 403, text };
    if (res.status === 409) return { ok: false, reason: 'conflict', status: 409, text };
    if (res.status === 400 && /FAILED_PRECONDITION|precondition/i.test(text)) return { ok: false, reason: 'precondition', status: 400, text };
    return { ok: false, reason: 'error', status: res.status, text };
  }

  // ── 저장 + 병합 (앱이 부르는 한 덩어리) ─────────────────
  // base: 마지막으로 확인한 공유본, payload: 지금 화면의 일정
  async function saveJourney(args) {
    const expected = args.expectedUpdateTime || args.remoteUpdateTime || null;
    const first = await saveRoom(Object.assign({}, args, { expectedUpdateTime: expected }));
    if (first.ok) { clearPending(); return { status: 'saved', ...first } }
    if (first.reason === 'offline') { writePending(args); return { status: 'offline' } }
    if (first.reason === 'denied' || first.reason === 'error') return { status: 'failed', ...first };

    const current = await readRoom(args.roomId);
    if (!current) return { status: 'failed', reason: 'reread_failed' };
    const merged = merge(args.base || { trips: [] }, args.payload, current.payload || { trips: [] }, false);
    if (merged.conflicts && merged.conflicts.length) {
      return { status: 'conflict', base: args.base || { trips: [] }, local: args.payload, remote: current.payload, merge: merged, paths: merged.conflicts, remoteUpdateTime: current.updateTime, remoteRevision: current.revision };
    }
    const second = await saveRoom(Object.assign({}, args, { payload: merged.payload, revision: current.revision + 1, expectedUpdateTime: current.updateTime }));
    if (second.ok) { clearPending(); return { status: 'merged', ...second, merged: merged.payload } }
    if (second.reason === 'offline') { writePending(args); return { status: 'offline' } }
    if (second.reason === 'conflict' || second.reason === 'precondition') {
      const again = await readRoom(args.roomId);
      const remote = again ? again.payload : current.payload;
      const m2 = merge(args.base || { trips: [] }, args.payload, remote || { trips: [] }, false);
      if (!m2.conflicts.length) {   // 그 사이 또 바뀌었지만 겹치지 않으면 한 번 더 병합 저장
        const third = await saveRoom(Object.assign({}, args, { payload: m2.payload, revision: (again || current).revision + 1, expectedUpdateTime: (again || current).updateTime }));
        if (third.ok) { clearPending(); return { status: 'merged', ...third, merged: m2.payload } }
        if (third.reason === 'offline') { writePending(args); return { status: 'offline' } }
      }
      return { status: 'conflict', base: args.base || { trips: [] }, local: args.payload, remote, merge: m2, paths: m2.conflicts, remoteUpdateTime: (again || current).updateTime, remoteRevision: (again || current).revision };
    }
    return { status: 'failed', ...second };
  }

  // 사용자가 #syncConflict 에서 고른 뒤 저장 (preferRemote=true 면 겹친 항목은 상대 것)
  async function saveResolved(conflict, preferRemote) {
    const result = merge(conflict.base, conflict.local, conflict.remote, !!preferRemote);
    const out = await saveRoom({ payload: result.payload, revision: (conflict.remoteRevision || 0) + 1, expectedUpdateTime: conflict.remoteUpdateTime });
    if (out.ok) clearPending();
    return { ...out, status: out.ok ? 'saved' : out.reason, payload: result.payload, paths: result.conflicts };
  }

  // ── 오프라인 pending (앱 재실행 복구) ───────────────────
  function writePending(args) {
    if (!store) return;
    try {
      store.setItem(pendingKey, JSON.stringify({
        payload: args.payload,
        base: args.base || null,
        savedAt: new Date().toISOString(),
        expectedUpdateTime: args.expectedUpdateTime || args.remoteUpdateTime || null
      }));
    } catch (e) {}
  }
  function readPending() {
    if (!store) return null;
    try { return JSON.parse(store.getItem(pendingKey) || 'null') } catch (e) { return null }
  }
  function clearPending() { if (store) { try { store.removeItem(pendingKey) } catch (e) {} } }

  // 앱 시작 시: 남아 있는 pending 을 최신 원격과 병합해 저장. 실패하면 pending 을 그대로 둔다.
  async function flushPending(roomId) {
    const pending = readPending();
    if (!pending) return { status: 'none' };
    const current = await readRoom(roomId);
    if (!current) return { status: 'failed', reason: 'reread_failed' };
    const merged = merge(pending.base || { trips: [] }, pending.payload, current.payload || { trips: [] }, false);
    if (merged.conflicts.length) {
      return { status: 'conflict', base: pending.base || { trips: [] }, local: pending.payload, remote: current.payload, merge: merged, paths: merged.conflicts, remoteUpdateTime: current.updateTime, remoteRevision: current.revision, pendingAt: pending.savedAt };
    }
    const out = await saveRoom({ roomId, payload: merged.payload, revision: current.revision + 1, expectedUpdateTime: current.updateTime });
    if (out.ok) { clearPending(); return { status: 'flushed', ...out } }
    if (out.reason === 'offline') return { status: 'offline' };
    return { status: 'failed', ...out };
  }

  return {
    config: cfg, mergeJourney: merge,
    load, signInAnonymously, refreshIfNeeded, uid,
    joinWithInvite, amIMember, myRole, createInvite, readRoom, saveRoom, saveJourney, saveResolved,
    readPending, writePending, clearPending, flushPending,
    // 진단용: 홈 화면 앱이 사파리의 세션 쿠키를 물려받았는지 확인할 때 쓴다(쓰기는 하지 않는다).
    readSessionCookie: function () { return readViagoSessionCookie() },
    writeSessionCookie: function () { return writeViagoSessionCookie(session) },
    clearSessionCookie: function () { clearViagoSessionCookie() },
    get session() { return session },
    get roomCode() { return cfg.roomCode },
    setRoomCode(id) { cfg.roomCode = id }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createViagoAuthV3, mergeJourney, VIAGO_V3_DEFAULT_CONFIG };
if (typeof window !== 'undefined') window.createViagoAuthV3 = createViagoAuthV3;
