// 시험 모음: 샘플 5개에 맞추어 만든 엔진이 '처음 보는 글'에서도 맞는지 보는 20건.
// 기대값은 글을 읽고 사람이 먼저 적었고(엔진 출력을 보고 맞춘 것이 아님), 틀린 건 엔진을 고치거나 한계로 README 에 적는다.
// 실행: node test/corpus.mjs   (상세 출력: node test/corpus.mjs -v)
import { analyzeLocal } from '../js/engine.js';

const LEVEL = { low: 0, medium: 1, high: 2 };

// deadline: 기한으로 읽혀야 하는 날짜(정확히 이 집합), amounts: 읽혀야 하는 금액(정확히 이 집합, 원 단위)
// scam: 'low' 이면 정확히 low, 'risky' 이면 medium 이상.  mismatch: 요일이 틀린다고 표시돼야 하는 날짜.
const CASES = [
  { id: 'kepco', base: '2026-10-28', deadline: ['2026-11-10'], amounts: [48370], scam: 'low',
    text: '[한국전력] 2026년 10월분 전기요금 청구서\n청구금액: 48,370원\n납기일: 2026. 11. 10.\n납기 후 납부 시 연체가산금이 부과됩니다.\n가상계좌: 국민은행 123456-78-901234' },
  { id: 'nhis', base: '2026-10-28', deadline: ['2026-11-30'], amounts: [312450], scam: 'low',
    text: '건강보험료 체납 안내\n체납보험료 총 312,450원을 2026년 11월 30일까지 납부하지 않으면 재산 압류 등 체납처분이 진행될 수 있습니다.\n문의: 1577-1000' },
  { id: 'propertytax', base: '2026-09-10', deadline: ['2026-09-30'], amounts: [187600], scam: 'low',
    text: '재산세(주택) 1기분 납부고지서\n세액 187,600원 (지방교육세 포함)\n납기: 2026.09.30.\n전국 금융기관·위택스·ARS 로 납부하실 수 있습니다.' },
  { id: 'school', base: '2026-10-28', deadline: ['2026-11-03'], amounts: [18000], scam: 'low',
    text: '현장체험학습 안내\n일시: 11월 6일(금) 08:40~15:00\n참가비 18,000원은 학교 앱으로 납부\n참가 동의서는 11월 3일(화)까지 담임 선생님께 제출해 주세요.' },
  { id: 'maintenance', base: '2026-10-28', deadline: ['2026-11-15'], amounts: [215830, 78000, 21000, 52830, 64000], scam: 'low', totalsOk: true,
    text: '10월 관리비 고지서\n일반관리비 78,000원\n청소비 21,000원\n경비비 52,830원\n난방비 64,000원\n합계 215,830원\n납부기한 11월 15일' },
  { id: 'smish-parcel', base: '2026-10-28', deadline: [], amounts: [], scam: 'risky',
    text: '[Web발신] [CJ대한통운] 배송지 주소가 불명확하여 반송 예정입니다. 주소 확인: http://cj-post.top/a1b2 확인 후 재배송' },
  { id: 'prosecutor', base: '2026-10-28', deadline: [], amounts: [], scam: 'risky',
    text: '서울중앙지검 사건조회: 귀하의 계좌가 금융범죄에 연루되어 자산 보호를 위해 안전계좌로 이체해야 합니다. 이 사실을 타인에게 알리지 마십시오.' },
  { id: 'loan-ad', base: '2026-10-28', deadline: [], amounts: [300000], scam: 'risky',
    text: '[Web발신] 정부지원 저금리 대환대출 승인 완료. 선입금 수수료 30만원 입금 후 오늘 중 대출금이 지급됩니다.' },
  { id: 'hospital', base: '2026-10-28', deadline: [], amounts: [], scam: 'low', event: ['2026-11-04'],
    text: '진료 예약 안내\n2026년 11월 4일(수) 오전 10시 30분 내과\n준비사항: 검사 전 8시간 금식\n예약 변경은 전날까지 가능합니다.' },
  { id: 'lease', base: '2026-10-28', deadline: [], amounts: [150000000, 700000], scam: 'low',
    text: '임대차 계약갱신 안내\n현재 계약 만료일은 2027. 1. 31. 입니다.\n보증금 150,000,000원, 월세 700,000원\n갱신 의사는 만료 2개월 전까지 알려 주세요.' },
  { id: 'card', base: '2026-10-28', deadline: ['2026-11-14'], amounts: [1284300, 128430], scam: 'low',
    text: '신용카드 이용대금 명세서\n결제일 11월 14일\n결제금액 1,284,300원\n최소결제금액 128,430원' },
  { id: 'telecom-weekday', base: '2026-10-28', deadline: ['2026-11-05'], amounts: [67200], scam: 'low', mismatch: ['2026-11-05'],
    text: '미납 요금 안내\n미납금액 67,200원을 11월 5일(월)까지 납부하지 않으면 이용이 정지됩니다.' },
  { id: 'car-inspection', base: '2026-10-28', deadline: ['2027-01-02'], amounts: [300000, 36000], scam: 'low',
    text: '자동차 정기검사 안내\n검사기간: 2026. 12. 3. ~ 2027. 1. 2.\n검사 수수료 36,000원\n기간을 넘기면 과태료가 최대 30만원까지 부과됩니다.' },
  { id: 'youth-rent', base: '2026-10-28', deadline: ['2026-11-20'], amounts: [200000], scam: 'low',
    text: '청년 월세 지원 신청 공고\n신청기간: 2026. 11. 2.(월) ~ 11. 20.(금) 18:00\n지원내용: 월 최대 20만원, 12개월' },
  { id: 'court-order', base: '2026-10-28', deadline: [], amounts: [3500000], scam: 'low',
    text: '지급명령 결정문\n채무자는 청구금액 3,500,000원 및 이에 대한 지연손해금을 채권자에게 지급하라.\n이 결정을 송달받은 날부터 2주 이내에 이의신청을 하지 않으면 확정됩니다.' },
  { id: 'pension', base: '2026-10-28', deadline: [], amounts: [133200], scam: 'low',
    text: '국민연금 납부예외 해제 안내\n2026년 12월분부터 월 보험료 133,200원이 부과됩니다.\n납부기한은 매월 말일입니다.' },
  { id: 'civil-defense', base: '2026-10-28', deadline: [], amounts: [200000], scam: 'low', event: ['2026-11-19'],
    text: '민방위 대피훈련 안내\n2026. 11. 19.(목) 14:00 사이렌이 울리면 가까운 대피소로 이동하세요.\n정당한 사유 없이 불참하면 20만원 이하의 과태료가 부과될 수 있습니다.' },
  { id: 'family-impersonation', base: '2026-10-28', deadline: [], amounts: [300000], scam: 'risky',
    text: '엄마 나 폰 액정 깨져서 수리 맡겼어. 문자 이 번호로 보내줘. 급한데 문화상품권 핀번호 30만원어치 사서 보내줄 수 있어?' },
  { id: 'customs', base: '2026-10-28', deadline: ['2026-11-06'], amounts: [32450], scam: 'low',
    text: '[관세청] 해외직구 물품 통관 안내\n관세 및 부가세 합계 32,450원\n납부기한: 2026. 11. 6.(금)\n납부는 관세청 유니패스(unipass.customs.go.kr)에서 하세요.' },
  { id: 'job-scam', base: '2026-10-28', deadline: [], amounts: [300000, 50000], scam: 'risky',
    text: '[채용 합격] 재택근무 일당 30만원, 업무는 상품권 구매 대행입니다. 보증금 5만원 선입금 후 시작하며 카톡 오픈채팅 https://open.kakao.com/o/abc123 으로 문의하세요.' },
];

const set = (a) => [...new Set(a)].sort((x, y) => x - y);
const eq = (a, b) => JSON.stringify(set(a)) === JSON.stringify(set(b));
const verbose = process.argv.includes('-v');
let pass = 0; const fails = [];
for (const c of CASES) {
  const r = analyzeLocal(c.text, { base: c.base });
  const got = {
    deadline: r.dates.filter((d) => d.role === 'deadline').map((d) => d.iso).sort(),
    event: r.dates.filter((d) => d.role === 'event').map((d) => d.iso).sort(),
    amounts: r.amounts.map((a) => a.krw),
    scam: r.scam.level,
    mismatch: r.dates.filter((d) => d.weekdayMismatch).map((d) => d.iso),
  };
  const problems = [];
  if (!eq(got.deadline.map((s) => +s.replace(/-/g, '')), c.deadline.map((s) => +s.replace(/-/g, '')))) problems.push(`기한 기대 ${c.deadline} / 실제 ${got.deadline}`);
  if (c.event && !eq(got.event.map((s) => +s.replace(/-/g, '')), c.event.map((s) => +s.replace(/-/g, '')))) problems.push(`행사 기대 ${c.event} / 실제 ${got.event}`);
  if (!eq(got.amounts, c.amounts)) problems.push(`금액 기대 ${set(c.amounts)} / 실제 ${set(got.amounts)}`);
  if (c.scam === 'low' ? got.scam !== 'low' : LEVEL[got.scam] < LEVEL.medium) problems.push(`사기 점검 기대 ${c.scam} / 실제 ${got.scam}`);
  if (c.mismatch && !eq(got.mismatch.map((s) => +s.replace(/-/g, '')), c.mismatch.map((s) => +s.replace(/-/g, '')))) problems.push(`요일 불일치 기대 ${c.mismatch} / 실제 ${got.mismatch}`);
  if (!c.mismatch && got.mismatch.length) problems.push(`요일이 맞는 글인데 불일치로 표시 ${got.mismatch}`);
  if (c.totalsOk && r.totals && r.totals.some((t) => t.ok === false)) problems.push('합계가 맞는 글인데 검산 경고');
  if (problems.length) fails.push({ id: c.id, problems }); else pass++;
  if (verbose) console.log(c.id.padEnd(22), JSON.stringify(got));
}
for (const f of fails) console.error(`  FAIL ${f.id}\n       ${f.problems.join('\n       ')}`);
console.log(`corpus: ${pass}/${CASES.length} 일치`);
if (fails.length) process.exitCode = 1;
