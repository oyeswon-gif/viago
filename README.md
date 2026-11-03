# viago (여행노트) ✈️

> **재원 & 주희(묵블리)의 나고야 3박 4일 커플 여행 일정 & 실시간 동기화 PWA 앱**

---

## 🌟 핵심 기능
- **실시간 일정 동기화 (Google Firebase Firestore)**: 재원 님과 주희 님의 일정 수정, 추가, 장소 투표가 실시간으로 안전하게 동기화됩니다.
- **오프라인 캐싱 (PWA Standalone)**: 일본 현지에서 지하철이나 데이터가 터지지 않아도 저장된 일정과 메모를 100% 오프라인으로 열람할 수 있습니다.
- **iOS 네이티브 터치 최적화 (흔들림 방지)**:
  - Safari 고무줄 꿀렁임(Rubber-banding) 차단 (`overscroll-behavior: none`)
  - 더블탭 줌 딜레이 제거 및 즉시 탭 반응 (`touch-action: manipulation`)
  - 탭 하이라이트 번쩍임 및 텍스트 드래그 방지 (`-webkit-tap-highlight-color: transparent`)
  - 홈 화면 추가 시 주소창 없는 100% 풀스크린 앱 구동
- **Google 지도 & 대안 장소**: 날씨 대안 장소 추천, 동선 시각화, Google 지도 연동 지원

---

## 📱 홈 화면에 앱처럼 추가하는 방법 (아이폰)
1. Safari에서 배포 링크(`https://oyeswon-gif.github.io/viago/`) 접속
2. 사파리 하단 중앙의 **[공유] (네모 위 화살표)** 버튼 탭
3. 메뉴에서 **[홈 화면에 추가]** 선택 후 우측 상단 **[추가]**
4. 홈 화면에 생성된 `viago` 아이콘을 탭하면 주소창 없는 깔끔한 네이티브 앱으로 실행됩니다!

---

## 🛠 기술 스택
- **Frontend**: Vanilla JS (PWA Standalone, SortableJS, Google Maps API)
- **Backend/DB**: Google Firebase Firestore REST API
- **Hosting**: GitHub Pages
