# 이전용 최종 빌드 (2026-11-15)

`migration-candidate-2026-11-15` 브랜치의 `index.html` 은 **이번 Firebase 보안 이전에 그대로 올릴 빌드**입니다.
`main` 에는 아직 합치지 않았고, 배포(Pages)도 하지 않았습니다.

## 이 빌드가 바꾼 것 (5곳 + 설정)

| # | 위치 | 이전 상태 | 이 빌드 |
|---|---|---|---|
| 1 | `SHARED_ROOM_COLLECTION` / `SHARED_ROOM_CODE` | `weddingRingRooms` / `VIAGO-NAGOYA-2026` (누구나 읽고 씀) | `viagoRooms` / `v1-06e9cc03c400af45d41def7c87d05628` |
| 2 | `createViagoSync({...})` 호출 | 인증 없는 REST + 초대 토큰을 `Authorization` 에 넣던 헤더 | `viago-auth-firebase.js` (익명 로그인·1회용 초대·동시 편집 병합) |
| 3 | `pollShared` / `startSharedSync` 의 직접 `fetch` 2곳 | 누구나 읽을 수 있는 공개 문서 GET | `sharedSync.fetchDoc()` (멤버 토큰) |
| 4 | 시작 직후 | — | 남은 저장 대기(`__VIAGO_PENDING__`)가 충돌이면 기존 `#syncConflict` 대화상자로 넘김 |
| 5 | 문서 상단 | — | `window.VIAGO_BUILD` (웹 API 키·프로젝트·방 코드) |

앱 UI·일정 렌더링·지도·초대 복구 폼(`/viago/` 경로 허용)은 브랜치에 이미 들어 있던 그대로입니다.

## 파일

- `index.html` — 빌드 산출물(이전용). 이 커밋의 파일을 그대로 배포합니다.
- `viago-auth-client.js` — 인증·초대·동시 편집 클라이언트(검증된 v3 + 에뮬레이터용 base 옵션).
- `viago-auth-firebase.js` — 앱의 `createViagoSync` 자리를 대신 채우는 어댑터(앱 본문 무수정).
- `tools/build-migration.py` — 위 변환을 재현하는 스크립트(같은 스크립트로 검증용 산출물도 만든다).

## 재현

```bash
# 이전용 산출물 (이 커밋의 index.html 과 같은 결과)
git show preflight-2026-11-15:index.html > /tmp/base.html
python3 tools/build-migration.py --src /tmp/base.html --out /tmp/prod.html \
  --room v1-06e9cc03c400af45d41def7c87d05628 --api-key <Firebase 웹 API 키>

# 에뮬레이터 검증(Firestore+Auth) — viago-emulator 에서
bash run-migration-verify.sh      # 최종 51/51
```

검증 결과와 실기기 미검증 항목은 `viago-docs/migration-final-build-2026-11-15.md` 참고.
