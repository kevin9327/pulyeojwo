// 이 기기에서 돌아가는 분석 엔진(AI 키 없이 동작). 브라우저와 Node 양쪽에서 쓰는 순수 함수 모음.
// 날짜·금액·연락처 추출, 사기 의심 점검, 할 일/불이익 문장 찾기, 캘린더(.ics) 만들기,
// 그리고 AI 답을 원문과 맞춰 보는 '검증기'가 여기에 있다.
import { GLOSSARY } from './glossary.js';

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function normalizeText(s) {
  // 전각 글자는 반각으로(NFKC), 보이지 않는 글자(제로폭 등)는 지워 위장 문구를 막는다. 아주 긴 글은 3만 자까지만 본다.
  return String(s ?? '').normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff\u202a-\u202e]/g, '').replace(/[\u2010-\u2015\u2212]/g, '-').slice(0, 30000).replace(/\r\n?/g, '\n').replace(/[ \t\u00a0\u3000]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

function validDate(y, m, d) {
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
export function daysBetween(isoA, isoB) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(isoB) - t(isoA)) / 864e5);
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// '오늘 중·금일까지·내일까지·모레까지' 같은 상대 기한을 기준일(오늘 날짜)에 맞춰 ISO 날짜로 읽는다. 기준일이 없으면 빈 목록.
const RE_REL_DAY = /(오늘|금일|내일|모레)\s*(중|까지|이내|안에|내)(?![가-힣])/g;
const REL_OFFSET = { 오늘: 0, 금일: 0, 내일: 1, 모레: 2 };
export function findRelativeDueDates(text, base) {
  if (!base) return [];
  const t = String(text ?? '');
  return [...t.matchAll(RE_REL_DAY)].map((m) => ({ iso: addDays(base, REL_OFFSET[m[1]]), raw: m[0], index: m.index, end: m.index + m[0].length, role: relRole(t, m) }));
}
// '내일까지' 처럼 끝맺음이 있으면 기한, '오늘 중 …' 은 뒤 문장이 받는 사람에게 시키는 말일 때만 기한('오늘 중 대출금이 지급됩니다' 는 기한이 아니다)
function relRole(t, m) {
  if (/^(까지|이내|안에|내)$/.test(m[2])) return 'deadline';
  const rest = t.slice(m.index + m[0].length, m.index + m[0].length + 80).split(String.fromCharCode(10))[0];
  return /(납부|제출|확인|신청|등록|인증|연락|입금해|변경|방문|접수|회신|답변|클릭|접속|하여\s*주|하시기|해\s*주|바랍니다|하세요|않으면|않을\s*경우)/.test(rest) ? 'deadline' : 'other';
}
export const relativeDueDates = (text, base) => new Set(findRelativeDueDates(text, base).map((d) => d.iso));

// ---------------------------------------------------------------- 날짜
const RE_FULL = /(\d{4})\s*(?:년|[.\-/])\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})(?!\d)\s*(?:일|\.)?(?:\s*\(\s*([월화수목금토일])(?:요일)?\s*\))?/g;
const RE_MD = /(?<![\d.])(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\(\s*([월화수목금토일])(?:요일)?\s*\))?/g;
// '26.11.30 / '26.11.30(월) 같은 두 자리 연도: 따옴표가 있거나 뒤에 요일·까지·이내가 있을 때만 날짜로 본다(버전 번호 같은 오인을 피함)
const RE_YY = /(?<![\d.])(['’]?)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)\.?(?:\s*\(\s*([월화수목금토일])(?:요일)?\s*\))?/g;
// 11/13까지, 11.13.(금) 처럼 연도 없이 월·일만 쓴 약식(뒤에 까지·이내·요일이 있을 때만)
const RE_SHORT = /(?<![\d./])(\d{1,2})\s*[./]\s*(\d{1,2})\.?(?=\s*(?:\(\s*[월화수목금토일]|까지|이내))(?:\s*\(\s*([월화수목금토일])(?:요일)?\s*\))?/g;
// '12월 말까지'(말일), '익월 10일'·'당월 5일'(기준일의 달 기준, 기준일이 있을 때만) — 근사값이라 yearInferred 로 표시한다
const RE_EOM = /(?<![\d.])(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(?:말일|말(?!씀|미|고|엽))/g;
const RE_REL = /(익월|차월|다음\s*달|당월|이번\s*달|이달)\s*(\d{1,2})\s*일(?:\s*\(\s*([월화수목금토일])(?:요일)?\s*\))?/g;
const RE_TIME = /^[\s,]*(?:(오전|오후)\s*)?(\d{1,2})\s*(?::|시(?!간))\s*(\d{2})?\s*(?:분)?/;

function timeAfter(text, end) {
  const m = text.slice(end, end + 14).match(RE_TIME);
  if (!m) return null;
  let h = Number(m[2]);
  const mi = m[3] ? Number(m[3]) : 0;
  if (h > 24 || mi > 59 || (h === 24 && mi > 0) || h === 24) return null; // 24:00(자정까지)은 시각 없는 종일 일정으로
  if (m[1] === '오후' && h < 12) h += 12;
  if (m[1] === '오전' && h === 12) h = 0;
  return `${pad(h)}:${pad(mi)}`;
}

function roleOf(text, start, end) {
  const before = text.slice(Math.max(0, start - 22), start);
  const after = text.slice(end, end + 24);
  const lineBefore = before.split('\n').pop();
  let lineAfter = after.split('\n')[0];
  const tm = lineAfter.match(RE_TIME);
  if (tm) lineAfter = lineAfter.slice(tm[0].length); // '2026. 11. 9.(월) 18:00까지' 처럼 시각이 끼어 있어도 '까지'를 찾는다
  if (/^[\s)]*(?:에\s*)?(?:자동\s*)?(?:출금|결제|이체|납부)\s*(?:이\s*)?(?:예정|됩니다|됨|되오니|될)/.test(lineAfter)) return 'deadline';   // '11월 10일 출금 예정'
  if (/^\s*~/.test(lineAfter)) return 'other'; // '11월 2일 ~ 11월 6일' 의 앞쪽(시작일)은 기한이 아니다
  if (/^[\s)]*(?:까지|이내|전까지|마감|이전|내로|안에)/.test(lineAfter) || /~\s*$/.test(lineBefore) || /(기한|마감일?|기간|납기일?|납부일|납입일|제출일|결제일|출금일|이체일|입금일|접수일|신청일)\s*(?:은|는|이|가)?\s*[:：]?\s*(?:은|는|이|가)?\s*$/.test(lineBefore)) return 'deadline';
  if (/(발송|발행|작성|통지|고지|부과|공고|시행|발급|납부기한 경과)\s*일?\s*[:：]?\s*$/.test(lineBefore)) return 'reference';
  if (/(일시|장소|개최|행사|방문|참석|면담|출석|상담|예약|진료|검진|수술|입원|훈련|교육|설명회|시험|면접)/.test(lineBefore + lineAfter)) return 'event';
  if (tm) return 'event'; // 기한 표시 없이 시각이 붙은 날짜는 만나는 시각(일정)으로 본다
  return 'other';
}

const RE_SHORT_L = /(?<![\d./])(\d{1,2})\s*[./]\s*(\d{1,2})\.?(?!\d)(?!\s*[./]\s*\d)(?:\s*\(\s*([월화수목금토일])(?:요일)?\s*\))?/g;
// 날짜 바로 앞에 ‘기한·마감일·납부일…:’ 같은 표시가 있는지
const DEADLINE_LABEL_BEFORE = (text, idx) => /(기한|마감일?|납기일?|납부일|제출일|결제일|출금일|이체일|입금일|납부\s*마감|접수\s*마감)\s*[:：]?\s*$/.test(text.slice(Math.max(0, idx - 16), idx));
export function extractDates(text, { base } = {}) {
  const out = [];
  const taken = [];
  const baseIso = base || null;
  for (const m of text.matchAll(RE_FULL)) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (!validDate(y, mo, d)) continue;
    const iso = isoOf(y, mo, d);
    taken.push([m.index, m.index + m[0].length]);
    out.push(build(text, m, iso, m[4], false));
  }
  for (const m of text.matchAll(RE_MD)) {
    const s = m.index, e = s + m[0].length;
    if (taken.some(([a, b]) => s < b && e > a)) continue;
    const mo = Number(m[1]), d = Number(m[2]);
    let y = baseIso ? Number(baseIso.slice(0, 4)) : new Date().getFullYear();
    if (!validDate(y, mo, d)) continue;
    let iso = isoOf(y, mo, d);
    const pastWord = /(지난|앞서|전월|이전)\s*$/.test(text.slice(Math.max(0, s - 6), s));   // '지난 8월 20일' 은 올해의 지난 날짜
    if (!pastWord && baseIso && daysBetween(baseIso, iso) < -60) { y += 1; if (!validDate(y, mo, d)) continue; iso = isoOf(y, mo, d); }
    const dd = build(text, m, iso, m[3], true);
    if (pastWord) dd.role = 'reference';
    out.push(dd);
    taken.push([s, e]);
  }
  for (const m of text.matchAll(RE_YY)) {
    const s = m.index, e = s + m[0].length;
    if (taken.some(([a, b]) => s < b && e > a)) continue;
    const y = 2000 + Number(m[2]), mo = Number(m[3]), d = Number(m[4]);
    if (!validDate(y, mo, d) || y < 2020 || y > 2040) continue;
    const after = text.slice(s + m[0].length, s + m[0].length + 8);
    if (!m[1] && !m[5] && !/^\s*(?:까지|이내)/.test(after) && !DEADLINE_LABEL_BEFORE(text, s)) continue;
    out.push(build(text, m, isoOf(y, mo, d), m[5], false)); taken.push([s, e]);
  }
  for (const m of text.matchAll(RE_SHORT)) {
    const s = m.index, e = s + m[0].length;
    if (taken.some(([a, b]) => s < b && e > a)) continue;
    const mo = Number(m[1]), d = Number(m[2]);
    let y = baseIso ? Number(baseIso.slice(0, 4)) : new Date().getFullYear();
    if (!validDate(y, mo, d)) continue;
    let iso = isoOf(y, mo, d);
    if (baseIso && daysBetween(baseIso, iso) < -60) { y += 1; if (!validDate(y, mo, d)) continue; iso = isoOf(y, mo, d); }
    out.push(build(text, m, iso, m[3], true)); taken.push([s, e]);
  }
  for (const m of text.matchAll(RE_SHORT_L)) {   // 기한 표시가 바로 앞에 있는 ‘11. 20.’·‘11/20’
    const s = m.index, e = s + m[0].length;
    if (taken.some(([a, b]) => s < b && e > a) || !DEADLINE_LABEL_BEFORE(text, s)) continue;
    const mo = Number(m[1]), d = Number(m[2]);
    let y = baseIso ? Number(baseIso.slice(0, 4)) : new Date().getFullYear();
    if (!validDate(y, mo, d)) continue;
    let iso = isoOf(y, mo, d);
    if (baseIso && daysBetween(baseIso, iso) < -60) { y += 1; if (!validDate(y, mo, d)) continue; iso = isoOf(y, mo, d); }
    out.push(build(text, m, iso, m[3], true)); taken.push([s, e]);
  }
  for (const m of text.matchAll(RE_EOM)) {
    const s = m.index, e = s + m[0].length;
    if (taken.some(([a, b]) => s < b && e > a)) continue;
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) continue;
    let y = m[1] ? Number(m[1]) : (baseIso ? Number(baseIso.slice(0, 4)) : new Date().getFullYear());
    const last = (yy) => new Date(Date.UTC(yy, mo, 0)).getUTCDate();
    let iso = isoOf(y, mo, last(y));
    if (!m[1] && baseIso && daysBetween(baseIso, iso) < -60) { y += 1; iso = isoOf(y, mo, last(y)); }
    out.push(build(text, m, iso, null, !m[1])); taken.push([s, e]);
  }
  if (baseIso) {
    for (const m of text.matchAll(RE_REL)) {
      const s = m.index, e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      const next = /^(익월|차월|다음)/.test(m[1]);
      let y = Number(baseIso.slice(0, 4)), mo = Number(baseIso.slice(5, 7)) + (next ? 1 : 0);
      if (mo > 12) { mo -= 12; y += 1; }
      const d = Number(m[2]);
      if (!validDate(y, mo, d)) continue;
      out.push(build(text, m, isoOf(y, mo, d), m[3], true)); taken.push([s, e]);
    }
  }
  return out.sort((a, b) => a.index - b.index);

  function build(t, m, iso, wd, inferred) {
    const index = m.index; let end = index + m[0].length;
    const real = weekdayOf(iso);
    const bare = !wd && t.slice(end).match(/^\s*([월화수목금토일])요일/);   // '12월 4일 금요일 오후 5시까지' 처럼 괄호 없는 요일
    if (bare) { wd = bare[1]; end += bare[0].length; }
    return { iso, raw: t.slice(index, end).trim(), index, end, time: timeAfter(t, end), role: roleOf(t, index, end), weekdayGiven: wd || null, weekdayMismatch: !!wd && wd !== real, weekday: real, yearInferred: inferred };
  }
}

export function extractRelativeDeadlines(text) {
  const out = [];
  const PER_UNIT = { 일: 1, 주: 7, 주일: 7, 개월: 30, 달: 30 };
  for (const m of text.matchAll(/([^\n.。]{0,24}?)(\d{1,3})\s*(일|주일|주|개월|달)\s*(이내|안에|내에)/g)) {
    let pre = m[1];
    const cut = Math.max(pre.lastIndexOf(','), pre.lastIndexOf('，'), pre.lastIndexOf(';'));   // 앞 절은 떼고 가까운 구절만
    if (cut >= 0) pre = pre.slice(cut + 1);
    if (m.index > 0 && pre === m[1] && pre && !/\s/.test(text[m.index - 1] ?? ' ')) pre = pre.replace(/^[^\s]*\s?/, '');   // 낱말 중간에서 잘린 앞머리는 버린다
    out.push({ phrase: (pre + m[2] + m[3] + ' ' + m[4]).trim(), days: Number(m[2]) * PER_UNIT[m[3]], index: m.index });
  }
  return out;
}

// ---------------------------------------------------------------- 금액
export function parseKoreanWon(raw) {
  let total = 0, section = 0;
  for (const m of raw.matchAll(/(\d[\d,]*(?:\.\d+)?)?\s*(억|만|천|백)?/g)) {
    if (!m[1] && !m[2]) continue;
    const n = m[1] ? parseFloat(m[1].replace(/,/g, '')) : 0;
    const u = m[2];
    if (u === '천') section += (n || 1) * 1000;
    else if (u === '백') section += (n || 1) * 100;
    else if (u === '만') { total += (section + n) * 1e4; section = 0; }
    else if (u === '억') { total += (section + n) * 1e8; section = 0; }
    else section += n;
  }
  return Math.round(total + section);
}

const LABEL_WORDS = ['합계', '장기요양보험료', '건강보험료', '국민연금', '과태료', '가산금', '월 임대료', '임대료', '보증금', '참가비', '수수료', '환급금', '지원금', '납부금액', '세액', '요금', '체납'];
function amountLabel(text, index, kind) {
  const win = text.slice(Math.max(0, index - 26), index);
  let best = null;
  for (const w of LABEL_WORDS) { const i = win.lastIndexOf(w); if (i >= 0 && (!best || i > best.i)) best = { w, i }; }
  if (best) return best.w;
  const last = win.match(/([가-힣]{2,})[^가-힣]*$/);
  return last ? last[1] : kind === 'receive' ? '받을 돈' : '금액';
}

const isDigit = (c) => c >= '0' && c <= '9';
const isUnit = (c) => c === '억' || c === '만' || c === '천' || c === '백';
const PARTICLE_START = '을이은는에의으로짜씩도과와부터까지정가내입인임만';

// '원'을 찾아 뒤로 걸으며 숫자·쉼표·소수점·단위를 모은다. 정규식의 중첩 반복이 없어 아무리 긴 숫자열이 와도 선형 시간.
export function extractAmounts(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '원') continue;
    const nx = text[i + 1];
    if (nx && /[가-힣]/.test(nx) && !PARTICLE_START.includes(nx) && text.slice(i + 1, i + 3) !== '어치') continue; // 원문·원래·원칙 … ('30만원어치' 는 금액)
    let j = i - 1;
    while (j >= 0 && (text[j] === ' ' || text[j] === '\u00a0')) j--;
    if (j < 0 || !(isDigit(text[j]) || isUnit(text[j]))) continue;
    let k = j, steps = 0;
    while (k >= 0 && steps < 40) {
      const c = text[k];
      if (isDigit(c) || isUnit(c) || c === ',') { k--; steps++; continue; }
      if (c === '.' && k > 0 && isDigit(text[k - 1]) && isDigit(text[k + 1] || '')) { k--; steps++; continue; }
      if (c === ' ' && k > 0 && k < j && (isUnit(text[k - 1]) || isUnit(text[k + 1]))) { k--; steps++; continue; }
      break;
    }
    let start = k + 1;
    while (start <= j && !isDigit(text[start])) start++;
    const numStr = text.slice(start, j + 1).trim();
    if (!numStr || !isDigit(numStr[0])) continue;
    const krw = parseKoreanWon(numStr);
    if (!krw && !/^0$/.test(numStr)) continue;   // '0원'(본인부담금 0원 등)은 금액이다. '00원' 같은 이상한 꼴은 건너뛴다
    const ctx = text.slice(Math.max(0, start - 24), i + 13);
    const kind = /(환급|지급|지원금|돌려|수령|받으실)/.test(ctx) ? 'receive' : /(납부|납입|청구|부과|고지|징수|내야|미납|체납|연체|입금|과태료|보험료|세액)/.test(ctx) ? 'pay' : 'other';
    out.push({ krw, raw: text.slice(start, i + 1).trim(), index: start, kind, label: amountLabel(text, start, kind), context: ctx.replace(/\s+/g, ' ').trim(), before: text.slice(Math.max(0, start - 10), start) });
  }
  for (const o of extractOtherAmounts(text)) {
    if (out.some((a) => a.index <= o.index && a.index + a.raw.length >= o.endIndex)) continue;
    const ctx = text.slice(Math.max(0, o.index - 24), o.endIndex + 13);
    const kind = /(환급|지급|지원금|돌려|수령|받으실)/.test(ctx) ? 'receive' : /(납부|납입|청구|부과|고지|징수|내야|미납|체납|연체|입금|과태료|보험료|세액)/.test(ctx) ? 'pay' : 'other';
    out.push({ krw: o.krw, raw: o.raw, index: o.index, kind, label: amountLabel(text, o.index, kind), context: ctx.replace(/\s+/g, ' ').trim(), before: text.slice(Math.max(0, o.index - 10), o.index) });
  }
  return out.sort((a, b) => a.index - b.index);
}

const HANGUL_DIGIT = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
export function parseHangulNum(s) {
  let total = 0, section = 0, cur = 0;
  for (const ch of s) {
    if (ch in HANGUL_DIGIT) cur = cur * 10 + HANGUL_DIGIT[ch];
    else if (ch === '십') { section += (cur || 1) * 10; cur = 0; }
    else if (ch === '백') { section += (cur || 1) * 100; cur = 0; }
    else if (ch === '천') { section += (cur || 1) * 1000; cur = 0; }
    else if (ch === '만') { total += (section + cur || 1) * 1e4; section = 0; cur = 0; }
    else if (ch === '억') { total += (section + cur || 1) * 1e8; section = 0; cur = 0; }
  }
  return total + section + cur;
}

// '₩320,000' 과 '삼십이만원' 같은 표기까지 읽는다(원 앞 숫자 스캔과 별도 경로)
function extractOtherAmounts(text) {
  const out = [];
  for (const m of text.matchAll(/₩\s*(\d[\d,]{0,15})/g)) {
    const krw = parseInt(m[1].replace(/,/g, ''), 10);
    if (krw) out.push({ krw, raw: m[0], index: m.index, endIndex: m.index + m[0].length });
  }
  for (const m of text.matchAll(/(?:(?<![가-힣])|(?<=일금\s?))([일이삼사오육칠팔구영공십백천만억]{2,12})\s*원/g)) {
    if (!/[십백천만억]/.test(m[1])) continue;
    const nx = text[m.index + m[0].length];
    if (nx && /[가-힣]/.test(nx) && !PARTICLE_START.includes(nx)) continue;
    const krw = parseHangulNum(m[1]);
    if (krw) out.push({ krw, raw: m[0], index: m.index, endIndex: m.index + m[0].length });
  }
  return out;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const formatWon = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

// '합계 210,200원' 같은 표기가 같은 목록(같은 줄, 또는 금액이 이어지는 위쪽 줄들)의 금액을 모두 더한 값과 맞는지 검산한다(AI 없이).
export function checkTotals(amounts, text = '') {
  const out = [];
  const lineStart = (idx) => (text ? text.lastIndexOf('\n', idx - 1) + 1 : 0);
  amounts.forEach((a, i) => {
    if (!/(합계|총액|총\s*납부|합산|총\s*금액)/.test(a.before)) return;
    // 같은 줄에서 합계 앞쪽 + 바로 위쪽 줄들(금액이 있는 줄이 이어지는 동안)
    const ls = lineStart(a.index);
    const group = [];
    let from = ls;
    for (let guard = 0; guard < 8 && from >= 0; guard++) {
      const lineAmts = amounts.filter((p, j) => j < i && p.index >= from && p.index < (guard === 0 ? a.index : lineEnd(from)));
      if (guard > 0 && !lineAmts.length) break;
      group.unshift(...lineAmts);
      if (from === 0) break;
      from = lineStart(from - 1);
    }
    const prev = group.filter((p) => p.krw > 0 && (p.krw !== a.krw || group.length === 1));   // 0원 항목은 합계의 구성 요소로 세지 않는다
    if (prev.length < 2) return;
    const sum = prev.reduce((s, p) => s + p.krw, 0);
    out.push(sum === a.krw ? { total: a.krw, parts: prev.map((p) => p.krw), ok: true } : { total: a.krw, parts: prev.map((p) => p.krw), ok: false, sum });
  });
  return out;
  function lineEnd(ls) { const e = text.indexOf('\n', ls); return e < 0 ? text.length : e; }
}

// ---------------------------------------------------------------- 연락처·계좌·링크
const BANK_WORDS = /(은행|농협|신협|새마을|우체국|계좌|입금|가상계좌|국민|신한|우리|하나|기업|카카오뱅크|토스뱅크|케이뱅크)/;
export function extractAccounts(text) {
  const out = [];
  for (const m of text.matchAll(/(?<!\d)(\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,4})?)(?!\d)/g)) {
    const ctx = text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 6);
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(m[1]) && validDate(...m[1].split('-').map(Number));
    if (!isDate && BANK_WORDS.test(ctx) && !/(?:0\d{1,2}-\d{3,4}-\d{4})/.test(m[0])) out.push({ raw: m[1], index: m.index, context: ctx.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

export function extractPhones(text) {
  const out = [];
  for (const m of text.matchAll(/(?<!\d)(0\d{1,2}-\d{3,4}-\d{4}|1[5-9]\d{2}-\d{4}|0\d{9,10})(?!\d)/g)) out.push({ raw: m[1], index: m.index });
  return out;
}

export const SHORTENERS = ['bit.ly', 'vo.la', 'me2.kr', 'url.kr', 'han.gl', 't.ly', 'goo.gl', 'is.gd', 'tinyurl.com', 'buly.kr', '9m.kr', 'naver.me', 'zrr.kr', 'c11.kr', 'cutt.ly', 'rb.gy', 'shorturl.at', 'lrl.kr', 't.co', 'ow.ly', 'buff.ly', 'tiny.cc', 'v.gd', 'rebrand.ly', 'shorturl.asia', 'bitly.com', 'urlzs.com'];

export function extractUrls(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\w@.-])((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s)>\]」』"']*)?)/gi)) {
    const raw = m[1].replace(/[.,;:]+$/, '');
    if (/^\d+(\.\d+)+$/.test(raw)) continue;
    if (!/^https?:\/\//i.test(raw) && !/\.(kr|com|net|org|me|cc|io|co|ly|la|gl|app|site|top|xyz|info|biz|shop|link|click|vip|cn|ru|tk|icu|live|online|store|buzz|cyou|work)(?:[:/]|$)/i.test(raw)) continue;
    if (!/^https?:\/\//i.test(raw) && text[m.index + m[1].length] === '@') continue; // 이메일 앞부분(park.kr@gmail.com 의 park.kr)
    let host = raw.replace(/^https?:\/\//i, '').split(/[/:?#]/)[0].toLowerCase();
    // https://www.nts.go.kr@evil.example.com 처럼 '@' 앞은 아이디일 뿐, 실제 접속지는 @ 뒤다
    const deceptive = /^https?:\/\//i.test(raw) && text[m.index + m[1].length] === '@';
    if (deceptive) { const rest = text.slice(m.index + m[1].length + 1).match(/^[^\s/:?#)\]]+/); host = (rest ? rest[0] : host).toLowerCase(); }
    out.push({ raw, host, index: m.index, deceptive, shortened: SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`)), officialGov: !deceptive && /(^|\.)(go|mil)\.kr$|(^|\.)gov\.kr$|(^|\.)korea\.kr$/.test(host) });
  }
  return out;
}

export function extractEmails(text) {
  return [...text.matchAll(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}/g)].map((m) => ({ raw: m[0], index: m.index }));
}

// ---------------------------------------------------------------- 사기 의심 점검
const SCAM_RULES = [
  { id: 'safe-account', compact: true, label: '‘안전계좌’로 돈을 옮기라는 요구', pts: 45, re: /(안전\s*계좌|국가\s*안전|자산\s*보호\s*(조치|계좌)|검수\s*계좌)/g },
  { id: 'secret-info', label: '비밀번호·인증번호·주민번호 뒷자리를 묻는 말', pts: 40, re: /(비밀번호|인증번호|OTP|보안카드|주민(등록)?번호\s*(뒷|전체)|CVC|카드\s*번호\s*(전체|입력))/g, warnable: true },
  { id: 'app-install', label: '앱 설치·원격 제어를 요구', pts: 35, re: /(\.apk|앱\s*설치|원격\s*(제어|지원|프로그램)|애플리케이션\s*설치|보안\s*앱)/g },
  { id: 'authority-threat', label: '수사·사법기관을 내세운 협박·송금 요구', pts: 30, re: /(검찰|지검|검사관|수사관|경찰|법원|금융감독원|금감원)/g, and: /(체포|구속|고소\s*접수|범죄\s*연루|계좌\s*동결|송금|이체|안전\s*계좌|출석\s*불응|형사\s*처벌|대포\s*통장|명의\s*(?:가\s*)?(?:도용|개설)|출석\s*요구|적발)/ },
  { id: 'urgent', label: '지금 당장 하라는 재촉', pts: 15, re: /(즉시|오늘\s*중|금일\s*중|지금\s*바로|\d{1,3}\s*시간\s*이내|압류\s*예정|법적\s*조치|마지막\s*(안내|통보)|미이행\s*시)/g },
  { id: 'refund-lure', label: '미수령 환급금·당첨 등 달콤한 미끼', pts: 20, re: /(미수령\s*환급|환급금\s*(조회|지급)|당첨|무료\s*(지급|쿠폰)|지원금\s*신청\s*링크|환급\s*대상)/g },
  { id: 'loan', label: '대출 상담·저금리 대환 권유', pts: 25, re: /(저금리\s*대환|대환대출|대출\s*(승인|가능|상담)|한도\s*조회)/g },
  { id: 'parcel', label: '택배·주소 불명을 내세운 링크 유도', pts: 20, re: /(택배|배송|주소\s*(불명|확인)|미배송|반송|\b(?:parcel|package|delivery|shipment|customs)\b)/gi },
  { id: 'gift-card', compact: true, label: '상품권 핀번호·구매 대행 요구', pts: 35, re: /(문화\s*상품권|구글\s*기프트|기프트\s*카드|상품권\s*(?:구매|핀|번호)|핀\s*번호)/g },
  { id: 'crime-pretext', compact: true, label: '계좌가 범죄에 연루됐다며 겁을 주는 말', pts: 30, re: /(범죄에\s*연루|명의\s*도용|계좌\s*(?:가\s*)?(?:동결|지급\s*정지)|수사\s*중인\s*사건)/g, and: /(이체|송금|입금|계좌)/ },
  { id: 'secrecy', label: '이 일을 남에게 알리지 말라는 입단속', pts: 30, re: /(이\s*(?:사실|내용|건|사건|통화|연락)[을를은는]?\s*(?:절대\s*)?(?:타인|누구|가족|주변\s*사람|은행\s*직원)\S*\s*(?:절대\s*)?(?:알리지|말하지|발설하지|공유하지)|비밀(?:로)?\s*(?:을\s*)?(?:유지|지켜)|아무에게도\s*(?:말|알리))/g },
  { id: 'advance-fee', compact: true, label: '먼저 돈을 보내라는 요구(선입금·선납)', pts: 35, re: /(선\s*입금|선\s*납부|선\s*결제|먼저\s*(?:입금|송금|보내))/g },
  { id: 'job-lure', label: '고수익 재택·대행 알바로 끌어들이는 말', pts: 20, re: /(재택\s*(?:근무|알바)|일당\s*\d|부업|구매\s*대행|리뷰\s*알바|오픈\s*채팅)/g },
  { id: 'invest', label: '투자방·고수익 리딩 유도', pts: 30, re: /(리딩\s*방|투자\s*방|수익\s*(?:보장|인증)|월\s*\d+\s*%)/g },
  { id: 'principal', label: '‘원금 보장’을 내세운 고수익 유도', pts: 30, re: /원금\s*보장/g, and: /(수익률?|투자|리딩|배당|코인|주식)/ },
  { id: 'impersonate-kin', label: '가족·지인을 사칭해 폰 고장 뒤 송금 요구', pts: 40, re: /(엄마|아빠|아들|딸|나야)[^.\n]{0,20}(폰|핸드폰|휴대폰)\s*(?:고장|액정|분실)/g, and: /(송금|입금|이체|계좌|상품권|핀\s*번호|링크|https?:|인증|돈|결제)/ },
  { id: 'new-number-kin', label: '가족을 사칭해 ‘폰·번호를 바꿨다’며 메신저 추가를 유도', pts: 30, re: /(엄마|아빠|아들|딸|나야)[^.\n]{0,20}(?:폰|핸드폰|휴대폰|번호)\s*(?:을\s*)?(?:바꿨|바뀌|변경|새로)/g, and: /(카톡|톡|저장|추가|문자|연락)/ },
  { id: 'prompt-injection', label: '문서 속에 AI에게 내리는 숨은 지시문(프롬프트 주입 시도)', pts: 35, re: /(이전\s*(?:의\s*)?(?:모든\s*)?(?:지시|명령|지침)[^.\n]{0,12}(?:무시|잊)|위\s*(?:의\s*)?(?:지시|명령)[^.\n]{0,8}무시|ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?)|system\s*prompt|시스템\s*프롬프트|(?:사기|위험)\s*(?:가\s*)?아니(?:라고|다고)\s*(?:답|말|써|출력)|안전하(?:다고|게)\s*(?:답|말|써|출력))/gi },
  { id: 'overseas-pay', label: '결제 알림을 내세워 전화를 유도', pts: 35, re: /(해외\s*(?:결제|승인|출금)|결제\s*(?:완료|승인)|출금\s*완료)/g, and: /(?<!\d)(?:1[5-9]\d{2}-\d{4}|0\d{1,2}-\d{3,4}-\d{4}|0\d{9,10})(?!\d)/ },
];

const SUSPICIOUS_TLD = /\.(?:top|xyz|cc|click|vip|site|shop|work|link|icu|live|online|store|buzz|cyou|tk|ru|cn)(?:[:/]|$)/i;
const BRANDS = /(토스|카카오|네이버|쿠팡|신한|국민은행|우리은행|하나은행|농협|우체국|CJ|한진|롯데택배|건강보험|국세청|경찰청|금감원|홈택스|정부24)/;
// 정확한 공식 도메인만 인정(toss-pay.cc 처럼 상표를 앞에 붙인 가짜는 인정하지 않는다)
const BRAND_DOMAINS = ['shinhancard.com', 'kbcard.com', 'samsungcard.com', 'hyundaicard.com', 'lottecard.co.kr', 'bccard.com', 'nhcard.com', 'toss.im', 'tossbank.com', 'kakao.com', 'kakaocorp.com', 'kakaobank.com', 'naver.com', 'coupang.com', 'shinhan.com', 'shinhanbank.com', 'kbstar.com', 'wooribank.com', 'hanabank.com', 'nonghyup.com', 'epost.go.kr', 'cjlogistics.com', 'hanjin.com', 'lotteglogis.com', 'nhis.or.kr', 'nts.go.kr', 'hometax.go.kr', 'gov.kr', 'police.go.kr', 'fss.or.kr'];
// gov-kr.com·go-kr.net·kr-gov.com·gov24-xx.com·nts-refund.com 처럼 공공기관 주소를 흉내 낸 호스트
const LOOKALIKE_GOV = /(?:^|[.-])(?:gov|go)[-_]?kr(?:[.-]|$)|(?:^|[.-])kr[-_]?(?:gov|go)(?:[.-]|$)|gov[-_]?24|hometax|(?:^|[.-])(?:nts|nhis|police|bokjiro)(?:[-.]|$)/i;
const BRAND_TOKENS = /(naver|kakao|toss|coupang|shinhan|woori|hanabank|nonghyup|kbstar|samsungcard|hyundaicard|lottecard|cjlogistics|hanjin)/i;
const lineAt = (text, idx) => { const a = text.lastIndexOf('\n', idx - 1) + 1; const b = text.indexOf('\n', idx); return text.slice(a, b < 0 ? text.length : b); };
const isBrandDomain = (host) => BRAND_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));

// 문장 하나를 잘라 낸다(앞뒤 마침표·줄바꿈까지)
function sentenceAt(text, idx) {
  let a = idx, b = idx;
  while (a > 0 && !/[.!?\n]/.test(text[a - 1])) a--;
  while (b < text.length && !/[.!?\n]/.test(text[b])) b++;
  return text.slice(a, b);
}
const WARNING_PHRASE = /(묻지|요구하지|알려\s*주지|알려\s*달라고\s*하지|공유하지|절대|유출|주의하세요|조심|타인에게|남에게)/;
// '알려주지 마세요'(경고)와 '알려 주세요'(요구)를 구분한다: 입력 요청은 정상 OTP에도 있으므로 '알려 달라·불러 달라·말씀' 같은 직접 요구만 본다
const REQUEST_PHRASE = /(알려\s*(?:주시|주세요|주십시오|달라|줘)|불러\s*(?:주|달)|말씀\s*(?:해|하)|보내\s*(?:주|달)|전송\s*(?:해|바)|제공\s*(?:해|바)|링크.{0,12}(?:입력|접속|클릭))/;

export function scamCheck(text, { urls = extractUrls(text), dates = extractDates(text) } = {}) {
  const reasons = [];
  const add = (label, evidence, pts) => reasons.push({ label, evidence, pts });
  const compact = text.replace(/(?<=[가-힣])[\s.·ㆍ‧]+(?=[가-힣])/g, '');   // '안 전 계 좌' 처럼 글자 사이를 띄워 피하는 수법
  for (const r of SCAM_RULES) {
    if (r.and && !(r.compact ? r.and.test(compact) : r.and.test(text))) continue;
    let hit = null, tries = 0;
    for (const m of (r.compact && !new RegExp(r.re.source).test(text) ? compact.matchAll(r.re) : text.matchAll(r.re))) {
      if (++tries > 200) break;
      // '비밀번호를 묻지 않습니다' 같은 경고 문구는 사기 신호가 아니다. 단, 같은 문장에 '입력·알려 주시' 같은 요구가 있으면 경고가 아니라 요구다.
      if (r.warnable) { const sent = sentenceAt(text, m.index); if (WARNING_PHRASE.test(sent) && !REQUEST_PHRASE.test(sent)) continue; }
      hit = m; break;
    }
    if (!hit) continue;
    let pts = r.pts;
    // 짧은 인증번호 문자(숫자 4~8자리, 링크 없음)는 흔한 정상 OTP 형태라 점수를 낮춘다
    if (r.id === 'secret-info' && !urls.length && text.length < 160 && /(?<!\d)\d{4,8}(?!\d)/.test(text) && !REQUEST_PHRASE.test(text) && !/(전화|앱\s*설치)/.test(text)) pts = 10;
    add(r.label, `“${hit[0]}”`, pts);
  }
  const claimsGov = /(국세청|세무서|건강보험|국민연금|경찰|검찰|법원|정부|행정|시청|구청|군청|공단|지방자치|과태료|보건복지부|복지부|행정안전부|행안부|기획재정부|기재부|고용노동부|국토교통부|교육부|과학기술정보통신부|질병관리청|병무청|관세청|특허청|소방청|해양경찰청|통계청|조달청|재난\s*지원금|민생\s*회복|정부\s*지원금|국가\s*지원)/.test(text);
  const loanLike = reasons.some((r) => r.label.startsWith('대출'));
  for (const u of urls) {
    const official = u.officialGov || /\.(or|ac|re)\.kr$/.test(u.host);
    if (u.deceptive) add('주소 앞부분으로 공식 사이트인 척하는 속임수(@)', `${u.raw}@…`, 60);
    else if (u.shortened) add('줄임 주소(단축 URL)로 연결', u.raw, 35);
    else if (claimsGov && !official && /^https?:\/\//i.test(u.raw)) add('기관을 내세우지만 공식 주소(.go.kr)가 아님', u.raw, 30);
    else {
      // 은행명이 ‘입금 계좌’ 표기(신한 110-123-…)로만 나온 경우는 상표를 내세운 것이 아니다
      const line = lineAt(text, u.index);
      const brandHere = [...line.matchAll(new RegExp(BRANDS.source, 'g'))].find((b) => !/^\s*\(?\d[\d-]{5,}/.test(line.slice(b.index + b[0].length)));
      if (brandHere && !official && !isBrandDomain(u.host)) add(`‘${brandHere[0]}’을(를) 내세우지만 공식 주소로 보이지 않음`, u.raw, 30);
    }
    if (!official && !u.deceptive && !isBrandDomain(u.host) && BRAND_TOKENS.test(u.host)) add('유명 서비스 이름을 흉내 낸 주소', u.host, 35);
    if (!official && !u.deceptive && LOOKALIKE_GOV.test(u.host)) add('공공기관 주소를 흉내 낸 주소(gov-kr·go-kr 등)', u.host, 35);
    if (!u.deceptive && !u.shortened && SUSPICIOUS_TLD.test(u.host + '/')) add('흔히 사기에 쓰이는 주소 끝(.top·.xyz·.cc 등)', u.host, 25);
    if (loanLike && !official) add('대출·환급 권유와 함께 비공식 주소가 붙어 있음', u.raw, 30);
  }
  const ipUrl = text.match(/https?:\/\/\d{1,3}(?:\.\d{1,3}){3}[^\s]*/);
  if (ipUrl) add('숫자(IP) 주소로 바로 연결', ipUrl[0], 35);
  const cyr = text.match(/(?<![\w.-])[\w.-]{0,40}[Ѐ-ӿ][\w.-]{0,40}\.[a-z]{2,}/i);
  if (cyr) add('영문처럼 보이지만 키릴 문자가 섞인 위장 주소', cyr[0], 40);
  const idn = text.match(/https?:\/\/[^\s/]*[^\x00-\x7f][^\s/]*/);
  if (idn) add('주소에 영문이 아닌 글자가 섞임(위장 도메인일 수 있음)', idn[0], 30);
  for (const d of dates) if (d.weekdayMismatch) add('날짜와 요일이 맞지 않음(오타이거나 가짜 문서일 수 있음)', `${d.raw} → 실제 ${d.weekday}요일`, 10);
  const seen = new Set();
  const uniq = reasons.filter((r) => (seen.has(r.label + r.evidence) ? false : seen.add(r.label + r.evidence)));
  const score = Math.min(100, uniq.reduce((a, r) => a + r.pts, 0));
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { level, score, reasons: uniq };
}

export const OFFICIAL_CHECKS = [
  { name: '정부민원안내콜센터', tel: '110', note: '기관 문서인지 확인' },
  { name: '경찰청', tel: '112', note: '피해 신고' },
  { name: '한국인터넷진흥원(불법스팸·악성앱)', tel: '118', note: '문자·링크 신고' },
  { name: '금융감독원', tel: '1332', note: '금융 사기 상담' },
];

// ---------------------------------------------------------------- 문장 단위 분석
export function splitSentences(text) {
  // 숫자 뒤의 마침표(2026. 11. 13. 같은 날짜, '1.' 같은 번호)에서는 문장을 끊지 않는다
  return text.split(/(?<!\d\.)(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 6);
}

const ACT_VERB = /(제출|납부|납입|신청|방문|회신|연락|수령|참석|등록|갱신|서명|날인|동의|지참|발급|확인|이의신청|소명|입금|변경|정정|보완|선택|입력|설치|전송|답변)/;
const ACT_REQ = /(바랍니다|바람|주시기|주십시오|주세요|하십시오|하셔야|하여야|해야|필요합니다|요청|권고|부탁|하시기|하세요|하시오|하셔야|하시면|내세요|내십시오|보내세요|오세요|가져오세요|해\s*주|하길|하도록)/;
const PENALTY = /(가산금|가산세|과태료|압류|불이익|취소됩니다|정지|해지|제한|연체|체납|처분|고발|추가\s*부과|효력\s*(상실|정지)|환수|징수|부과됩니다|인정되지\s*않)/;

const stripNumber = (s) => s.replace(/^\s*(?:\d{1,2}\.(?!\s*\d)|[가-하]\.|[①-⑩]|\(\d+\))\s*/, ''); // 번호 '1.'만 벗기고 '2026.'·'11. 20.' 같은 날짜는 남긴다

export function findActions(text, { base } = {}) {
  const acts = [];
  for (const s0 of splitSentences(text)) {
    const s = stripNumber(s0);
    if (!(ACT_VERB.test(s) && ACT_REQ.test(s))) continue;
    const ds = extractDates(s, { base });
    const dl = ds.find((d) => d.role === 'deadline') || ds[0] || null;
    acts.push({ text: s, due: dl ? dl.iso : null, dueRaw: dl ? dl.raw : null, time: dl ? dl.time : null });
  }
  return acts;
}

const CONDITIONAL = /(않으면|않거나|않는\s*경우|없는\s*경우|지나면|경과|하지\s*않|못한\s*경우|미이행|초과|연체)/;
export function findConsequences(text) {
  // 제목 줄의 '과태료' 같은 낱말이 아니라 '~하지 않으면 ~된다'는 조건부 문장만
  return splitSentences(text).map(stripNumber).filter((s) => PENALTY.test(s) && CONDITIONAL.test(s));
}

const TYPES = [
  ['과태료·범칙금 통지', /(과태료|범칙금)/],
  ['사회보험(건강·연금·고용) 안내', /(건강보험|국민연금|고용보험|산재보험|4대\s*보험|장기요양)/],
  ['세금 고지·안내', /(국세|지방세|세무서|종합소득세|부가가치세|재산세|자동차세|세액|납세)/],
  ['임대차·계약 안내', /(임대|보증금|월세|전세|계약\s*(기간|만료|갱신)|입주)/],
  ['학교·교육 안내', /(가정통신문|학부모|학교장|체험학습|학급)/],
  ['지원금·환급 안내', /(환급|지원금|보조금|바우처|장려금)/],
  ['택배·배송 문자', /(택배|배송|주소\s*불명|미배송)/],
  ['수사·사법기관 문서', /(검찰|법원|경찰서|출석\s*요구|소환)/],
];
export function guessDocType(text) {
  for (const [name, re] of TYPES) if (re.test(text)) return name;
  return '일반 안내문';
}

// ---------------------------------------------------------------- 어려운 말 사전
const TERM_LIST = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const TERM_RE = new RegExp(TERM_LIST.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

export function glossaryMatches(text) {
  const count = new Map();
  for (const m of text.matchAll(TERM_RE)) count.set(m[0], (count.get(m[0]) || 0) + 1);
  return [...count.entries()].map(([term, n]) => ({ term, easy: GLOSSARY[term], count: n }));
}

// 화면용: 원문을 [{text, easy|null}] 조각으로 쪼갠다(HTML은 만들지 않아 XSS 걱정이 없다).
export function highlightTerms(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(TERM_RE)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), easy: null });
    parts.push({ text: m[0], easy: GLOSSARY[m[0]] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), easy: null });
  return parts;
}

// ---------------------------------------------------------------- 개인정보 가리기(AI에 보내기 전)
export function maskSensitive(text, state = { map: new Map(), counters: {} }, extra = []) {
  const { map, counters } = state;
  const put = (kind, raw) => {
    for (const [k, v] of map) if (v === raw) return k;
    counters[kind] = (counters[kind] || 0) + 1;
    const key = `[${kind}${counters[kind]}]`;
    map.set(key, raw);
    return key;
  };
  let out = text;
  out = out.replace(/(?<!\d)(\d{2})(\d{2})(\d{2})\s{0,2}[-.]?\s{0,2}[1-8]\d{6}(?!\d)/g, (m, yy, mm, dd) => (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31 ? put('주민·외국인번호', m) : m));   // 13자리 고객번호는 앞 6자리가 생년월일 꼴일 때만
  out = out.replace(/(?<!\d)\d{2}-\d{2}-\d{6}-\d{2}(?!\d)/g, (m) => put('운전면허번호', m));
  out = out.replace(/(?<![A-Za-z0-9])(?:[MSROD]\d{8}|[A-Z]\d{3}[A-Z]\d{4})(?![A-Za-z0-9])/g, (m) => put('여권번호', m));
  out = out.replace(/(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}(?!\d)/g, (m) => put('카드번호', m));
  out = out.replace(/(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)/g, (m) => put('사업자번호', m));
  out = out.replace(/(?<!\d)\d{12,14}(?!\d)/g, (m, off) => (BANK_WORDS.test(text.slice(Math.max(0, off - 14), off)) ? put('계좌', m) : m));
  out = out.replace(/(?<!\d)\d{16}(?!\d)/g, (m, off) => (/카드/.test(text.slice(Math.max(0, off - 12), off + 20)) ? put('카드번호', m) : m));
  out = out.replace(/(?<!\d)\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,4})?(?!\d)/g, (m, off) => (/^\d{4}-\d{2}-\d{2}$/.test(m) && validDate(...m.split('-').map(Number)) ? m : BANK_WORDS.test(text.slice(Math.max(0, off - 24), off + m.length + 6)) && !/^0\d{1,2}-\d{3,4}-\d{4}$/.test(m) ? put('계좌', m) : m));
  out = out.replace(/(?<!\d)(?:\+82[- ]?)?0?1[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/g, (m) => put('전화', m));
  out = out.replace(/(?<!\d)\(?0\d{1,2}\)?[-. ]?\d{3,4}[-. ]\d{4}(?!\d)/g, (m) => put('전화', m));
  out = out.replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}/g, (m) => put('이메일', m));
  // 사용자가 직접 적은 가릴 말(이름·주소 등)
  for (const w of [...new Set((extra || []).map((x) => String(x).trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length)) out = out.split(w).join(put('가림', w));
  return { masked: out, map, state };
}
export function unmask(str, map) {
  let s = String(str ?? '');
  for (const [k, v] of map) s = s.split(k).join(v);
  return s;
}

// ---------------------------------------------------------------- 캘린더(.ics)
function icsEscape(s) {
  // 제어문자 제거, 모든 종류의 줄바꿈(\r, U+2028 등)은 \n 이스케이프로 — 일정 파일에 줄을 끼워 넣는 주입을 막는다
  return String(s).replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029]/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (parts.length ? 74 : 75)) { parts.push(cur); cur = ch; } else cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
const addDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + 1)); return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };

export function buildICS(events, { now = new Date(), uidSeed = 'pulyeojwo' } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pulyeojwo//Gongmun Haedok Agent//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  events.forEach((e, i) => {
    const compact = e.iso.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${uidSeed}-${compact}-${i}@pulyeojwo.local`, `DTSTAMP:${stamp}`);
    if (e.time) {
      const [hh, mm] = e.time.split(':').map(Number);
      const t = `${pad(hh)}${pad(mm)}00`;
      const tEnd = `${pad(Math.min(hh + 1, 23))}${pad(hh >= 23 ? 59 : mm)}00`;
      lines.push(`DTSTART:${compact}T${t}`, `DTEND:${compact}T${tEnd}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact}`, `DTEND;VALUE=DATE:${addDay(e.iso).replace(/-/g, '')}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    for (const trig of ['-P7D', '-P1D']) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(e.title)}`, `TRIGGER:${trig}`, 'END:VALARM');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- 한 번에 분석(AI 없이)
export const MAX_CHARS = 30000;
export function analyzeLocal(rawText, { base } = {}) {
  const truncated = String(rawText ?? '').length > MAX_CHARS;
  const text = normalizeText(rawText);
  const dates = extractDates(text, { base });
  // '내일까지·오늘 중' 은 달력 날짜가 적혀 있지 않아도 기한이다 — 기준일로 환산해 기한으로 올린다
  for (const r of findRelativeDueDates(text, base)) dates.push({ iso: r.iso, raw: r.raw, index: r.index, end: r.end, time: null, role: r.role, weekdayGiven: null, weekdayMismatch: false, weekday: weekdayOf(r.iso), yearInferred: false, relative: true });
  dates.sort((a, b) => a.index - b.index);
  const urls = extractUrls(text);
  const result = {
    text,
    truncated,
    docType: guessDocType(text),
    dates,
    relative: extractRelativeDeadlines(text),
    amounts: extractAmounts(text),
    totals: [],
    accounts: extractAccounts(text),
    phones: extractPhones(text),
    urls,
    emails: extractEmails(text),
    actions: findActions(text, { base }),
    consequences: findConsequences(text),
    terms: glossaryMatches(text),
  };
  result.totals = checkTotals(result.amounts, text);
  result.scam = scamCheck(text, { urls, dates });
  if (result.scam.level === 'high') result.docType = '사기 의심 문자·문서';
  // 날짜가 들어 있는 문장(캘린더 제목·화면용)
  const sents = splitSentences(text).map(stripNumber);
  for (const d of dates) d.sentence = sents.find((s) => s.includes(d.raw)) || '';
  return result;
}

// ---------------------------------------------------------------- AI 답 검증기
const normForMatch = (s) => String(s ?? '').replace(/[\s\u200b.,;:!?'"“”‘’()\[\]{}<>~\-·…「」『』]/g, '').toLowerCase();

export function evidenceStatus(evidence, source) {
  const e = normForMatch(evidence);
  if (!e) return 'none';
  if (e.length < 8) return 'short'; // '납부' 같은 한두 단어는 근거가 못 된다
  if (e.length > 240) return 'long';  // 문서를 통째로 끌어다 붙인 인용은 근거가 못 된다
  const s = normForMatch(source);
  if (s.includes(e)) return 'exact';
  const toks = String(evidence).split(/\s+/).map(normForMatch).filter((t) => t.length >= 2);
  if (!toks.length) return 'none';
  const hit = toks.filter((t) => s.includes(t)).length / toks.length;
  const o = inOrder(toks.map(normForMatch), s);
  return hit >= 0.75 && o.hits / toks.length >= 0.75 && o.span <= e.length * 2.5 + 20 ? 'approx' : 'missing';
}
// 인용문의 낱말이 원문에서 '같은 순서로, 가까운 구간 안에' 몇 개나 이어지는지(흩어진 낱말을 모아 만든 가짜 인용 방지)
function inOrder(toks, s) {
  let pos = 0, first = -1, hits = 0;
  for (const t of toks) { const idx = s.indexOf(t, pos); if (idx >= 0) { if (first < 0) first = idx; pos = idx + t.length; hits++; } }
  return { hits, span: first < 0 ? Infinity : pos - first };
}

// 인용문이 원문 어느 문장에 있는지 찾아 그 문장과 앞뒤 한 문장에 적힌 날짜(ISO) 집합을 돌려준다. 못 찾으면 null.
function datesNearEvidence(source, evidence, base) {
  const sents = splitSentences(source).map(stripNumber);
  const ev = normForMatch(evidence);
  let idx = sents.findIndex((s) => normForMatch(s).includes(ev));
  if (idx < 0) {
    const toks = String(evidence).split(/\s+/).map(normForMatch).filter((x) => x.length >= 2);
    let best = -1, bestHit = 0;
    sents.forEach((s, i) => { const n = normForMatch(s); const hit = toks.filter((x) => n.includes(x)).length; if (hit > bestHit) { bestHit = hit; best = i; } });
    if (best < 0 || bestHit / Math.max(1, toks.length) < 0.6) return null;
    idx = best;
  }
  const set = new Set();
  for (let i = Math.max(0, idx - 1); i <= Math.min(sents.length - 1, idx + 1); i++) for (const d of extractDates(sents[i], { base })) set.add(d.iso);
  return set;
}

// 글자 쌍(2글자)이 겹치는 정도: 할 일 문구와 인용문이 같은 이야기인지 대략 본다
const bigrams = (s) => { const n = normForMatch(s).replace(/[^가-힣a-z0-9]/g, ''); const o = new Set(); for (let i = 0; i < n.length - 1; i++) o.add(n.slice(i, i + 2)); return o; };
export function bigramOverlap(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 1;
  let c = 0; for (const x of A) if (B.has(x)) c++;
  return c / Math.min(A.size, B.size);
}
// AI 가 쓴 자유 문장(요약·풀이·답장·할 일 제목·금액 이름)에 원문에 없는 날짜·금액이 끼어 있는지 본다('오늘'이 원문에 있으면 오늘 날짜는 허용)
function textIssues(text, source, dateSet, amountSet, base, srcFacts = null) {
  const t = String(text || '');
  if (!t) return [];
  const out = [];
  const todayOk = !!base && /(오늘|금일)/.test(source);
  for (const d of extractDates(t, { base })) if (!dateSet.has(d.iso) && !(todayOk && d.iso === base)) out.push(`날짜 ${d.raw}`);
  for (const a of extractAmounts(t)) if (!amountSet.has(a.krw)) out.push(`금액 ${a.raw}`);
  // 비율(%)·전화번호·인터넷 주소도 원문에 있는 것만 허용(‘가산금 3%’ 가 ‘30%’ 로 바뀌거나 엉뚱한 전화·주소가 끼는 것을 잡는다)
  if (srcFacts) {
    for (const m of t.matchAll(/(\d+(?:\.?\d+)?)\s*%/g)) if (!srcFacts.pct.has(Number(m[1]))) out.push(`비율 ${m[0]}`);
    for (const p of extractPhones(t)) if (!srcFacts.phones.has(p.raw.replace(/[^\d]/g, ''))) out.push(`전화번호 ${p.raw}`);
    if (srcFacts.hosts) for (const u of extractUrls(t)) if (!srcFacts.hosts.has(u.host)) out.push(`주소 ${u.raw}`);   // 주소는 보낼 글(답장 초안)에서만 따진다 — 요약·풀이가 ‘공식 사이트는 hometax.go.kr’ 처럼 안내하는 것은 정당하다
  }
  return [...new Set(out)];
}
const stripEnding = (x) => String(x || '').replace(/(습니다|합니다|됩니다|입니다|있어요|해요|돼요|니다|어요|아요|세요|해야|있음|있다|수)/g, ' ');   // 어미만 같아서 겹치는 글자쌍은 세지 않는다
const NEG_FREE = /(하지\s*않아도|안\s*해도|필요\s*없|필요가\s*없|불필요|면제)/;   // '~하지 않아도 된다' 는 면제 주장 — '따라 하지 마세요' 같은 경고는 해당 없음
const validTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function verifyAI(ai, source, local, { base } = {}) {
  // 원문에 있는 비율(%)·전화번호·인터넷 주소·시각 — AI가 바꿔 쓰거나 지어낸 값을 잡는 데 쓴다
  const srcFacts = { pct: new Set([...source.matchAll(/(\d+(?:\.?\d+)?)\s*%/g)].map((m) => Number(m[1]))), phones: new Set(extractPhones(source).map((p) => p.raw.replace(/[^\d]/g, ''))), hosts: new Set(extractUrls(source).map((u) => u.host)) };
  const srcTimes = new Set([...source.matchAll(/(?:(오전|오후)\s*)?(\d{1,2})\s*(?::|시(?!간))\s*(\d{2})?/g)].map((m) => { let h = Number(m[2]); if (m[1] === '오후' && h < 12) h += 12; if (m[1] === '오전' && h === 12) h = 0; return `${String(h).padStart(2, '0')}:${m[3] || '00'}`; }));
  const srcFactsNoUrl = { ...srcFacts, hosts: null };
  const relSet = relativeDueDates(source, base);            // 원문이 '오늘 중' 이라고 한 기한은 오늘 날짜로 인정
  const dateSet = new Set([...local.dates.map((d) => d.iso), ...relSet]);
  const amountSet = new Set(local.amounts.map((a) => a.krw));
  const objs = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
  const must = objs(ai.must_do).map((t) => {
    const due = typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : null;
    const ev = evidenceStatus(t.evidence, source);
    // 인용문에 날짜가 적혀 있다면 그 날짜가 주장한 기한과 같아야 한다(다른 문장을 끌어다 붙이는 오류 방지)
    const evDates = due ? extractDates(String(t.evidence || ''), { base }) : [];
    const relInEv = !!due && relativeDueDates(String(t.evidence || ''), base).has(due);   // 인용문이 '오늘 중' 이고 기한이 오늘 날짜
    const dueInEvidence = relInEv ? true : due && evDates.length ? evDates.some((d) => d.iso === due) : null;
    const same = due ? local.dates.filter((d) => d.iso === due) : [];
    const taskTextIssues = textIssues(t.task, source, dateSet, amountSet, base, srcFactsNoUrl);
    const refOnly = same.length > 0 && same.every((d) => d.role === 'reference'); // 발송일·작성일 같은 기준일을 기한이라 한 경우
    const dueVerified = due ? dateSet.has(due) : null;
    // 인용문에 날짜가 없으면, 그 인용문이 있는 문장과 앞뒤 한 문장 안에 주장한 기한이 실제로 있어야 한다(할 일↔날짜 짝 확인)
    let nearMiss = false;
    if (due && dueVerified && dueInEvidence === null && ev !== 'none' && ev !== 'short' && ev !== 'missing' && ev !== 'long') {
      const near = datesNearEvidence(source, String(t.evidence || ''), base);
      nearMiss = near !== null && !near.has(due);
    }
    // 인용문에 날짜가 없는 경우 할 일 문구가 인용문과 같은 이야기여야 한다(바로 옆 문장을 끌어다 붙이는 오류 방지)
    const taskMismatch = !!due && dueVerified && dueInEvidence === null && (ev === 'exact' || ev === 'approx') && bigramOverlap(String(t.task || ''), String(t.evidence || '')) < 0.12;
    const negFlip = (ev === 'exact' || ev === 'approx') && NEG_FREE.test(String(t.task || '')) && !NEG_FREE.test(String(t.evidence || ''));   // '제출하지 않아도 됩니다' 인데 인용문은 제출하라는 말
    const reason = [ev === 'none' && '인용문(evidence)이 비어 있음', ev === 'short' && '인용문이 너무 짧음(8자 미만)', ev === 'missing' && '인용문을 원문에서 찾지 못함', negFlip && '할 일 문구는 “하지 않아도 된다”인데 인용문에는 그런 말이 없음', dueVerified === false && '원문에 없는 날짜', dueInEvidence === false && '인용문 속 날짜가 기한과 다름', nearMiss && '인용문 근처 문장에 그 날짜가 없음', refOnly && '기한이 아니라 기준일(발송일 등)', taskMismatch && '할 일과 인용문의 내용이 서로 맞지 않음', ev === 'long' && '인용문이 너무 김(문서 통째 인용 불가)', ...taskTextIssues.map((x) => `할 일 문구에 원문에 없는 ${x}`)].filter(Boolean).join(' / ') || null;
    return { task: String(t.task || ''), due, evidence: String(t.evidence || ''), evidenceStatus: ev, dueVerified, dueInEvidence, reason, ok: !reason, time: validTime(t.time) && srcTimes.has(t.time) ? t.time : null, timeDropped: validTime(t.time) && !srcTimes.has(t.time) };
  });
  const money = objs(ai.money).map((m) => {
    const krw = Number(m.amount_krw);
    const evAmts = Number.isFinite(krw) ? extractAmounts(String(m.evidence || '')) : [];
    const amountInEvidence = evAmts.length ? evAmts.some((a) => a.krw === krw) : null;
    const ev = evidenceStatus(m.evidence, source);
    const amountVerified = Number.isFinite(krw) ? amountSet.has(krw) : false;
    const labelIssues = textIssues(m.label, source, dateSet, amountSet, base, srcFactsNoUrl);
    const kinds = local.amounts.filter((a) => a.krw === krw).map((a) => a.kind);
    const labelRecv = /(환급|돌려\s*받|수령|지급\s*받|받을)/.test(String(m.label || ''));
    const labelPay = /(납부|납입|낼\s*돈|내야|청구|부과|체납|과태료)/.test(String(m.label || ''));
    const dirMismatch = (labelRecv && !kinds.includes('receive') && kinds.includes('pay')) || (labelPay && !labelRecv && !kinds.includes('pay') && kinds.includes('receive'));
    const labelSwap = amountVerified && amountInEvidence === true && evAmts.length > 1 && (() => {
      const ev0 = String(m.evidence || '');
      const ctxOf = (a, i) => ev0.slice(Math.max(i ? evAmts[i - 1].index + evAmts[i - 1].raw.length : 0, a.index - 16), a.index);   // 금액 바로 앞 글
      const scores = evAmts.map((a, i) => ({ krw: a.krw, o: bigramOverlap(String(m.label || ''), ctxOf(a, i)) }));
      const mine = Math.max(0, ...scores.filter((x) => x.krw === krw).map((x) => x.o));
      const other = Math.max(0, ...scores.filter((x) => x.krw !== krw).map((x) => x.o));
      return mine === 0 && other >= 0.3;
    })();
    const reason = [ev === 'none' && '인용문(evidence)이 비어 있음', ev === 'short' && '인용문이 너무 짧음(8자 미만)', ev === 'missing' && '인용문을 원문에서 찾지 못함', labelSwap && '이름이 그 금액이 아니라 같은 인용문의 다른 금액 옆 글과 맞음', !amountVerified && '원문에 없는 금액', amountInEvidence === false && '인용문 속 금액이 다름', amountVerified && amountInEvidence === null && ev !== 'none' && ev !== 'short' && '인용문에 그 금액이 적혀 있지 않음', dirMismatch && '원문과 돈의 방향(낼 돈/받을 돈)이 다르게 표시됨', ev === 'long' && '인용문이 너무 김(문서 통째 인용 불가)', ...labelIssues.map((x) => `이름에 원문에 없는 ${x}`)].filter(Boolean).join(' / ') || null;
    return { label: String(m.label || ''), krw: Number.isFinite(krw) ? krw : null, evidence: String(m.evidence || ''), evidenceStatus: ev, amountVerified, amountInEvidence, reason, ok: !reason };
  });
  const consequences = objs(ai.consequences).map((c) => {
    const ev = evidenceStatus(c.evidence, source);
    const cIssues = textIssues(c.text, source, dateSet, amountSet, base, srcFactsNoUrl);
    const cMismatch = (ev === 'exact' || ev === 'approx') && bigramOverlap(stripEnding(c.text), stripEnding(c.evidence)) < 0.05;   // 낱말 변형('소멸된다고'↔'소멸됩니다')은 봐주고, 겹치는 글자쌍이 거의 없을 때만
    const reason = ev === 'none' ? '인용문(evidence)이 비어 있음' : ev === 'missing' ? '인용문을 원문에서 찾지 못함' : ev === 'long' ? '인용문이 너무 김(문서 통째 인용 불가)' : cMismatch ? '불이익 문구와 인용문의 내용이 서로 맞지 않음' : cIssues.length ? `문구에 원문에 없는 ${cIssues.join(', ')}` : null;
    return { text: String(c.text || ''), evidence: String(c.evidence || ''), evidenceStatus: ev, reason, ok: !reason };
  });
  const covered = new Set(must.filter((t) => t.due).map((t) => t.due));
  const missedDates = local.dates.filter((d) => d.role === 'deadline' && !covered.has(d.iso));
  const level = ['low', 'medium', 'high'].includes(ai.scam_check?.level) ? ai.scam_check.level : 'low';
  const rank = { low: 0, medium: 1, high: 2 };
  const finalLevel = rank[level] >= rank[local.scam.level] ? level : local.scam.level;
  const oneLineIssues = textIssues(ai.one_line, source, dateSet, amountSet, base, srcFactsNoUrl);
  const plainList = (Array.isArray(ai.plain_summary) ? ai.plain_summary : []).map(String).slice(0, 6);
  const plainIssues = plainList.map((p) => textIssues(p, source, dateSet, amountSet, base, srcFactsNoUrl));
  const replyIssues = textIssues(ai.reply_draft, source, dateSet, amountSet, base, srcFacts);
  const bad = must.filter((t) => !t.ok).length + money.filter((m) => !m.ok).length + consequences.filter((c) => !c.ok).length + (oneLineIssues.length ? 1 : 0) + plainIssues.filter((x) => x.length).length + (replyIssues.length ? 1 : 0);
  return {
    oneLine: String(ai.one_line || ''), oneLineIssues,
    plain: plainList, plainIssues, replyIssues,
    must, money, consequences,
    questions: (Array.isArray(ai.questions_to_ask) ? ai.questions_to_ask : []).map(String).slice(0, 5),
    reply: String(ai.reply_draft || ''),
    terms: (Array.isArray(ai.terms) ? ai.terms : []).filter((t) => t && t.term && t.easy).map((t) => ({ term: String(t.term), easy: String(t.easy) })).slice(0, 12),
    scam: { level: finalLevel, raisedByRules: rank[finalLevel] > rank[level], aiReasons: Array.isArray(ai.scam_check?.reasons) ? ai.scam_check.reasons.map(String).slice(0, 5) : [] },
    missedDates,
    flagged: bad,
  };
}

// 캘린더에 담을 기한: AI가 말하고 원문에서도 확인된 것 + (AI 없이) 원문에서 직접 찾은 기한 문장
export function calendarEvents({ verified, local, docType }) {
  const ev = [];
  const seen = new Set();
  const push = (title, iso, time, description) => { const k = iso + title; if (!seen.has(k)) { seen.add(k); ev.push({ title, iso, time, description }); } };
  if (verified) {
    for (const t of verified.must) if (t.due && t.ok) push(clip(`[공문] ${t.task}`, 90), t.due, t.time, `원문: ${t.evidence}\n※ 중요한 날짜는 원문으로 한 번 더 확인하세요.`);
  }
  for (const a of local.actions) {
    if (!a.due) continue;
    if (verified && verified.must.some((t) => t.due === a.due)) continue;
    push(clip(`[공문] ${a.text}`, 90), a.due, a.time, `원문: ${a.text}\n※ ${docType}`);
  }
  // AI·할 일 문장에서 못 잡은 기한도 빠뜨리지 않는다(같은 날짜는 한 번만)
  for (const d of local.dates.filter((x) => x.role === 'deadline')) {
    if (ev.some((e) => e.iso === d.iso)) continue;
    push(clip(`[공문] ${d.sentence || `기한 (${docType})`}`, 90), d.iso, d.time, `원문: ${d.sentence || d.raw}`);
  }
  return ev.sort((a, b) => a.iso.localeCompare(b.iso));
}
