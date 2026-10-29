// 에이전트 루프: 읽기 → (AI 풀이) → 검증 → 걸린 게 있으면 AI에게 '그 부분만' 다시 고치게 하고 → 다시 검증.
// AI 호출은 callAI 로 주입한다(브라우저에서는 llm.js, 테스트에서는 가짜). 화면과 분리해 순수하게 시험할 수 있다.
import { analyzeLocal, verifyAI, normalizeText } from './engine.js';

const rawOf = (d) => d.raw || d.iso;

// 검증 결과 → AI에게 알려 줄 문제 목록(사람이 읽는 문장)
export function problemsOf(v) {
  const out = [];
  for (const t of v.must) if (!t.ok) out.push(`할 일 “${t.task}”: ${t.reason}${t.due && t.dueVerified === false ? `(AI가 말한 기한 ${t.due})` : ''}.`);
  for (const m of v.money) if (!m.ok) out.push(`금액 “${m.label}”${m.krw != null ? ` ${m.krw}원` : ''}: ${m.reason}.`);
  for (const c of v.consequences) if (!c.ok) out.push(`불이익 “${c.text}”: ${c.reason}.`);
  if (v.oneLineIssues?.length) out.push(`한 줄 요약: 원문에 없는 ${v.oneLineIssues.join(', ')} 이 들어 있습니다.`);
  (v.plainIssues || []).forEach((x, i) => { if (x.length) out.push(`쉬운 풀이 ${i + 1}번: 원문에 없는 ${x.join(', ')} 이 들어 있습니다.`); });
  if (v.replyIssues?.length) out.push(`답장 초안: 원문에 없는 ${v.replyIssues.join(', ')} 이 들어 있습니다.`);
  for (const d of v.missedDates) out.push(`원문의 기한 ${rawOf(d)}(${d.iso}) 이 must_do 에서 빠졌습니다.`);
  return out;
}

export const problemScore = (v) => v.flagged + v.missedDates.length;
const score = problemScore;
const okItems = (v) => v.must.filter((t) => t.ok).length + v.money.filter((m) => m.ok).length;   // 멀쩡한 항목 수

// AI 답 하나를 원문과 대조해 평가한다(API 호출이든 복사·붙여넣기든 같은 길을 탄다)
export function evaluate(ai, text, today, { image = false } = {}) {
  const sourceText = image ? normalizeText(ai.source_text || '') : normalizeText(text);
  const local = analyzeLocal(sourceText, { base: today });
  const verified = verifyAI(ai, local.text, local, { base: today });
  return { local, verified, sourceText };
}

export async function runAgent({ text, today, callAI, image = null, maxRepairs = 1 }) {
  let ai = await callAI({ text, today, image });
  // 사진·PDF 는 AI가 읽어 낸 글자를 '원문'으로 삼는다(독립적인 원문이 없다)
  const first = evaluate(ai, text, today, { image: !!image });
  const { sourceText, local } = first;
  let verified = first.verified;
  const rounds = [{ flagged: verified.flagged, missed: verified.missedDates.length }];
  let adopted = false;
  for (let r = 0; r < maxRepairs; r++) {
    const problems = problemsOf(verified);
    if (!problems.length) break;
    let fixed;
    try { fixed = await callAI({ text: sourceText || text, today, image: null, repair: { previous: ai, problems } }); } catch { break; }
    const v2 = verifyAI(fixed, local.text, local, { base: today });
    rounds.push({ flagged: v2.flagged, missed: v2.missedDates.length, problems: problems.length });
    if (score(v2) < score(verified) && okItems(v2) >= okItems(verified)) { ai = { ...fixed, source_text: ai.source_text }; verified = v2; adopted = true; }   // 확실히 나아졌을 때만 받아들인다
    else break;
  }
  return { ai, verified, local, rounds, repaired: rounds.length > 1, adopted, imageMode: !!image };
}
