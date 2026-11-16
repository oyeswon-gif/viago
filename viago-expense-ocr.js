// viago-expense-ocr.js — 거래내역 캡처(사진) 글자에서 지출 내역을 뽑는 순수 파서
//
//   · DOM·네트워크를 쓰지 않는 순수 함수만 둔다(단위 테스트가 브라우저 밖에서도 돌아간다).
//   · OCR(tesseract.js)은 index.html 이 사진에서 글자를 읽어 이 파서에 넘긴다.
//   · 저장은 하지 않는다. 앱이 확인 시트에서 고른 항목만 trips[].expenses[] 에 넣는다.
//
//   parseCaptureText(text, { trip, rate, fallbackYear }) →
//     { items: [{ title, rawTitle, amountJpy, amountKrw, category, date, time, isTopup,
//                 checked, balanceJpy, matched }],
//       balanceJpy, topupJpy, year, count }
//
//   인식 규칙(하나머니·트래블로그·카드사 거래내역 캡처 기준)
//     - 날짜: `9월3일(목)` / `12.10` / `2026.12.10` / `26.09.01` 범위는 연도만 참고하고 날짜로 쓰지 않는다.
//     - 시각: `10:53` — 같은 내역의 다음 줄(잔액·충전 표시)에 있어도 그 내역에 붙인다.
//     - 금액: `JPY 11,660` / `¥11,660` / `11,660엔` / `12,400원`(원화는 환율로 엔화 환산)
//     - 잔액: `잔액 125,953` → cardBalanceJpy 후보. 수수료·적용환율·한도는 금액으로 쓰지 않는다.
//     - `충전`·`Charge` 가 있는 내역은 지출이 아니다(isTopup) → 기본 체크 해제 + '지출 아님'.
(function (global) {
  'use strict';

  var CATS = ['식비', '교통', '쇼핑', '관광'];
  var DEFAULT_CATEGORY = '식비';

  // 긴 낱말을 먼저 본다(‘면세점’ 이 ‘면세’ 보다 먼저).
  var KEYWORDS = {
    식비: ['스시', '초밥', '라멘', '우동', '소바', '이자카야', '야키토리', '로바타야키', '이부시킨', '이부시긴',
      '우나후지', '스미야키', '카페', '커피', '스타벅스', '도토루', '맥도날드', '버거', '식당', '레스토랑', '다이닝',
      '베이커리', '빵집', '디저트', '규동', '돈카츠', '텐푸라', '오코노미야키', '타코야키', '호르몬', '술집', '미소카츠',
      '고토니', '편의점', '세븐일레븐', '로손', '패밀리마트', '식사', '조식', '중식', '석식', '점심', '저녁', '카츠', '덮밥'],
    교통: ['스이카', 'suica', 'icoca', '지하철', '전철', '전차', '버스', '택시', '신칸센', '공항', '철도', '교통',
      '리무진', '유리카모메', '센트레아', '하네다', '나리타', '주부', '승차', '운임', 'jr', '킷카', '노선'],
    쇼핑: ['돈키호테', '면세점', '면세', '드럭', '약국', '마트', '백화점', '유니클로', '무인양품', '기념품', '쇼핑',
      '스토어', '숍', '아울렛', '코스메', '화장품', '요도바시', '빅카메라', '전자제품', '라쿠텐', '마츠모토', '로프트'],
    관광: ['나고야성', '성', '신사', '사찰', '절', '박물관', '미술관', '전망대', '입장', '티켓', '공원', '온천',
      '유원지', '수족관', '동물원', '관광', '투어', '전망', '체험', '스카이']
  };

  // 한 줄에서 금액이 아닌 숫자(잔액·환율·수수료 등)를 먼저 걷어낸다.
  var META_NOISE = [
    /(?:적용\s*)?환율\s*[:：]?\s*[0-9][0-9,.]*/g,
    /수수료\s*면제\s*[0-9][0-9,.]*\s*원?/g,
    /수수료\s*[:：]?\s*[0-9][0-9,.]*\s*원?/g,
    /(?:이용|결제|승인|누적|잔여|한도|포인트)\s*(?:금액|한도|포인트)?\s*[:：]?\s*[0-9][0-9,.]*\s*원?/g
  ];

  function toHalf(s) {
    if (typeof s !== 'string') return '';
    return s
      .replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/\uFFE5/g, '¥')
      .replace(/[—–―~〜→➜➔]/g, function (ch) { return ch === '→' || ch === '➜' || ch === '➔' ? '→' : (ch === '—' || ch === '–' || ch === '―' ? '→' : '~'); });
  }

  function squeeze(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
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

  function detectYear(text, fallbackYear) {
    var full = String(text).match(/(20\d{2})\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}/);
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
    var kor = line.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (kor) return { month: Number(kor[1]), day: Number(kor[2]), text: kor[0] };
    var full = line.match(/(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
    if (full && Number(full[2]) >= 1 && Number(full[2]) <= 12 && Number(full[3]) >= 1 && Number(full[3]) <= 31) {
      return { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]), text: full[0] };
    }
    // `12.10 21:00` 처럼 뒤에 시각이 와도 날짜다. 소수·비율(857.63)은 월 범위에서 걸러진다.
    var md = line.match(/(?:^|[^0-9.\-\/:])(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?![\d])/);
    if (md && Number(md[1]) >= 1 && Number(md[1]) <= 12 && Number(md[2]) >= 1 && Number(md[2]) <= 31) {
      return { month: Number(md[1]), day: Number(md[2]), text: md[0].replace(/^[^0-9]/, '') };
    }
    return null;
  }

  function findTime(line) {
    var m = line.match(/(?:^|[^0-9])(\d{1,2}):(\d{2})(?!\d)/);
    if (!m) return null;
    var hour = Number(m[1]), minute = Number(m[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour: hour, minute: minute, text: m[1] + ':' + m[2] };
  }

  function findBalance(line) {
    var m = line.match(/잔\s*액\s*[:：]?\s*([0-9][0-9,]*)/);
    return m ? digits(m[1]) : null;
  }

  // 한 줄에서 금액을 찾는다. jpy → { amountJpy } / krw → { amountKrw }
  function findAmount(line, rate) {
    var jpy = line.match(/(?:JPY|¥)\s*([0-9][0-9,]*)/i);
    if (jpy) return { amountJpy: digits(jpy[1]), text: jpy[0] };
    var en = line.match(/([0-9][0-9,]*)\s*(?:엔|yen)/i);
    if (en) return { amountJpy: digits(en[1]), text: en[0] };
    var won = line.match(/([0-9][0-9,]*)\s*원/);
    if (won) {
      var krw = digits(won[1]);
      var amountJpy = rate > 0 ? Math.round(krw / rate) : 0;
      return { amountKrw: krw, amountJpy: amountJpy, text: won[0] };
    }
    var bare = line.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,})(?!\s*[0-9:])/);
    if (bare) return { amountJpy: digits(bare[1]), text: bare[0], bare: true };
    return null;
  }

  function stripText(line, snippet) {
    if (!snippet) return line;
    return line.split(snippet).join(' ');
  }

  // 통화 충전(하나머니 → JPY, 외화 환전)만 '지출 아님'이다.
  //   스이카·교통카드 '충전'은 실제 지출이라 그대로 둔다(디자인 시트의 스이카 충전 ¥6,000 = 교통).
  function looksLikeTopup(title) {
    var text = String(title || '');
    if (/충전/.test(text)) {
      return /(?:JPY|USD|EUR|엔|외화|머니|트래블|travel)/i.test(text) || /^\s*충전\s*$/.test(text);
    }
    return /환전|외화\s*충전|→\s*(?:JPY|USD|EUR)|(?:JPY|USD|EUR)\s*→|입금|top\s*up|charge\s*jpy/i.test(text);
  }

  function cleanTitle(raw) {
    var out = String(raw || '')
      .replace(/[<>]/g, ' ')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    out = out.replace(/^[-–—:·]+|[-–—:·]+$/g, '').trim();
    return out;
  }

  function isMetaOnly(line) {
    var rest = squeeze(String(line).replace(/[0-9]/g, '').replace(/[^가-힣a-zA-Z]/g, ''));
    return /^(잔액|적용환율|환율|수수료|면제|한도|잔여|누적|포인트|승인|카드|이용금액|결제예정|할부|취소)?$/.test(rest) ||
      /(잔액|적용환율|수수료|면제|한도|잔여|누적|승인번호|카드번호)/.test(line);
  }

  /**
   * 사진에서 읽은 글자 → 지출 후보 목록.
   * @param {string} text OCR 텍스트
   * @param {{trip?:object, rate?:number, fallbackYear?:number}} options
   */
  function parseCaptureText(text, options) {
    var opts = options || {};
    var rate = Number(opts.rate) > 0 ? Number(opts.rate) : 0;
    var trip = opts.trip || null;
    var fallbackYear = Number(opts.fallbackYear) || (trip && /^\d{4}/.test(String(trip.start || '')) ? Number(String(trip.start).slice(0, 4)) : new Date().getFullYear());
    var raw = toHalf(String(text || ''));
    var year = detectYear(raw, fallbackYear);
    var lines = raw.split(/\r?\n/).map(function (line) { return squeeze(line); }).filter(Boolean);

    var items = [];
    var currentDate = null;
    var pendingTitle = '';
    var lastRecord = null;
    var balanceJpy = null;
    var balanceAt = -1;

    function pushRecord(title, amount, time, dateOverride) {
      var date = dateOverride || currentDate;
      if (!date || !(amount.amountJpy > 0)) return;
      var rawTitle = cleanTitle(title);
      var matched = matchPlace(rawTitle, trip);
      // OCR 이 철자를 흘렸을 때만 일정 장소명으로 바꾼다. ‘스이카 충전’처럼 원문에 뜻이 더 있으면 원문을 둔다.
      var keepRaw = !matched || normalizeName(rawTitle).indexOf(normalizeName(matched.name)) >= 0;
      var name = matched && matched.score >= 0.7 && !keepRaw ? matched.name : rawTitle;
      var category = (matched && matched.category) || guessCategory(name + ' ' + rawTitle) || DEFAULT_CATEGORY;
      var isTopup = looksLikeTopup(rawTitle);
      if (isTopup && !/충전/.test(name)) name = (name || rawTitle) + ' 충전';
      var record = {
        title: name || category + ' 지출',
        rawTitle: rawTitle,
        amountJpy: Math.round(amount.amountJpy),
        amountKrw: amount.amountKrw || null,
        category: CATS.indexOf(category) >= 0 ? category : DEFAULT_CATEGORY,
        date: isoDate(date.year || year, date.month, date.day),
        time: time ? pad2(time.hour) + ':' + pad2(time.minute) : '',
        isTopup: isTopup,
        checked: !isTopup,
        matched: matched ? { name: matched.name, score: Math.round(matched.score * 100) / 100 } : null
      };
      items.push(record);
      lastRecord = record;
    }

    lines.forEach(function (line, index) {
      var work = line;

      // 잔액은 금액 계산에서 먼저 떼어 낸다(같은 줄에 금액이 있어도 놓치지 않게).
      var balance = findBalance(work);
      if (balance != null) {
        var bm = work.match(/잔\s*액\s*[:：]?\s*([0-9][0-9,]*)/);
        work = stripText(work, bm && bm[0] ? bm[0] : '');
        if (balance > 0 && index >= balanceAt) { balanceJpy = balance; balanceAt = index; }
      }
      META_NOISE.forEach(function (re) { work = work.replace(re, ' '); });

      var date = null;
      if (!isRangeLine(line)) {
        date = findDate(work);
        if (date) {
          work = stripText(work, date.text);
          currentDate = { year: date.year || year, month: date.month, day: date.day };
        }
      }
      var time = findTime(work);
      if (time) work = stripText(work, time.text);

      var amount = work && !isMetaOnly(work) ? findAmount(work, rate) : null;
      if (amount) work = stripText(work, amount.text);

      var topupWord = looksLikeTopup(cleanTitle(work));

      if (amount && amount.amountJpy > 0) {
        var title = cleanTitle(work);
        if (!title || /^[0-9,.\s]+$/.test(title) || title.length < 2) title = pendingTitle || lastRecord && lastRecord.rawTitle || '';
        pushRecord(title, amount, time, date || currentDate);
        if (topupWord && lastRecord && lastRecord.amountJpy === Math.round(amount.amountJpy)) lastRecord.isTopup = true;
        if (lastRecord) lastRecord.checked = !lastRecord.isTopup;
      } else if (lastRecord) {
        // 금액 없이 이어지는 줄(시각·충전 표시·잔액)은 바로 앞 내역의 정보를 채운다.
        if (time && !lastRecord.time) lastRecord.time = pad2(time.hour) + ':' + pad2(time.minute);
        if (topupWord) {
          lastRecord.isTopup = true; lastRecord.checked = false;
          if (!/충전/.test(lastRecord.title)) lastRecord.title += ' 충전';
        }
        if (balance != null && lastRecord.balanceJpy == null) lastRecord.balanceJpy = balance;
      }

      var leftover = cleanTitle(work);
      if (!amount && leftover && leftover.length >= 2 && !isMetaOnly(leftover) && !date && !time) {
        pendingTitle = leftover;
      }
    });

    // 충전 합계(지출에서 빼는 금액)와 정렬: 지출 먼저(날짜·시각 오름차순), 충전은 맨 아래.
    var topupJpy = 0;
    items.forEach(function (item) { if (item.isTopup) topupJpy += item.amountJpy; });
    items.sort(function (a, b) {
      if (a.isTopup !== b.isTopup) return a.isTopup ? 1 : -1;
      var da = (a.date || '') + ' ' + (a.time || '');
      var db = (b.date || '') + ' ' + (b.time || '');
      return da.localeCompare(db);
    });
    items.forEach(function (item, index) { item.id = 'cap-' + index; });

    return {
      items: items,
      balanceJpy: balanceJpy,
      topupJpy: topupJpy,
      year: year,
      count: items.length,
      expenses: items.filter(function (item) { return !item.isTopup; }).length
    };
  }

  var api = {
    CATS: CATS,
    parseCaptureText: parseCaptureText,
    guessCategory: guessCategory,
    matchPlace: matchPlace,
    similarity: similarity
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.ViagoExpenseCapture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
