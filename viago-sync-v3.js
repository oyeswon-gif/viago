// viago-sync-v3.js — VIAGO 일정 저장에 "낙관적 동시성 제어 + 3-way 병합"을 붙이는 참고 구현 (배포 전)
// ─────────────────────────────────────────────────────────────
// v2(viago-auth-client.v2.js)와의 차이:
//   1) 일정 저장을 `:commit` 배치 + `currentDocument.updateTime` 사전 조건으로 보낸다.
//      → 두 사람이 같은 시점에 저장하면 먼저 보낸 한 건만 통과하고, 나머지는 409(FAILED_PRECONDITION)로 떨어진다.
//      → v2는 updateMask만 걸어서 "마지막 쓰기 승리"(한쪽 변경 소실)였다.
//   2) 409를 만나면 덮어쓰지 않고 새로 읽어 3-way 병합(base/loc/remote)을 만든 뒤,
//      겹친 항목이 있으면 호출자(앱)가 #syncConflict 대화상자로 사용자 선택을 받도록 conflict 정보를 돌려준다.
//   3) 읽기·쓰기 응답의 updateTime을 항상 함께 돌려준다(다음 저장의 사전 조건).
//
// 의존성 없음(fetch만). 브라우저에서는 window.createViagoSync 로, 테스트에서는 require 로 쓴다.
// 실제 적용 시에는 이 파일을 index.html 안의 pushSharedState/pollShared 에 연결한다
// (연결 예시: viago-docs/ring-separation/index-conflict-patch.md).

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.createViagoSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // journey-sync.js 의 mergeJourney 와 같은 규칙(순수 3-way). 테스트에서 주입할 수 있게 옵션으로 받는다.
  function defaultMergeJourney(base, local, remote, preferRemote) {
    if (typeof mergeJourney === 'function') return mergeJourney(base, local, remote, preferRemote);
    throw new Error('mergeJourney_missing');
  }

  function createViagoSync(opts) {
    const o = opts || {};
    const cfg = Object.assign({
      projectId: 'wedding-ring-app-810cd',
      roomCollection: 'viagoRooms',
      roomCode: '',
      updatedBy: '재원'
    }, o.config || {});
    const f = o.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    const base = o.baseUrl || `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
    // baseUrl 을 주입한 경우(에뮬레이터 등) 문서 이름도 그 프로젝트를 따라간다.
    const projectMatch = /\/projects\/([^/]+)\//.exec(base);
    if (projectMatch) cfg.projectId = projectMatch[1];
    const merge = o.mergeJourney || defaultMergeJourney;
    const docName = (path) => `projects/${cfg.projectId}/databases/(default)/documents/${path}`;

    let roomId = cfg.roomCode;
    let lastUpdateTime = null;   // 마지막으로 읽거나 쓴 문서의 updateTime (사전 조건)

    async function headers() {
      const h = { 'Content-Type': 'application/json' };
      if (o.getIdToken) h.Authorization = 'Bearer ' + (await o.getIdToken());
      else if (o.authToken) h.Authorization = 'Bearer ' + o.authToken;
      return h;
    }

    // ── 읽기 ────────────────────────────────────────────────
    // 반환: { payload, revision, updateTime, fields, raw } 또는 null(권한 없음/없는 문서)
    async function readRoom(id) {
      const rid = id || roomId;
      const res = await f(`${base}/${cfg.roomCollection}/${encodeURIComponent(rid)}`, { headers: await headers(), cache: 'no-store' });
      if (!res.ok) return null;
      const doc = await res.json();
      const fields = doc.fields || {};
      const payload = JSON.parse(fields.payload?.stringValue || '{}');
      const revision = parseInt(fields.revision?.integerValue || '0', 10);
      lastUpdateTime = doc.updateTime;
      return { payload, revision, updateTime: doc.updateTime, fields, raw: doc };
    }

    // ── 저장 (사전 조건 포함) ────────────────────────────────
    // 반환: { ok:true, updateTime, revision } | { ok:false, reason:'conflict', current } | { ok:false, reason:'denied'|'error'|'precondition' }
    async function saveRoom(args) {
      const rid = args.roomId || roomId;
      const expected = args.expectedUpdateTime || lastUpdateTime;
      const revision = Number(args.revision);
      const payloadStr = JSON.stringify(args.payload);
      const fields = {
        payload: { stringValue: payloadStr },
        revision: { integerValue: String(revision) },
        updatedAt: { timestampValue: new Date().toISOString() },
        updatedBy: { stringValue: args.updatedBy || cfg.updatedBy }
      };
      const write = {
        update: { name: docName(`${cfg.roomCollection}/${rid}`), fields },
        updateMask: { fieldPaths: ['payload', 'revision', 'updatedAt', 'updatedBy'] }
      };
      // 사전 조건: 내가 읽은 그 버전일 때만 쓴다. 없으면(최초 생성 직후 등) 조건 없이 보낸다.
      if (expected) write.currentDocument = { updateTime: expected };

      const res = await f(`${base}:commit`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ writes: [write] })
      });

      if (res.ok) {
        const body = await res.json();
        const ut = body.writeResults?.[0]?.updateTime || body.commitTime || null;
        lastUpdateTime = ut;
        return { ok: true, updateTime: ut, revision };
      }
      const text = await res.text().catch(() => '');
      if (res.status === 403) return { ok: false, reason: 'denied', status: 403, text };
      if (res.status === 409) return { ok: false, reason: 'conflict', status: 409, text };
      if (res.status === 400 && /FAILED_PRECONDITION|precondition/i.test(text)) return { ok: false, reason: 'precondition', status: 400, text };
      return { ok: false, reason: 'error', status: res.status, text };
    }

    // ── 저장 + 충돌 처리 (앱이 부르는 한 덩어리) ──────────────
    // base: 마지막으로 "내가 확인한" 공유본, local: 지금 화면의 일정
    // 겹친 변경이 있으면 conflict:{base,local,remote,merge,paths} 를 돌려주고 저장하지 않는다.
    // 겹친 변경이 없으면(서로 다른 항목 수정) 자동으로 병합해 저장한다.
    async function saveWithMerge(args) {
      const first = await saveRoom(args);
      if (first.ok) return { status: 'saved', ...first };

      if (first.reason !== 'conflict' && first.reason !== 'precondition') return { status: 'failed', ...first };

      // 충돌: 최신 원격을 다시 읽고 3-way 병합
      const current = await readRoom(args.roomId);
      if (!current) return { status: 'failed', reason: 'reread_failed' };
      const merged = merge(args.base || { trips: [] }, args.payload, current.payload, false);
      if (merged.conflicts && merged.conflicts.length) {
        return { status: 'conflict', base: args.base || { trips: [] }, local: args.payload, remote: current.payload, merge: merged, paths: merged.conflicts, remoteUpdateTime: current.updateTime, remoteRevision: current.revision };
      }
      // 겹친 항목이 없으면 병합본을 최신 updateTime 조건으로 바로 저장
      const second = await saveRoom(Object.assign({}, args, {
        payload: merged.payload,
        revision: current.revision + 1,
        expectedUpdateTime: current.updateTime
      }));
      if (second.ok) return { status: 'merged', ...second, merged: merged.payload };
      if (second.reason === 'conflict' || second.reason === 'precondition') {
        const again = await readRoom(args.roomId);
        const m2 = merge(args.base || { trips: [] }, args.payload, again ? again.payload : current.payload, false);
        return { status: 'conflict', base: args.base || { trips: [] }, local: args.payload, remote: again ? again.payload : current.payload, merge: m2, paths: m2.conflicts, remoteUpdateTime: again ? again.updateTime : current.updateTime, remoteRevision: again ? again.revision : current.revision };
      }
      return { status: 'failed', ...second };
    }

    // 사용자가 대화상자에서 고른 뒤 저장 (preferRemote=true 면 겹친 항목은 상대 것)
    async function saveResolved(conflict, preferRemote) {
      const result = merge(conflict.base, conflict.local, conflict.remote, !!preferRemote);
      const out = await saveRoom({
        payload: result.payload,
        revision: (conflict.remoteRevision || 0) + 1,
        expectedUpdateTime: conflict.remoteUpdateTime
      });
      return { ...out, payload: result.payload };
    }

    return {
      config: cfg, readRoom, saveRoom, saveWithMerge, saveResolved,
      get lastUpdateTime() { return lastUpdateTime; },
      setRoomId(id) { roomId = id; },
      resetPrecondition() { lastUpdateTime = null; }
    };
  }

  return createViagoSync;
});
