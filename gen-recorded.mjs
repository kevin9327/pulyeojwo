// test/real/*.json 의 '실제 AI 답' 5개(예시 문서마다 1개)를 js/recorded.js 로 묶는다. 키 없이도 ‘AI 켠 화면’을 볼 수 있게 하는 기록 재생용.
// 사용: node gen-recorded.mjs   (그 뒤 node build-single.mjs)
import fs from 'node:fs';
import { SAMPLES, SAMPLE_BASE_DATE } from './js/samples.js';
import { parseJson } from './js/llm.js';
import { evaluate } from './js/agent.js';

const MAP = {
  fine: ['fine.json', 'Gemini 웹(챗봇)에서 받은 실제 답 · 2026-10-28'],
  insurance: ['insurance.json', 'Gemini 웹(챗봇)에서 받은 실제 답 · 2026-10-28'],
  smishing: ['smishing.json', 'Gemini 웹(챗봇)에서 받은 실제 답 · 2026-10-28'],
  rental: ['api_rental.json', 'Gemini API 직접 호출로 받은 실제 답 · 2026-10-28'],
  school: ['api_school.json', 'Gemini API 직접 호출로 받은 실제 답 · 2026-10-28'],
  n2_parcel: ['api2_n2_parcel.json', 'Gemini API 직접 호출로 받은 실제 답 · 2026-10-29 · 새 문서'],
  n3_checkup: ['api2_n3_checkup.json', 'Gemini API 직접 호출로 받은 실제 답 · 2026-10-29 · 새 문서'],
  n4_telecom: ['api2_n4_telecom.json', 'Gemini API 직접 호출로 받은 실제 답 · 2026-10-29 · 새 문서'],
  n5_refund: ['api2_n5_refund.json', 'Gemini API 직접 호출로 받은 실제 답 · 2026-10-29 · 새 문서'],
  n6_meal: ['api2_n6_meal.json', 'Gemini API 직접 호출로 받은 실제 답 · 2026-10-29 · 새 문서'],
  n7_hospital: ['api2_n7_hospital.json', 'Gemini API 직접 호출로 받은 실제 답 · 2026-10-29 · 새 문서'],
};
const out = {};
for (const s of SAMPLES) {
  const [file, via] = MAP[s.id] || [];
  if (!file) { console.log('건너뜀(기록 없음):', s.id); continue; }
  const rec = JSON.parse(fs.readFileSync(new URL(`./test/real/${file}`, import.meta.url), 'utf8'));
  const ev = evaluate(parseJson(rec.answer), s.text, s.base || SAMPLE_BASE_DATE);
  console.log(s.id.padEnd(10), file.padEnd(18), '걸린 항목', ev.verified.flagged, '· 놓친 기한', ev.verified.missedDates.length);
  out[s.id] = { via, answer: JSON.stringify(parseJson(rec.answer)) };
}
fs.writeFileSync(new URL('./js/recorded.js', import.meta.url), `// 자동 생성(gen-recorded.mjs) — 예시 문서별로 미리 받아 둔 실제 AI 답. 지금 호출한 것이 아니라 기록입니다.\nexport const RECORDED = ${JSON.stringify(out, null, 1)};\n`);
console.log('js/recorded.js 생성');
