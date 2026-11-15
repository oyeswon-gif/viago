// viago-auth-firebase.js — VIAGO 앱의 저장 경로를 익명 로그인 + 초대(1회용·다회용) + 동시 편집 보호에 연결한다.
//
// 앱(index.html)은 지금까지 `createViagoSync({...})` 를 그대로 부르고, 반환값의
// fetchDoc / readRoom / saveWithMerge / saveResolved 만 사용한다. 이 파일은 **같은 이름**으로
// 그 자리를 대신 채워, 앱 본문(pushSharedState·pollShared·resolveSyncConflict·#syncConflict UI)을
// 한 줄도 고치지 않고 인증·초대·충돌 처리를 붙인다.
//
// 설정은 문서에 심어 둔 window.VIAGO_BUILD 에서 읽는다(build-migration.py 가 생성).
//   { firebaseApiKey, projectId, roomCode, (선택) firestoreBase·authBaseUrl·secureTokenBaseUrl }
//
// 동작:
//   1) 앱 시작 시 익명 로그인(이미 있으면 토큰 재사용/갱신)
//   2) 내 멤버 문서가 없으면 localStorage 의 초대 토큰으로 참여
//      · 다회용 초대(multiUse)는 초대를 소모하지 않고 멤버만 등록한다 — 같은 링크로 여러 기기가 참여한다
//      · 초대가 없으면 Error('no_invite') → 앱이 초대 복구 폼을 띄운다
//      · 초대가 만료·회수됐거나(1회용은) 이미 쓰였으면 Error('invite_unusable') → 같은 폼
//   3) 기기에 남은 저장 대기(pending)를 최신 원격과 병합해 반영(flushPending)
//      · 겹친 항목이 있으면 window.__VIAGO_PENDING__ 에 담아 앱의 #syncConflict 로 넘긴다
//   4) 이후 읽기/저장은 모두 멤버 토큰으로 나가고, 저장은 updateTime 사전 조건 + 3-way 병합
;(function () {
  'use strict';
  var B = window.VIAGO_BUILD || {};

  window.createViagoSync = function (c) {
    c = c || {};
    var cfg = c.config || {};
    var auth = createViagoAuthV3({
      config: {
        firebaseApiKey: B.firebaseApiKey || '',
        projectId: B.projectId || 'wedding-ring-app-810cd',
        roomCollection: cfg.roomCollection || 'viagoRooms',
        roomCode: cfg.roomCode || B.roomCode || '',
        updatedBy: '재원'
      },
      baseUrl: B.firestoreBase || undefined,
      authBaseUrl: B.authBaseUrl || undefined,
      secureTokenBaseUrl: B.secureTokenBaseUrl || undefined,
      storage: window.localStorage,
      mergeJourney: c.mergeJourney
    });

    var ready = null;
    function ensure() {
      if (ready) return ready;
      ready = (async function () {
        var member = false;
        try {
          member = await auth.amIMember();
        } catch (e) {
          // 네트워크가 없으면 참여 확인도 못 한다 → 앱은 로컬 보관본으로 열고 나중에 다시 시도한다.
          if (e && e.network) throw new Error('offline');
          member = false;
        }
        if (!member) {
          var tok = '';
          try { tok = window.localStorage.getItem('journey-note-invite') || ''; } catch (e) {}
          if (!tok) throw new Error('no_invite');
          // 인앱 브라우저(카카오톡 등)에서는 1회용 초대를 자동으로 소모하지 않는다.
          // 사파리·홈 화면 앱과 저장 공간이 달라서, 여기서 쓰면 그 초대는 다른 곳에서 다시 쓸 수 없고
          // 이 창을 다시 열면 새 익명 계정으로 보여 참여도 이어지지 않는다.
          // 앱은 이 오류를 받아 '사파리에서 열기' 안내를 띄우고, 사용자가 직접 고르면 보류를 풀고 참여한다.
          if (window.VIAGO_HOLD_INVITE) throw new Error('invite_held');
          await auth.joinWithInvite(tok);
        }
        try {
          window.__VIAGO_PENDING__ = await auth.flushPending();
        } catch (e) {
          window.__VIAGO_PENDING__ = { status: 'failed', reason: String(e && e.message || e) };
        }
        return true;
      })();
      // 실패한 준비 상태는 다음 호출에서 다시 시도할 수 있게 비운다(일시적 네트워크 오류 대비).
      ready.catch(function () { ready = null; });
      return ready;
    }

    return {
      fetchDoc: async function () {
        await ensure();
        var room = await auth.readRoom();
        if (!room) return { ok: false, status: 403, json: async function () { return {}; } };
        return { ok: true, status: 200, json: async function () { return room.raw; } };
      },
      readRoom: async function () { await ensure(); return auth.readRoom(); },
      saveWithMerge: async function (args) {
        try { await ensure(); }
        catch (e) {
          // 서버에 닿지 못하면 저장할 payload 를 기기에 남긴다(다음 실행에서 최신 원격과 병합).
          if (e && e.message === 'offline') { auth.writePending(args); return { status: 'offline' }; }
          throw e;
        }
        return auth.saveJourney(args);
      },
      saveResolved: async function (state, preferRemote) {
        await ensure();
        var r = await auth.saveResolved(state, preferRemote);
        return Object.assign({}, r, { ok: r.status === 'saved' });
      },
      // 여행에서 내 역할('owner'|'editor') — 초대 발급·여행 삭제 같은 소유자 기능의 근거.
      myRole: async function () { await ensure(); try { return await auth.myRole(); } catch (e) { return null; } },
      // 이 기기가 이미 여행 멤버인지(초대 게이트에서 '이미 참여한 기기'를 구분할 때 쓴다).
      amIMember: async function () { try { return await auth.amIMember(); } catch (e) { return false; } },
      // 초대 게이트에서 '탭 즉시' 참여를 시도한다. 이미 멤버면 그대로 성공 처리하고,
      // 아니면 초대로 참여한다(다회용 초대는 소모하지 않는다). 성공하면 준비된 상태(ready)를 유지해 바로 읽을 수 있게 한다.
      join: async function (token) {
        var member = await auth.amIMember().catch(function () { return false; });
        if (!member) await auth.joinWithInvite(token);
        ready = Promise.resolve(true);
        return true;
      },
      // 초대 발급(규칙이 허용할 때만 성공). 기본은 다회용 30일 초대다. 실패는 {ok:false,status} 로 그대로 돌려준다.
      createInvite: async function (opts) { await ensure(); return auth.createInvite(opts); },
      pendingState: function () { return window.__VIAGO_PENDING__; },
      // 앱이 쓰지는 않지만, 문제 진단 때 콘솔에서 확인할 수 있게 둔다.
      authState: function () { return { uid: auth.session && auth.session.uid, room: auth.roomCode }; }
    };
  };
})();
