#!/usr/bin/env python3
"""VIAGO 이전용 최종 빌드 생성기 (2026-11-15).

`index.html`(main 5083760 + 선행점검 패치 4종이 들어간 preflight-2026-11-15 상태)에
아래 5가지를 적용해 **실제 이전에 쓸 최종 빌드**를 만든다.

  1) 저장 위치: weddingRingRooms/VIAGO-NAGOYA-2026  →  viagoRooms/<새 방 코드>
  2) 생성자:   createViagoSync(...) → 인증·초대·동시편집 클라이언트(viago-auth-firebase.js)로 교체
  3) 읽기:     pollShared·startSharedSync 의 인증 없는 직접 fetch → sharedSync.fetchDoc()
  4) 재실행:   시작 직후 남은 저장 대기(pending)의 충돌을 기존 #syncConflict 대화상자로 넘긴다
  5) 설정:     window.VIAGO_BUILD (웹 API 키·프로젝트·방 코드·에뮬레이터 주소) 를 문서에 넣는다

같은 스크립트로 두 산출물을 만든다(코드 경로는 완전히 같고 설정 값만 다르다).
  · 이전용:  --room v1-… --api-key AIza…            (실제 Firebase)
  · 검증용:  --emulator                              (Firestore/Auth 에뮬레이터)

사용:
  python3 tools/build-migration.py --src index.html --out index.html \
      --room v1-06e9cc03c400af45d41def7c87d05628 --api-key AIzaSy…
  python3 tools/build-migration.py --src ../viago-repo/index.html --out /tmp/emu.html --emulator --room v1-test
"""
import argparse, hashlib, json, os, re, sys

PROD_COLLECTION = 'viagoRooms'
OLD_CONST = "const SHARED_ROOM_COLLECTION='weddingRingRooms',SHARED_ROOM_CODE='VIAGO-NAGOYA-2026';"
OLD_SYNC = ("const sharedSync=createViagoSync({config:{roomCollection:SHARED_ROOM_COLLECTION,"
            "roomCode:SHARED_ROOM_CODE},fetchImpl:apiFetch,mergeJourney:(b,l,r,p)=>mergeJourney(b,l,r,p)});")
OLD_SCRIPTS = '  <script src="./journey-sync.js"></script>\n  <script src="./viago-sync-v3.js"></script>'
RAW_READ = ("const res = await fetch('https://firestore.googleapis.com/v1/projects/wedding-ring-app-810cd/"
            "databases/(default)/documents/weddingRingRooms/VIAGO-NAGOYA-2026', {cache:'no-store'});")
PENDING_ANCHOR = ("        setupFreeEmbed();\n        sharedRevision = rev;\n"
                  "        sharedUpdateTime = doc.updateTime || null;\n        sharedReady = true;")


def build(src_html, room, api_key, project='wedding-ring-app-810cd', emulator=False, user='재원'):
    s = src_html
    got = {}

    # 1) 저장 위치
    assert OLD_CONST in s, '저장 위치 상수를 찾지 못했습니다'
    new_const = f"const SHARED_ROOM_COLLECTION='{PROD_COLLECTION}',SHARED_ROOM_CODE='{room}';"
    s = s.replace(OLD_CONST, new_const, 1)
    got['room'] = room

    # 2) 동기화 생성자 → 인증 클라이언트 (fetchImpl 제거: 초대 토큰을 Bearer 로 보내던 자리)
    assert OLD_SYNC in s, 'createViagoSync 호출부를 찾지 못했습니다'
    new_sync = ("const sharedSync=createViagoSync({config:{roomCollection:SHARED_ROOM_COLLECTION,"
                "roomCode:SHARED_ROOM_CODE},mergeJourney:(b,l,r,p)=>mergeJourney(b,l,r,p)});")
    s = s.replace(OLD_SYNC, new_sync, 1)

    # 3) 스크립트: viago-sync-v3.js(인증 없음) → viago-auth-client.js + viago-auth-firebase.js
    assert OLD_SCRIPTS in s, '스크립트 포함부를 찾지 못했습니다'
    s = s.replace(OLD_SCRIPTS,
                  '  <script src="./journey-sync.js"></script>\n'
                  '  <script src="./viago-auth-client.js"></script>\n'
                  '  <script src="./viago-auth-firebase.js"></script>', 1)

    # 4) 직접 fetch 2곳 → 인증된 읽기
    n = s.count(RAW_READ)
    assert n == 2, f'직접 fetch 가 2곳이 아니라 {n}곳입니다'
    s = s.replace(RAW_READ, 'const res = await sharedSync.fetchDoc();')

    # 5) 앱 재실행 시 남은 저장 대기 충돌 → 기존 대화상자
    assert PENDING_ANCHOR in s, 'sharedReady 삽입 지점을 찾지 못했습니다'
    s = s.replace(PENDING_ANCHOR, PENDING_ANCHOR +
                  "\n        if(window.__VIAGO_PENDING__&&window.__VIAGO_PENDING__.status==='conflict')"
                  "openSyncConflict(window.__VIAGO_PENDING__);", 1)

    # 6) 빌드 설정
    if emulator:
        cfg = {'projectId': 'demo-viago', 'firebaseApiKey': 'demo-key', 'roomCode': room,
               'firestoreBase': 'http://127.0.0.1:8080/v1/projects/demo-viago/databases/(default)/documents',
               'authBaseUrl': 'http://127.0.0.1:9099/identitytoolkit.googleapis.com',
               'secureTokenBaseUrl': 'http://127.0.0.1:9099/securetoken.googleapis.com'}
    else:
        cfg = {'projectId': project, 'firebaseApiKey': api_key, 'roomCode': room}
    cfg_js = '<script>window.VIAGO_BUILD=' + json.dumps(cfg, ensure_ascii=False, separators=(',', ':')) + ';</script>\n'
    assert '  <script src="./journey-sync.js"></script>' in s
    s = s.replace('  <script src="./journey-sync.js"></script>', cfg_js + '  <script src="./journey-sync.js"></script>', 1)

    # 빌드 표식
    marker = f'<!-- VIAGO migration build · room {room} · {"emulator" if emulator else "production"} · build-migration.py -->\n'
    s = marker + s
    got.update({'emulator': emulator, 'projectId': cfg['projectId']})
    return s, got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--room', default='v1-06e9cc03c400af45d41def7c87d05628')
    ap.add_argument('--api-key', default='AIzaSyAsuMM6ABQG8oGF06gSLj8-2w9NotH6Edg')
    ap.add_argument('--project', default='wedding-ring-app-810cd')
    ap.add_argument('--emulator', action='store_true')
    ap.add_argument('--manifest', default=None, help='파일 해시 목록을 쓸 경로(선택)')
    a = ap.parse_args()

    src = open(a.src, encoding='utf-8').read()
    out, info = build(src, a.room, a.api_key, a.project, a.emulator)
    open(a.out, 'w', encoding='utf-8').write(out)
    print(json.dumps({'out': a.out, 'bytes': len(out), **info,
                      'sha256': hashlib.sha256(out.encode()).hexdigest()}, ensure_ascii=False))
    if a.manifest:
        files = {}
        base = os.path.dirname(os.path.abspath(a.out))
        for name in ('index.html', 'viago-auth-client.js', 'viago-auth-firebase.js', 'journey-sync.js',
                     'viago-sync-v3.js', 'journey-preview.js', 'journey-install.js', 'journey-design.css',
                     'service-worker.js', 'manifest.webmanifest'):
            p = os.path.join(base, name)
            if os.path.exists(p) and os.path.basename(a.out) == 'index.html':
                files[name] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
        json.dump({'builtAt': None, 'room': a.room, 'emulator': a.emulator, 'files': files},
                  open(a.manifest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
