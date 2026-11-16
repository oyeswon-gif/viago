// viago-expense-ocr.js — 사진(거래내역 캡처·종이 영수증)에서 지출 내역을 뽑는 순수 파서
//
//   · DOM·네트워크를 쓰지 않는 순수 함수만 둔다(단위 테스트가 브라우저 밖에서도 돌아간다).
//   · OCR(tesseract.js)은 index.html 이 사진에서 글자를 읽어 이 파서에 넘긴다.
//   · 저장은 하지 않는다. 앱이 확인 시트에서 고른 항목만 trips[].expenses[] 에 넣는다.
//
//   parseCaptureText(text, { trip, rate, fallbackYear, words }) →
//     { kind: 'list' | 'receipt' | 'draft' | 'empty',
//       items: [{ title, rawTitle, amountJpy, amountKrw, category, date, time, isTopup,
//                 checked, balanceJpy, matched, draft? }],
//       balanceJpy, topupJpy, year, count, expenses, receipt? }
//
//   인식 경로 세 가지(특정 앱 문구에 기대지 않는다)
//     (A) 거래내역 목록 — OCR 단어의 y좌표로 행을 묶고, 오른쪽 금액 열과 왼쪽 상호를 짝짓는다.
//         · 날짜: `9월3일(목)` `2025.12.22` `12.10` `2025-12-22` `12/10` (연·월 헤더를 아래 행이 물려받는다)
//         · 금액: `JPY 11,660` `- ¥ 6,500` `+ ¥ 400` `￥6,500` `6,500엔` `6,500원` `Y 6,500` `부 79`(¥ 오독)
//         · `+`/`충전`/통화 교환 줄은 isTopup(지출 아님, 기본 체크 해제), `-`/`결제` 줄만 지출.
//         · 잔액(`¥ 0`·`잔액 125,953`·`残高`)은 지출로 세지 않고 마지막 잔액 후보로만 쓴다.
//     (B) 종이 영수증 — `合計`/`小計`/`お預り`/`お釣り`/`領収`/`TOTAL`/`합계`/`결제금액` 같은 신호가 있으면
//         영수증 1건으로 보고, 상단 상호명 + 합계 금액만 남긴다(거스름·받은 돈·단품 금액은 제외).
//     (C) 폴백 — 위 둘로 구조화되지 않아도 금액 후보가 하나라도 있으면 편집 가능한 1건 초안을 만든다.
//         (0건으로 끝나지 않는다. 시트에서 이름·금액을 고칠 수 있다.)
(function (global) {
  'use strict';

  var CATS = ['식비', '교통', '쇼핑', '관광'];
  var DEFAULT_CATEGORY = '식비';

  // 긴 낱말을 먼저 본다(‘면세점’ 이 ‘면세’ 보다 먼저). 일본어·영어 낱말을 함께 둔다.
  var KEYWORDS = {
    식비: ['스시', '초밥', '라멘', '우동', '소바', '이자카야', '야키토리', '로바타야키', '이부시킨', '이부시긴',
      '우나후지', '스미야키', '카페', '커피', '스타벅스', '도토루', '맥도날드', '버거', '식당', '레스토랑', '다이닝',
      '베이커리', '빵집', '디저트', '규동', '돈카츠', '텐푸라', '오코노미야키', '타코야키', '호르몬', '술집', '미소카츠',
      '고토니', '편의점', '세븐일레븐', '로손', '패밀리마트', '식사', '조식', '중식', '석식', '점심', '저녁', '카츠', '덮밥',
      'ラーメン', '寿司', 'すし', '居酒屋', '焼肉', '焼鳥', 'やきとり', 'カフェ', 'コーヒー', 'レストラン', '食堂', '定食',
      '弁当', 'おにぎり', 'カレー', 'うどん', 'そば', 'パン', 'ケーキ', 'マクドナルド', 'スターバックス', '喫茶',
      'ramen', 'sushi', 'cafe', 'coffee', 'restaurant', 'bakery', 'burger', 'izakaya', 'dining'],
    교통: ['스이카', 'suica', 'icoca', '지하철', '전철', '전차', '버스', '택시', '신칸센', '공항', '철도', '교통',
      '리무진', '유리카모메', '센트레아', '하네다', '나리타', '주부', '승차', '운임', 'jr', '킷카', '노선',
      '鉄道', '電車', '地下鉄', 'バス', 'タクシー', '新幹線', '空港', '乗車', '運賃', 'きっぷ', '切符', '定期券', 'リムジン',
      'train', 'taxi', 'bus', 'airport', 'metro', 'subway', 'railway', 'station', 'limousine'],
    쇼핑: ['돈키호테', '면세점', '면세', '드럭', '약국', '마트', '백화점', '유니클로', '무인양품', '기념품', '쇼핑', 'dfs',
      '스토어', '숍', '아울렛', '코스메', '화장품', '요도바시', '빅카메라', '전자제품', '라쿠텐', '마츠모토', '로프트',
      'ドン・キホーテ', 'ドンキ', 'ドラッグ', 'ドラッグストア', '薬', 'マツモトキヨシ', 'スーパー', 'デパート', '百貨店',
      'ユニクロ', '無印', 'ヨドバシ', 'ビックカメラ', '家電', 'コンビニ', 'お土産', '土産', '雑貨', '化粧品', 'ロフト',
      'store', 'shop', 'mart', 'super', 'drug', 'outlet', 'market', 'mall'],
    관광: ['나고야성', '성', '신사', '사찰', '절', '박물관', '미술관', '전망대', '입장', '티켓', '공원', '온천',
      '유원지', '수족관', '동물원', '관광', '투어', '전망', '체험', '스카이',
      '入場', 'チケット', '美術館', '博物館', '展望', '公園', '温泉', '観光', 'お寺', '神社', '城', '水族館', '動物園',
      'museum', 'ticket', 'park', 'temple', 'shrine', 'aquarium', 'tour', 'zoo', 'garden']
  };

  // 한 줄에서 금액이 아닌 숫자(잔액·환율·수수료 등)를 먼저 걷어낸다.
  var META_NOISE = [
    /(?:적용\s*)?환율\s*[:：]?\s*[0-9][0-9,.]*/g,
    /(?:레이트|rate)\s*[:：]?\s*[0-9][0-9,.]*/gi,
    /(?:수수료|手数料)\s*면제\s*[0-9][0-9,.]*\s*원?/g,
    /(?:수수료|手数料)\s*[:：]?\s*[0-9][0-9,.]*\s*원?/g,
    /(?:이용|결제|승인|누적|잔여|한도|포인트)\s*(?:금액|한도|포인트|번호)?\s*[:：]?\s*[0-9][0-9,.]*\s*원?/g,
    /(?:승인|承認)\s*(?:번호|番号|No\.?)\s*[:：]?\s*[0-9\-]*/gi
  ];

  // 목록·영수증 어디에나 붙는 UI 잡음(거래가 아니다).
  var UI_NOISE = /(이용\s*내역|거래\s*내역|내역\s*검색|요약\s*보기|전체\s*기간|모든\s*거래|최신\s*순|방문\s*후기|후기를\s*남겨|남겨\s*주세요|검색|필터|정렬|더\s*보기|공지|이벤트|혜택|고객\s*센터|약관|홈|마이|전체|안내|요약|レシート|領収書|領収證|お買上|ありがとう|またのご来店|レジ|担当)/;

  function toHalf(s) {
    if (typeof s !== 'string') return '';
    return s
      .replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/\uFFE5/g, '¥')
      .replace(/[—–―~〜→➜➔]/g, function (ch) { return ch === '→' || ch === '➜' || ch === '➔' ? '→' : (ch === '—' || ch === '–' || ch === '―' ? '→' : '~'); });
  }

  function squeeze(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function digits(value) {
    var n = Number(String(value == null ? '' : value).replace(/[^0-9]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function isoDate(year, month, day) {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  function todayIso() {
    var now = new Date();
    return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function normalizeName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s.,·:;'"`()\[\]{}<>|/\\_\-+*#!?]/g, '')
      .replace(/주식회사|유한회사|\(주\)/g, '');
  }

  function bigrams(s) {
    var out = [];
    for (var i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
    return out;
  }

  function similarity(a, b) {
    var x = normalizeName(a), y = normalizeName(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    var short = x.length <= y.length ? x : y;
    var long = x.length <= y.length ? y : x;
    var contain = long.indexOf(short) >= 0 && short.length >= 2 ? 0.35 : 0;
    var bx = bigrams(x), by = bigrams(y);
    if (!bx.length || !by.length) return contain;
    var pool = by.slice(), hit = 0;
    bx.forEach(function (g) {
      var at = pool.indexOf(g);
      if (at >= 0) { hit += 1; pool.splice(at, 1); }
    });
    var dice = (2 * hit) / (bx.length + by.length);
    return Math.min(1, dice + contain);
  }

  function placeCategory(place) {
    var kind = String(place && (place.kind || place.category || place.type) || '');
    if (/식당|맛집|음식|카페|food|restaurant/i.test(kind)) return '식비';
    if (/쇼핑|면세|상점|shop/i.test(kind)) return '쇼핑';
    if (/관광|투어|명소|sight|tour/i.test(kind)) return '관광';
    if (/항공|교통|이동|숙소|호텔|공항|train|flight|stay/i.test(kind)) return '교통';
    return '';
  }

  // 여행 일정·후보·맛집 목록에서 비교할 이름 목록을 만든다.
  function tripPlaces(trip) {
    var out = [];
    if (!trip) return out;
    (trip.days || []).forEach(function (day) {
      (day.places || []).forEach(function (place) {
        if (place && place.name) out.push({ name: String(place.name), category: placeCategory(place) });
      });
    });
    (trip.restaurants || []).forEach(function (place) {
      if (place && place.name) out.push({ name: String(place.name), category: '식비' });
    });
    (trip.candidates || []).forEach(function (place) {
      if (place && place.name) out.push({ name: String(place.name), category: placeCategory(place) });
    });
    return out;
  }

  // 일정 장소명과 부분 일치하면 이름을 보정하고 카테고리를 그 장소에 맞춘다.
  function matchPlace(title, trip) {
    var places = tripPlaces(trip), best = null;
    var flat = normalizeName(title);
    if (!flat || flat.length < 2) return null;
    places.forEach(function (place) {
      var score = similarity(flat, place.name);
      if (!best || score > best.score) best = { score: score, name: place.name, category: place.category };
    });
    if (!best || best.score < 0.55) return null;
    return best;
  }

  function guessCategory(title) {
    var text = String(title || '').toLowerCase();
    var list = [];
    Object.keys(KEYWORDS).forEach(function (cat) {
      KEYWORDS[cat].forEach(function (word) { list.push({ cat: cat, word: word }); });
    });
    list.sort(function (a, b) { return b.word.length - a.word.length; });
    for (var i = 0; i < list.length; i += 1) {
      if (text.indexOf(list[i].word.toLowerCase()) >= 0) return list[i].cat;
    }
    return '';
  }

  // ── 날짜·시각 ────────────────────────────────────────────────────────────────
  function detectYear(text, fallbackYear) {
    var full = String(text).match(/(20\d{2})\s*[.\-\/年]\s*\d{1,2}\s*[.\-\/月]\s*\d{1,2}/);
    if (full) return Number(full[1]);
    var short = String(text).match(/(?:^|[^0-9])(\d{2})\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}/);
    if (short) {
      var year = 2000 + Number(short[1]);
      if (year >= 2000 && year <= 2099) return year;
    }
    return fallbackYear;
  }

  function isRangeLine(line) {
    return /~\s*\d/.test(line) || /^\s*\d{1,2}[.\-\/]\d{1,2}\s*[~\-]\s*\d{1,2}[.\-\/]\d{1,2}/.test(line);
  }

  function findDate(line) {
    var kor = String(line).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (kor) return { month: Number(kor[1]), day: Number(kor[2]), text: kor[0] };
    var jp = String(line).match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (jp) return { year: Number(jp[1]), month: Number(jp[2]), day: Number(jp[3]), text: jp[0] };
    var jpMonth = String(line).match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (jpMonth && !jp) return { month: Number(jpMonth[1]), day: Number(jpMonth[2]), text: jpMonth[0] };
    var full = String(line).match(/(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
    if (full && Number(full[2]) >= 1 && Number(full[2]) <= 12 && Number(full[3]) >= 1 && Number(full[3]) <= 31) {
      return { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]), text: full[0] };
    }
    // `12.10 21:00` 처럼 뒤에 시각이 와도 날짜다. 소수·비율(857.63)은 월 범위에서 걸러진다.
    var md = String(line).match(/(?:^|[^0-9.\-\/:])(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?![0-9.\-\/])/);
    if (md && Number(md[1]) >= 1 && Number(md[1]) <= 12 && Number(md[2]) >= 1 && Number(md[2]) <= 31) {
      return { month: Number(md[1]), day: Number(md[2]), text: md[0].replace(/^[^0-9]/, '') };
    }
    return null;
  }

  function findTime(line) {
    var m = String(line).match(/(?:^|[^0-9])(\d{1,2}):(\d{2})(?![0-9])/);
    if (!m) return null;
    var hour = Number(m[1]), minute = Number(m[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour: hour, minute: minute, text: m[1] + ':' + m[2] };
  }

  function findBalance(line) {
    var m = String(line).match(/(?:잔\s*액|殘\s*高|残\s*高|balance)\s*[:：]?\s*([0-9][0-9,]*)/i);
    return m ? digits(m[1]) : null;
  }

  // ── 금액 ──────────────────────────────────────────────────────────────────
  // 날짜·시각·전화번호·승인번호는 금액 후보에서 먼저 지운다.
  function maskNonMoney(text) {
    var s = String(text || '');
    s = s.replace(/\d{4}\s*[년.\-\/]\s*\d{1,2}\s*[월.\-\/]\s*\d{1,2}\s*일?/g, ' ');
    s = s.replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ');
    s = s.replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ');
    s = s.replace(/(?:^|[^0-9])\d{1,2}[.\-\/]\d{1,2}(?![0-9])/g, ' ');
    s = s.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ');
    s = s.replace(/(?:전화|TEL|TEL\.|電話|℡|FAX|번호|番号|No\.?|#)\s*[:：]?\s*[\d\-()+]{6,}/gi, ' ');
    s = s.replace(/[\d\-()+]{9,}/g, ' ');
    return s;
  }

  var CURRENCY_HINT = /^(?:¥|￥|₩|￦|\$|JPY|KRW|USD|EUR|元|CNY|RMB)$/i;

  // 한 문자열에서 금액 후보를 뽑는다. 부호·통화·원/엔 표기를 함께 읽는다.
  function findMoneyCandidates(text) {
    var s = maskNonMoney(text);
    var out = [];
    var re = /([+\-−])?\s*(¥|￥|₩|￦|\$|JPY|KRW|USD|EUR|元|CNY|RMB|Y(?=\s?[0-9])|부(?=\s?[0-9]))?\s*(\d[\d,']*)/gi;
    var m;
    while ((m = re.exec(s)) !== null) {
      var raw = m[3].replace(/[^0-9]/g, '');
      if (!raw) continue;
      var after = s.slice(re.lastIndex, re.lastIndex + 3);
      var before = s.slice(Math.max(0, m.index - 2), m.index);
      if (/^\s*[%％]/.test(after)) continue;
      if (/^\s*(개|점|건|회|번|명|점|点|個|枚|名|件|割|人)/.test(after)) continue;
      if (/[0-9]:$/.test(before)) continue;
      var symbol = String(m[2] || '');
      var value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      var currency = '';
      if (/^(¥|￥|JPY|Y|부)$/i.test(symbol)) currency = 'JPY';
      else if (/^(₩|￦|KRW)$/i.test(symbol)) currency = 'KRW';
      else if (/^(\$|USD)$/i.test(symbol)) currency = 'USD';
      else if (/^(EUR)$/i.test(symbol)) currency = 'EUR';
      else if (/^(元|CNY|RMB)$/i.test(symbol)) currency = 'CNY';
      var suffix = /^\s*(円|엔|원)/.exec(s.slice(re.lastIndex, re.lastIndex + 4));
      if (suffix) currency = suffix[1] === '원' ? 'KRW' : 'JPY';
      if (!currency && !m[1] && raw.length < 2 && !/,/.test(m[3])) continue; // 한 자리 맨숫자는 금액으로 보지 않는다
      out.push({ value: value, sign: m[1] === '+' ? '+' : (m[1] ? '-' : ''), currency: currency, index: m.index, snippet: m[0] + (suffix ? suffix[1] : '') });
    }
    return out;
  }

  // 잔액·환율·수수료·승인번호는 금액 후보에서 먼저 지운다.
  function maskMeta(text) {
    var s = String(text || '');
    META_NOISE.forEach(function (re) { s = s.replace(re, ' '); });
    s = s.replace(/(?:잔\s*액|殘\s*高|残\s*高|balance)\s*[:：]?\s*[0-9][0-9,]*/gi, ' ');
    return s;
  }

  // OCR 이 한글을 음절 단위로 쪼갠 줄(하 나 머니)은 다시 붙인다.
  //   낱말이 온전한 줄(스타벅스 리저브)은 띄어쓰기를 그대로 둔다.
  function joinSyllables(text) {
    var tokens = String(text == null ? '' : text).split(' ');
    var out = [], i = 0;
    while (i < tokens.length) {
      if (!/^[가-힣]+$/.test(tokens[i])) { out.push(tokens[i]); i += 1; continue; }
      var run = [tokens[i]], j = i + 1;
      while (j < tokens.length && /^[가-힣]+$/.test(tokens[j])) { run.push(tokens[j]); j += 1; }
      var split = run.length > 1 && run.some(function (token) { return token.length === 1; });
      out.push(split ? run.join('') : run.join(' '));
      i = j;
    }
    return out.join(' ');
  }

  // 한 줄에서 대표 금액 (기존 호출부 호환)
  function findAmount(line, rate) {
    if (findBalance(line) != null && /^(?:잔\s*액|殘\s*高|残\s*高)/.test(squeeze(line))) return null;
    var list = findMoneyCandidates(line);
    if (!list.length) return null;
    var pick = list[list.length - 1];
    if (pick.currency === 'KRW') {
      var amountJpy = rate > 0 ? Math.round(pick.value / rate) : 0;
      return { amountKrw: pick.value, amountJpy: amountJpy, text: pick.snippet, sign: pick.sign };
    }
    if (pick.currency && pick.currency !== 'JPY') return null;
    return { amountJpy: pick.value, text: pick.snippet, sign: pick.sign, bare: !pick.currency };
  }

  function stripText(line, snippet) {
    if (!snippet) return line;
    return String(line).split(snippet).join(' ');
  }

  // 한 줄에서 거래 금액을 고른다.
  //   부호(+/-)가 붙은 후보가 있으면 그것이 거래 금액이다(같은 줄에 잔액이 같이 잡혀도 흔들리지 않는다).
  //   부호가 없으면 왼쪽부터 첫 금액 — 오른쪽 끝 숫자는 잔액인 경우가 많다.
  function pickTransactionMoney(list) {
    if (!list || !list.length) return null;
    var signed = list.filter(function (c) { return !!c.sign; });
    if (signed.length) return signed[0];
    return list[0];
  }

  // 통화 충전(하나머니 → JPY, 외화 환전)만 '지출 아님'이다.
  //   스이카·교통카드 '충전'은 실제 지출이라 그대로 둔다(디자인 시트의 스이카 충전 ¥6,000 = 교통).
  function looksLikeTopup(title) {
    var text = String(title || '');
    if (/충전|チャージ|入金|입금|チャージ|top\s*up|charge/i.test(text)) {
      return /(?:JPY|USD|EUR|CNY|엔|円|외화|머니|트래블|travel|money)/i.test(text) || /^\s*(?:충전|チャージ|入金)\s*$/.test(text);
    }
    return /환전|외화\s*충전|両替|→\s*(?:JPY|USD|EUR|CNY)|(?:JPY|USD|EUR|CNY)\s*→|top\s*up|charge\s*jpy/i.test(text);
  }

  // 금액 부호 없이도 통화 교환 줄인지(좌측이 통화 이름뿐인지) 본다.
  function looksLikeCurrencyRow(title) {
    var flat = squeeze(String(title || '').replace(/[0-9,.¥￥₩￦+]/g, ' '));
    if (!flat) return false;
    if (!/(JPY|USD|EUR|CNY|円|엔|원|달러|위안|외화|머니|일본|日本|미국|유럽)/i.test(flat)) return false;
    return /^(일본|日本|미국|유럽|중국|한국|대한민국)?\s*(JPY|USD|EUR|CNY|円|엔|원|달러|위안|외화)?\s*(머니|통장|지갑|충전|환전|JPY|USD|EUR|CNY|円|엔|원|달러|위안)?$/i.test(flat);
  }

  // OCR 이 상호 글자 사이에 끼워 넣은 기호·자모 조각(@, ㅁ, ㅜ, 1/ 같은)을 걷어낸다.
  function cleanTitle(raw) {
    var out = String(raw == null ? '' : raw)
      // 낱말 사이의 '>'는 화살표(하나머니 > JPY)다. 앞뒤 글자가 있을 때만 → 로 살린다.
      .replace(/([0-9A-Za-z가-힣ぁ-んァ-ヶ一-龠])\s*[>›»＞]\s*(?=[0-9A-Za-z가-힣ぁ-んァ-ヶ一-龠])/g, '$1 → ')
      .replace(/[<>]/g, ' ')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    out = out.split(' ').filter(function (token) {
      if (!token) return false;
      if (/^[@&※·•|~^*`"'’”“<>«»=\\/\[\](){}]+$/.test(token)) return false;
      if (/^[\u3131-\u318E\u1100-\u11FF]+$/.test(token) && token.length <= 3) return false;
      if (/^\d?[\/\\]$/.test(token)) return false;
      return true;
    }).join(' ');
    out = out.replace(/^[-–—:·•*]+|[-–—:·•*]+$/g, '').trim();
    // OCR 이 일본어를 글자 단위로 쪼개 놓으면 다시 붙인다(한글은 낱말 띄어쓰기를 지킨다).
    out = out.replace(/([\u3005-\u303f\u3040-\u30ff\u4e00-\u9fff\uff66-\uff9f])\s+(?=[\u3005-\u303f\u3040-\u30ff\u4e00-\u9fff\uff66-\uff9f])/g, '$1');
    out = joinSyllables(out);
    return out;
  }

  // 상호가 아닌 상태 표시(결제·충전·취소) 낱말
  var STATE_WORD = /(결제|승인|출금|사용|이용|충전|입금|환전|취소|환불|반품|返品|返金|チャージ|入金|支払|決済|利用|取消)/;

  function stripStateWords(title) {
    return cleanTitle(String(title || '')
      .replace(/(결제\s*취소|승인\s*취소|취소\s*됨|결제\s*완료|승인\s*완료)/g, ' ')
      .replace(/^(결제|승인|출금|사용|이용|충전|입금|환전|취소|환불|支払|決済|利用|取消|チャージ|入金)\s*/g, ' ')
      .replace(/\s*(결제|승인|출금|사용|충전|입금|환전|취소|환불|支払|決済|利用|取消|チャージ|入金)\s*$/g, ' '));
  }

  function isMetaOnly(line) {
    var rest = squeeze(String(line).replace(/[0-9]/g, '').replace(/[^가-힣a-zA-Zぁ-んァ-ヶ一-龠]/g, ''));
    return /^(잔액|적용환율|환율|수수료|면제|한도|잔여|누적|포인트|승인|카드|이용금액|결제예정|할부|취소|残高|手数料|ポイント|合計|小計|税)?$/.test(rest) ||
      /(잔액|殘高|残高|적용환율|수수료|手数料|면제|한도|잔여|누적|승인번호|카드번호)/.test(line);
  }

  // ── OCR 단어 → 행 ────────────────────────────────────────────────────────────
  // tesseract.js TSV(level 5 = word) → [{text, bbox:{x0,y0,x1,y1}, conf}]
  function parseOcrTsv(tsv) {
    var out = [];
    String(tsv || '').trim().split(/\r?\n/).forEach(function (line, index) {
      if (!line || index === 0) return;
      var cols = line.split('\t');
      if (Number(cols[0]) !== 5) return;
      var text = squeeze(cols[11]);
      if (!text || text === '-1') return;
      var x0 = Number(cols[6]), y0 = Number(cols[7]), w = Number(cols[8]), h = Number(cols[9]);
      if (!Number.isFinite(x0) || !Number.isFinite(y0)) return;
      out.push({ text: text, conf: Number(cols[10]), bbox: { x0: x0, y0: y0, x1: x0 + w, y1: y0 + h } });
    });
    return out;
  }

  // tesseract 의 lines/words/blocks 어느 쪽으로 와도 단어 배열로 편다.
  function normalizeWords(words) {
    var out = [];
    (words || []).forEach(function (word) {
      if (!word) return;
      var text = squeeze(toHalf(word.text || ''));
      if (!text) return;
      var box = word.bbox || {};
      if (box.x0 == null && word.x != null) box = { x0: word.x, y0: word.y, x1: word.x + (word.w || 0), y1: word.y + (word.h || 0) };
      if (box.x0 == null) return;
      out.push({ text: text, conf: Number(word.conf || word.confidence || 0), bbox: { x0: Number(box.x0), y0: Number(box.y0), x1: Number(box.x1), y1: Number(box.y1) } });
    });
    return out;
  }

  function buildRows(words) {
    var list = normalizeWords(words);
    if (list.length < 2) return null;
    var heights = list.map(function (w) { return w.bbox.y1 - w.bbox.y0; }).filter(function (h) { return h > 0; }).sort(function (a, b) { return a - b; });
    var medH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
    var tol = Math.max(6, medH * 0.6);
    var sorted = list.slice().sort(function (a, b) { return (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1); });
    var rows = [];
    sorted.forEach(function (word) {
      var cy = (word.bbox.y0 + word.bbox.y1) / 2;
      var row = rows[rows.length - 1];
      if (row && Math.abs(cy - row.cy) <= tol) {
        row.words.push(word);
        row.cy = (row.cy * (row.words.length - 1) + cy) / row.words.length;
      } else {
        rows.push({ cy: cy, words: [word] });
      }
    });
    rows.forEach(function (row) { row.words.sort(function (a, b) { return a.bbox.x0 - b.bbox.x0; }); });
    return rows.sort(function (a, b) { return a.cy - b.cy; });
  }

  function pageWidth(rows) {
    var max = 0;
    (rows || []).forEach(function (row) {
      row.words.forEach(function (w) { if (w.bbox.x1 > max) max = w.bbox.x1; });
    });
    return max || 900;
  }

  // 행을 왼쪽(상호·구분)과 오른쪽(금액·잔액) 열로 나눈다. 가장 큰 x 간격을 쓴다.
  function splitRow(row, width) {
    var ws = row.words.slice();
    var best = null;
    for (var i = 1; i < ws.length; i += 1) {
      var gap = ws[i].bbox.x0 - ws[i - 1].bbox.x1;
      if (!best || gap > best.gap) best = { gap: gap, at: i };
    }
    var minGap = Math.max(14, (width || 900) * 0.055);
    if (best && best.gap >= minGap) return { left: ws.slice(0, best.at), right: ws.slice(best.at) };
    return { left: ws, right: [] };
  }

  function wordsText(words) {
    return squeeze((words || []).map(function (w) { return w.text; }).join(' '));
  }

  // ── 영수증 판별 ──────────────────────────────────────────────────────────────
  var RECEIPT_STRONG = /(合\s*計|総\s*計|합\s*계|결제\s*금액|승인\s*금액|TOTAL|AMOUNT\s*DUE)/i;
  var RECEIPT_WEAK = /(小\s*計|お買上|お預り|お釣り|おつり|領収|レシート|税込|消費税|TEL|℡|電話番号|住所|부가세|봉사료|거스름|받은\s*돈|받을\s*돈|현금|CASH|CHANGE|SUBTOTAL|TAX|카드\s*결제|승인\s*번호|登録番号|レジ)/gi;

  // 영수증 신호 점수. 목록 캡처에는 合計/TEL 같은 낱말이 없다.
  function receiptScore(text) {
    var t = String(text || '');
    var score = 0;
    if (RECEIPT_STRONG.test(t)) score += 2;
    var weak = t.match(RECEIPT_WEAK);
    if (weak) score += Math.min(3, weak.length);
    if (/円|¥|￥/.test(t) && /(税|小計|合計)/.test(t)) score += 1;
    return score;
  }

  function detectReceipt(text) {
    return receiptScore(text) >= 3;
  }

  var RECEIPT_EXCLUDE = /(小\s*計|消費税|税\s*額|内税|外税|お預り|おあずり|預り|お釣り|おつり|釣銭|つり銭|ポイント|point|残高|거스름|받은\s*돈|받을\s*돈|현금|CASH|CHANGE|SUBTOTAL|TAX|割引|値引|クーポン|点数|数量|登録番号)/i;
  var RECEIPT_TOTAL = /(合\s*計|総\s*計|합\s*계|총\s*액|결제\s*금액|승인\s*금액|TOTAL|AMOUNT|ご利用金額|請求|お会計|支払\s*金額)/i;

  function receiptLines(rows, text) {
    if (rows && rows.length) {
      return rows.map(function (row) {
        var parts = splitRow(row, pageWidth(rows));
        return { text: squeeze(wordsText(row.words)), left: squeeze(wordsText(parts.left)), right: squeeze(wordsText(parts.right)) };
      });
    }
    return String(text || '').split(/\r?\n/).map(function (line) { return squeeze(line); }).filter(Boolean)
      .map(function (line) { return { text: line, left: line, right: line }; });
  }

  function pickReceiptTotal(lines) {
    var totals = [];
    var loose = [];
    lines.forEach(function (line, index) {
      var money = findMoneyCandidates(line.text);
      if (!money.length) return;
      var excluded = RECEIPT_EXCLUDE.test(line.text) && !RECEIPT_TOTAL.test(line.text);
      if (excluded) return;
      var pick = money[money.length - 1];
      var amount = pick.currency === 'KRW' ? pick.value : pick.value;
      if (RECEIPT_TOTAL.test(line.text)) totals.push({ amount: amount, index: index, currency: pick.currency, line: line.text });
      else loose.push({ amount: amount, index: index, currency: pick.currency, line: line.text });
    });
    var pool = totals.length ? totals : loose;
    if (!pool.length) return null;
    // 합계 줄이 여럿이면 가장 큰 값(쿠폰·할인 전 합계가 아니라 결제 합계)을 쓰고, 같으면 아래쪽 줄을 쓴다.
    var best = pool[0];
    pool.forEach(function (cand) {
      if (cand.amount > best.amount || (cand.amount === best.amount && cand.index > best.index)) best = cand;
    });
    return best;
  }

  function pickStoreName(lines) {
    var best = null;
    lines.slice(0, 8).forEach(function (line, index) {
      var text = cleanTitle(line.text);
      if (!text || text.length < 2) return;
      if (RECEIPT_EXCLUDE.test(text) || RECEIPT_TOTAL.test(text)) return;
      if (/領収書|領収證|レシート|レシートno|日付|date|tel|電話|fax|住所|所在地|〒|℡|登録番号|レジ|担当|釣|お預り/i.test(text)) return;
      if (findMoneyCandidates(text).length && !/店|ストア|マート|store|shop/i.test(text)) return;
      var letters = (text.match(/[가-힣a-zA-Zぁ-んァ-ヶ一-龠]/g) || []).length;
      if (letters < 2) return;
      var score = letters + (index === 0 ? 2 : 0) + (/店|ストア|マート|薬|カフェ|ラーメン|寿司|レストラン|食堂|ドラッグ|コンビニ|store|shop|mart|cafe/i.test(text) ? 6 : 0);
      if (!best || score > best.score) best = { score: score, text: text };
    });
    return best ? best.text : '';
  }

  // 영수증 날짜 — 주소(1-1-1)보다 `2025年12月10日`·`2025.12.10`·`R7.12.10` 같은 온전한 날짜를 먼저 쓴다.
  function bestDate(lines) {
    var tiers = [[], [], []];
    (lines || []).forEach(function (line) {
      var text = String(line && line.text || '');
      var jp = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (jp) { tiers[0].push({ year: Number(jp[1]), month: Number(jp[2]), day: Number(jp[3]) }); return; }
      var full = text.match(/(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?![0-9\-\/])/);
      if (full) { tiers[0].push({ year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) }); return; }
      var reiwa = reiwaYear(text);
      if (reiwa) { tiers[0].push(reiwa); return; }
      var short = text.match(/(?:^|[^0-9\-\/:])(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?![0-9\-\/])/);
      if (short && Number(short[1]) >= 1 && Number(short[1]) <= 12) { tiers[1].push({ month: Number(short[1]), day: Number(short[2]) }); return; }
      var monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (monthDay) tiers[1].push({ month: Number(monthDay[1]), day: Number(monthDay[2]) });
    });
    return tiers[0][0] || tiers[1][0] || null;
  }

  function reiwaYear(text) {
    var m = String(text).match(/(?:R|令和)\s*(\d{1,2})\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})/);
    if (!m) return null;
    return { year: 2018 + Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }

  /**
   * 종이 영수증 1장 → 지출 1건.
   * @param {string} text OCR 텍스트
   * @param {{rows?:Array, trip?:object, rate?:number, fallbackYear?:number, year?:number}} options
   */
  function parseReceipt(text, options) {
    var opts = options || {};
    var rate = Number(opts.rate) > 0 ? Number(opts.rate) : 0;
    var trip = opts.trip || null;
    var raw = toHalf(String(text || ''));
    var fallbackYear = Number(opts.fallbackYear) || (trip && /^\d{4}/.test(String(trip.start || '')) ? Number(String(trip.start).slice(0, 4)) : new Date().getFullYear());
    var year = Number(opts.year) || detectYear(raw, fallbackYear);
    var lines = receiptLines(opts.rows, raw);

    var total = pickReceiptTotal(lines);
    var store = pickStoreName(lines);
    var date = bestDate(lines);
    var time = null;
    for (var j = 0; j < lines.length && !time; j += 1) time = findTime(lines[j].text);

    var amountJpy = 0, amountKrw = null;
    if (total) {
      if (total.currency === 'KRW') {
        amountKrw = total.amount;
        amountJpy = rate > 0 ? Math.round(total.amount / rate) : total.amount;
      } else if (!total.currency || total.currency === 'JPY') {
        amountJpy = total.amount;
      } else {
        amountJpy = 0;
      }
    }

    var title = cleanTitle(store) || '영수증';
    var matched = matchPlace(title, trip);
    var category = (matched && matched.category) || guessCategory(title + ' ' + raw) || DEFAULT_CATEGORY;
    var iso = date ? isoDate(date.year || year, date.month, date.day) : (trip && /^\d{4}-\d{2}-\d{2}$/.test(String(trip.start || '')) ? String(trip.start) : todayIso());

    var items = [];
    if (amountJpy > 0) {
      items.push({
        title: title,
        rawTitle: title,
        amountJpy: Math.round(amountJpy),
        amountKrw: amountKrw,
        category: CATS.indexOf(category) >= 0 ? category : DEFAULT_CATEGORY,
        date: iso,
        time: time ? pad2(time.hour) + ':' + pad2(time.minute) : '',
        isTopup: false,
        checked: true,
        matched: matched ? { name: matched.name, score: Math.round(matched.score * 100) / 100 } : null,
        receipt: true
      });
    }
    items.forEach(function (item, index) { item.id = 'cap-' + index; });
    return {
      kind: items.length ? 'receipt' : 'empty',
      items: items,
      balanceJpy: null,
      topupJpy: 0,
      year: year,
      count: items.length,
      expenses: items.length,
      receipt: {
        store: title,
        totalJpy: amountJpy,
        date: iso,
        time: items.length && items[0].time || '',
        line: total ? total.line : ''
      }
    };
  }

  // ── 목록 파서 (행·좌표 기반) ──────────────────────────────────────────────────
  function makeItem(payload) {
    return payload;
  }

  function finalizeItems(items) {
    items.forEach(function (item) { if (!item.id) item.id = ''; });
    var expenses = items.filter(function (item) { return !item.isTopup; });
    items.sort(function (a, b) {
      if (a.isTopup !== b.isTopup) return a.isTopup ? 1 : -1;
      var da = (a.date || '') + ' ' + (a.time || '');
      var db = (b.date || '') + ' ' + (b.time || '');
      return da.localeCompare(db);
    });
    items.forEach(function (item, index) { item.id = 'cap-' + index; });
    return expenses.length;
  }

  var STATE_ONLY = /^(결제|승인|출금|입금|사용|이용|충전|환전|취소|환불|지급|결제완료|승인완료|支払|決済|利用|チャージ|入金|取消)$/;

  function parseRows(rows, ctx) {
    var width = pageWidth(rows);
    var items = [];
    var date = ctx.initialDate;
    var pendingTitle = '';
    var last = null;
    var balanceJpy = null;
    var year = ctx.year;

    function hhmm(time) {
      return time ? pad2(time.hour) + ':' + pad2(time.minute) : '';
    }

    // 통화 충전 표시 — 통화 이름(JPY·머니·외화)이 있는 줄만 지출에서 뺀다.
    function markTopup(target) {
      if (!target) return;
      if (!(looksLikeTopup(target.title) || looksLikeCurrencyRow(target.title) || /JPY|USD|EUR|CNY|円|엔|외화|머니/i.test(String(target.title || '')))) return;
      target.isTopup = true;
      target.checked = false;
      if (!/충전|チャージ/.test(target.title)) target.title += ' 충전';
    }

    // 바로 앞 내역에 이 줄의 정보(시각·충전 표시·금액 확정)를 붙인다.
    function attachToLast(text, money, time) {
      if (!last) return;
      if (time && !last.time) last.time = hhmm(time);
      if (/(충전|チャージ|入金|입금)/.test(text)) markTopup(last);
      if (/(취소|환불|返品|取消|返金)/.test(text)) last.cancelled = true;
      if (money && !(Number(last.amountJpy) > 0)) last.amountJpy = money.value;
    }

    function record(titleRaw, money, time, topupHint) {
      var title = cleanTitle(titleRaw);
      if (!title) title = pendingTitle;
      if (!title) return;
      if (stateOnly(title)) { attachToLast(title, money, time); return; }
      if (/(취소|환불|返品|返金|cancel|refund)/i.test(title)) return;
      var amountJpy = money.currency === 'KRW' ? (ctx.rate > 0 ? Math.round(money.value / ctx.rate) : 0) : money.value;
      if (!(amountJpy > 0)) return;
      var isTopup = !!topupHint;
      if (!isTopup && money.sign === '+') isTopup = true;
      if (!isTopup && looksLikeTopup(title)) isTopup = true;
      if (!isTopup && !money.sign && looksLikeCurrencyRow(title)) isTopup = true;
      if (isTopup && /^일본$/.test(title)) title = '일본 JPY';   // 통화 줄 상호가 잘려도 알기 쉽게
      var matched = matchPlace(title, ctx.trip);
      var name = (matched && matched.score >= 0.7) ? matched.name : title;
      var category = (matched && matched.category) || guessCategory(name + ' ' + title) || DEFAULT_CATEGORY;
      var record = {
        title: name,
        rawTitle: title,
        amountJpy: Math.round(amountJpy),
        amountKrw: money.currency === 'KRW' ? money.value : null,
        category: CATS.indexOf(category) >= 0 ? category : DEFAULT_CATEGORY,
        date: isoDate((date && date.year) || year, date && date.month, date && date.day) || ctx.fallbackDate,
        time: hhmm(time),
        isTopup: isTopup,
        checked: !isTopup,
        matched: matched ? { name: matched.name, score: Math.round(matched.score * 100) / 100 } : null,
        balanceJpy: null
      };
      items.push(record);
      last = record;
      pendingTitle = '';
    }

    function stateOnly(text) {
      return STATE_ONLY.test(String(text || '').replace(/\s+/g, ''));
    }

    rows.forEach(function (row) {
      var parts = splitRow(row, width);
      var leftRaw = wordsText(parts.left);
      var rightRaw = wordsText(parts.right);
      var left = cleanTitle(leftRaw);
      var right = cleanTitle(rightRaw);
      var all = squeeze((left + ' ' + right).trim());
      if (!all) return;
      // 화면 머리글·버튼·안내 문구는 거래가 아니다.
      if (UI_NOISE.test(all) && !/[0-9]{1,3},[0-9]{3}/.test(all)) return;

      var time = findTime(all);
      var leftMoney = findMoneyCandidates(maskMeta(leftRaw));
      var rightMoney = findMoneyCandidates(maskMeta(rightRaw));
      var balanceWord = /(잔\s*액|殘\s*高|残\s*高|balance)/i.test(all);

      // 1) 잔액 줄 — 지출로 세지 않는다(마지막 잔액 후보).
      if (balanceWord) {
        var bal = findBalance(all);
        if (bal == null && rightMoney.length === 1) bal = rightMoney[0].value;
        if (bal != null) {
          balanceJpy = bal;
          if (last && last.balanceJpy == null) last.balanceJpy = bal;
        }
        if (!leftMoney.length) {
          if (last) {
            if (time && !last.time) last.time = hhmm(time);
            if (/(충전|チャージ|入金|입금)/.test(all)) markTopup(last);
          }
          return;
        }
      }

      // 2) 금액이 없는 줄 — 날짜 헤더 / 상태 낱말 / 다음 줄의 상호
      if (!leftMoney.length && !rightMoney.length) {
        if (!isRangeLine(all)) {
          var foundDate = findDate(all);
          if (foundDate && all.replace(/\s/g, '').length <= 16) {
            date = { year: foundDate.year || year, month: foundDate.month, day: foundDate.day };
            if (last && time && !last.time) last.time = hhmm(time);
            pendingTitle = '';
            return;
          }
        }
        if (stateOnly(all) || (STATE_WORD.test(all) && stripStateWords(all).length <= 2)) {
          attachToLast(all, null, time);
          return;
        }
        if (isMetaOnly(all)) { pendingTitle = ''; return; }
        var textOnly = cleanTitle(all);
        if (textOnly && textOnly.length >= 2) pendingTitle = textOnly;
        return;
      }

      // 3) 거래 줄 — 오른쪽 금액 열을 먼저 믿고, 없으면 줄 전체에서 찾는다.
      var pick = rightMoney.length ? pickTransactionMoney(rightMoney) : (leftMoney.length ? pickTransactionMoney(leftMoney) : null);
      if (!pick) return;
      var titleText = cleanTitle(stripText(stripText(leftRaw, pick.snippet), time ? time.text : ''));
      if (leftMoney.length && !titleText) titleText = cleanTitle(stripText(leftRaw, leftMoney[leftMoney.length - 1].snippet));
      var titleMoney = findMoneyCandidates(maskMeta(titleText));
      if (titleMoney.length && !titleText.replace(/[0-9,\s¥￥₩￦+\-]/g, '')) titleText = '';
      if (!titleText) {
        // 금액만 오른쪽 열에 남고 상호가 윗줄에 따로 잡힌 경우 — 그 상호로 거래를 만든다.
        if (pendingTitle) { record(pendingTitle, pick, time, false); return; }
        attachToLast(right || left || '', pick, time);
        return;
      }
      if (isMetaOnly(titleText) || stateOnly(titleText)) {
        attachToLast(titleText, pick, time);
        return;
      }
      record(titleText, pick, time, false);
    });

    items.forEach(function (item) { if (item.cancelled) item.checked = false; });
    var kept = items.filter(function (item) { return !item.cancelled; });
    finalizeItems(kept);
    return { items: kept, balanceJpy: balanceJpy };
  }

  // ── 목록 파서 (텍스트 줄 기반 폴백) ───────────────────────────────────────────
  function parseLines(lines, ctx) {
    var items = [];
    var date = ctx.initialDate;
    var pendingTitle = '';
    var last = null;
    var balanceJpy = null;
    var year = ctx.year;

    function push(titleRaw, money, time, isTopupHint) {
      var title = cleanTitle(titleRaw);
      if (!title) title = pendingTitle;
      if (!title) return;
      if (STATE_ONLY.test(title.replace(/\s+/g, ''))) return;   // '결제' 한 줄은 거래가 아니다
      if (/(취소|환불|返品|返金|cancel|refund)/i.test(title)) return;
      var amountJpy = money.currency === 'KRW' ? (ctx.rate > 0 ? Math.round(money.value / ctx.rate) : 0) : money.value;
      if (!(amountJpy > 0)) return;
      var isTopup = isTopupHint || money.sign === '+' || !!looksLikeTopup(title) || (!money.sign && looksLikeCurrencyRow(title));
      if (isTopup && /^일본$/.test(title)) title = '일본 JPY';
      var matched = matchPlace(title, ctx.trip);
      var name = (matched && matched.score >= 0.7) ? matched.name : title;
      var category = (matched && matched.category) || guessCategory(name + ' ' + title) || DEFAULT_CATEGORY;
      var record = {
        title: name,
        rawTitle: title,
        amountJpy: Math.round(amountJpy),
        amountKrw: money.currency === 'KRW' ? money.value : null,
        category: CATS.indexOf(category) >= 0 ? category : DEFAULT_CATEGORY,
        date: isoDate((date && date.year) || year, date && date.month, date && date.day) || ctx.fallbackDate,
        time: time ? pad2(time.hour) + ':' + pad2(time.minute) : '',
        isTopup: isTopup,
        checked: !isTopup,
        matched: matched ? { name: matched.name, score: Math.round(matched.score * 100) / 100 } : null,
        balanceJpy: null
      };
      items.push(record);
      last = record;
    }

    lines.forEach(function (line) {
      var work = line;
      var balance = findBalance(work);
      if (balance != null) work = work.replace(/(?:잔\s*액|殘\s*高|残\s*高|balance)\s*[:：]?\s*[0-9][0-9,]*/i, ' ');
      META_NOISE.forEach(function (re) { work = work.replace(re, ' '); });

      var inlineDate = null;
      if (!isRangeLine(line)) {
        inlineDate = findDate(work);
        if (inlineDate) {
          work = stripText(work, inlineDate.text);
          date = { year: inlineDate.year || year, month: inlineDate.month, day: inlineDate.day };
        }
      }
      var time = findTime(work);
      if (time) work = stripText(work, time.text);

      var moneyList = findMoneyCandidates(work);
      if (moneyList.length) {
        var pick = moneyList[moneyList.length - 1];
        var title = cleanTitle(stripText(stripText(work, pick.snippet), ''));
        if (!title || /^[0-9,.\s¥￥₩]+$/.test(title) || title.length < 2) title = pendingTitle || '';
        if (title && !isMetaOnly(title) && !UI_NOISE.test(title)) {
          push(title, pick, time, false);
        } else if (last && balance == null) {
          last.amountJpy = pick.value;
        }
        if (balance != null && last && last.balanceJpy == null) last.balanceJpy = balance;
        if (balance != null) balanceJpy = balance;
        pendingTitle = '';
        return;
      }

      if (balance != null) {
        balanceJpy = balance;
        if (last && last.balanceJpy == null) last.balanceJpy = balance;
        if (last) {
          if (time && !last.time) last.time = pad2(time.hour) + ':' + pad2(time.minute);
          if (/(충전|チャージ|入金|입금)/.test(work) && looksLikeTopup(last.title)) {
            last.isTopup = true; last.checked = false;
            if (!/충전|チャージ/.test(last.title)) last.title += ' 충전';
          }
        }
        return;
      }
      if (UI_NOISE.test(work) || isMetaOnly(work)) { pendingTitle = ''; return; }
      var textOnly = cleanTitle(work);
      if (STATE_ONLY.test(textOnly.replace(/\s+/g, ''))) {
        if (last && /(충전|チャージ|入金|입금)/.test(textOnly) && looksLikeTopup(last.title)) {
          last.isTopup = true; last.checked = false;
          if (!/충전|チャージ/.test(last.title)) last.title += ' 충전';
        }
        return;
      }
      if (textOnly && textOnly.length >= 2) pendingTitle = textOnly;
    });

    finalizeItems(items);
    return { items: items, balanceJpy: balanceJpy };
  }

  // ── 폴백 초안: 0건으로 끝나지 않는다 ─────────────────────────────────────────
  function draftFromText(text, ctx) {
    var raw = toHalf(String(text || ''));
    if (!raw.trim()) return null;
    var candidates = findMoneyCandidates(raw).filter(function (c) {
      if (c.sign === '+') return false;
      if (!c.currency && c.value >= 1900 && c.value <= 2100) return false; // 연도로 보이는 숫자
      return c.value >= 10;
    });
    if (!candidates.length) return null;
    var best = candidates[0];
    candidates.forEach(function (cand) {
      var score = cand.value + (cand.currency ? 1000000 : 0) + (cand.value >= 100 ? 100 : 0);
      var bestScore = best.value + (best.currency ? 1000000 : 0) + (best.value >= 100 ? 100 : 0);
      if (score > bestScore) best = cand;
    });
    var title = '';
    String(raw).split(/\r?\n/).forEach(function (line) {
      var text = cleanTitle(stripStateWords(line));
      if (!text || text.length < 2) return;
      if (findMoneyCandidates(text).length) return;
      if (UI_NOISE.test(text) || isMetaOnly(text)) return;
      if (!/[가-힣a-zA-Zぁ-んァ-ヶ一-龠]/.test(text)) return;
      if (text.length > title.length) title = text;
    });
    title = title || '사진에서 읽은 지출';
    var matched = matchPlace(title, ctx.trip);
    var category = (matched && matched.category) || guessCategory(title + ' ' + raw) || DEFAULT_CATEGORY;
    var amount = best.currency === 'KRW' ? (ctx.rate > 0 ? Math.round(best.value / ctx.rate) : best.value) : best.value;
    if (!(amount > 0)) return null;
    var item = {
      title: (matched && matched.score >= 0.7) ? matched.name : title,
      rawTitle: title,
      amountJpy: Math.round(amount),
      amountKrw: best.currency === 'KRW' ? best.value : null,
      category: CATS.indexOf(category) >= 0 ? category : DEFAULT_CATEGORY,
      date: ctx.fallbackDate,
      time: '',
      isTopup: false,
      checked: true,
      draft: true,
      matched: matched ? { name: matched.name, score: Math.round(matched.score * 100) / 100 } : null,
      balanceJpy: null
    };
    return item;
  }

  function looksJapanese(text) {
    return /[\u3040-\u30ff]/.test(String(text || ''));
  }

  /**
   * 사진에서 읽은 글자 → 지출 후보 목록.
   * @param {string} text OCR 텍스트
   * @param {{trip?:object, rate?:number, fallbackYear?:number, words?:Array}} options
   */
  function parseCaptureText(text, options) {
    var opts = options || {};
    var rate = Number(opts.rate) > 0 ? Number(opts.rate) : 0;
    var trip = opts.trip || null;
    var fallbackYear = Number(opts.fallbackYear) || (trip && /^\d{4}/.test(String(trip.start || '')) ? Number(String(trip.start).slice(0, 4)) : new Date().getFullYear());
    var raw = toHalf(String(text || ''));
    var year = detectYear(raw, fallbackYear);
    var tripStart = trip && /^\d{4}-\d{2}-\d{2}$/.test(String(trip.start || '')) ? String(trip.start) : '';
    var fallbackDate = tripStart || todayIso();
    var initialDate = tripStart ? { year: Number(tripStart.slice(0, 4)), month: Number(tripStart.slice(5, 7)), day: Number(tripStart.slice(8, 10)) } : null;
    var ctx = { trip: trip, rate: rate, year: year, fallbackDate: fallbackDate, initialDate: initialDate };

    var rows = buildRows(opts.words);
    var lines = raw.split(/\r?\n/).map(function (line) { return squeeze(line); }).filter(Boolean);

    // (B) 종이 영수증이면 1건으로 본다.
    if (detectReceipt(raw)) {
      var receipt = parseReceipt(raw, { rows: rows, trip: trip, rate: rate, year: year, fallbackYear: fallbackYear });
      if (receipt.count) return receipt;
    }

    // (A) 목록 파서 — 좌표가 있으면 행 기반, 없으면 줄 기반.
    var parsed = rows && rows.length >= 2 ? parseRows(rows, ctx) : parseLines(lines, ctx);
    var items = parsed.items;

    var topupJpy = 0;
    items.forEach(function (item) { if (item.isTopup) topupJpy += item.amountJpy; });

    if (items.length) {
      return {
        kind: 'list',
        items: items,
        balanceJpy: parsed.balanceJpy,
        topupJpy: topupJpy,
        year: year,
        count: items.length,
        expenses: items.filter(function (item) { return !item.isTopup; }).length
      };
    }

    // (C) 폴백 초안 — 금액 후보가 있으면 1건을 띄워 사용자가 고치게 한다.
    var draft = draftFromText(raw, ctx);
    if (draft) {
      draft.id = 'cap-0';
      return {
        kind: 'draft',
        items: [draft],
        balanceJpy: parsed.balanceJpy,
        topupJpy: 0,
        year: year,
        count: 1,
        expenses: 1
      };
    }

    return { kind: 'empty', items: [], balanceJpy: parsed.balanceJpy, topupJpy: 0, year: year, count: 0, expenses: 0 };
  }

  var api = {
    CATS: CATS,
    DEFAULT_CATEGORY: DEFAULT_CATEGORY,
    parseCaptureText: parseCaptureText,
    parseReceipt: parseReceipt,
    detectReceipt: detectReceipt,
    receiptScore: receiptScore,
    parseOcrTsv: parseOcrTsv,
    buildRows: buildRows,
    findMoneyCandidates: findMoneyCandidates,
    pickTransactionMoney: pickTransactionMoney,
    looksJapanese: looksJapanese,
    guessCategory: guessCategory,
    matchPlace: matchPlace,
    looksLikeTopup: looksLikeTopup,
    similarity: similarity
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.ViagoExpenseCapture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
