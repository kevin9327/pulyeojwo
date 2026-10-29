// 화면. DOM 은 innerHTML 없이 만든다(붙여 넣은 글이 화면을 깨거나 스크립트를 심지 못하게).
import { analyzeLocal, verifyAI, calendarEvents, buildICS, maskSensitive, unmask, normalizeText, highlightTerms, daysBetween, formatWon, OFFICIAL_CHECKS, weekdayOf, bigramOverlap } from './engine.js';
import { analyzeWithAI, PROVIDERS, buildManualPrompt, parseJson } from './llm.js';
import { runAgent, evaluate, problemsOf, problemScore } from './agent.js';
import { SAMPLES, SAMPLE_BASE_DATE } from './samples.js';
import { RECORDED } from './recorded.js';

const $ = (s, r = document) => r.querySelector(s);
// 화면의 '더 가릴 말' 칸(쉼표·줄바꿈으로 구분)까지 함께 가린다
const extraWords = () => (($('#mask-words') || {}).value || '').split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
// 받침이 있으면 ‘을’, 없으면 ‘를’ (한글이 아니거나 비어 있으면 ‘을(를)’)
function josa(word, withBatchim, without) { const c = String(word || '').trim().slice(-1).charCodeAt(0); if (!(c >= 0xac00 && c <= 0xd7a3)) return `${withBatchim}(${without})`; return (c - 0xac00) % 28 ? withBatchim : without; }
const maskExtra = (t, st) => maskSensitive(t, st, extraWords());
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

const state = { sampleId: null, file: null };
const todayReal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sampleBase = (id) => (SAMPLES.find((x) => x.id === id) || {}).base || SAMPLE_BASE_DATE;
const baseDate = () => (state.sampleId ? sampleBase(state.sampleId) : todayReal());

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600); }
async function copy(text, msg = '복사했습니다') { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('복사하지 못했습니다. 직접 선택해 복사하세요.'); } }

// ------------------------------------------------------------------ 입력 영역
const samplesEl = $('#samples');
for (const s of SAMPLES) {
  samplesEl.append(h('button', { class: `chip ${s.id === 'smishing' || s.scam ? 'scam' : ''}`, type: 'button', on: { click: () => { state.sampleId = s.id; $('#doc').value = s.text; showTab('text'); updateToday(); run(); } } }, s.title, h('small', {}, s.badge)));
}
function showTab(which) {
  const text = which === 'text';
  $('#tab-text').classList.toggle('on', text); $('#tab-file').classList.toggle('on', !text);
  $('#tab-text').setAttribute('aria-selected', text); $('#tab-file').setAttribute('aria-selected', !text);
  $('#pane-text').hidden = !text; $('#pane-file').hidden = text;
}
$('#tab-text').onclick = () => showTab('text');
$('#tab-file').onclick = () => showTab('file');
$('#doc').addEventListener('input', () => { state.sampleId = null; updateToday(); });
$('#file').addEventListener('change', (e) => { state.file = e.target.files[0] || null; $('#file-name').textContent = state.file ? `${state.file.name} (${Math.round(state.file.size / 1024)}KB)` : '촬영한 사진이나 PDF를 올리면 AI가 글자를 읽어 줍니다'; });
const emptyNode = $('#empty');
$('#clear').onclick = () => { $('#doc').value = ''; state.sampleId = null; state.file = null; $('#file').value = ''; $('#file-name').textContent = '촬영한 사진이나 PDF를 올리면 AI가 글자를 읽어 줍니다'; $('#result').replaceChildren(emptyNode); updateToday(); };
function updateToday() { $('#today').textContent = state.sampleId ? `오늘 기준: ${sampleBase(state.sampleId)} (예시 문서의 기준일)` : `오늘 기준: ${todayReal()}`; }

// AI 설정
const provSel = $('#provider'), modelIn = $('#model'), keyIn = $('#key'), rememberCb = $('#remember');
function syncAiState() {
  const on = !!keyIn.value.trim();
  const pill = $('#ai-state');
  pill.className = `pill ${on ? 'on' : 'off'}`;
  pill.textContent = on ? `켜짐 · ${PROVIDERS[provSel.value].label}` : '꺼짐 · 이 기기에서만 분석';
  modelIn.placeholder = PROVIDERS[provSel.value].model;
}
// 키는 제공자별로 따로 둔다(드롭다운을 바꿔도 Gemini 키가 OpenAI로 가지 않게). 저장은 사용자가 체크했을 때만.
const keys = {};
for (const pv of Object.keys(PROVIDERS)) keys[pv] = store.get(`pg.key.${pv}`) || '';
provSel.value = store.get('pg.provider') || 'gemini';
let curProv = provSel.value;
modelIn.value = store.get('pg.model') || '';
keyIn.value = keys[curProv] || '';
rememberCb.checked = Object.values(keys).some(Boolean);
function persistKeys() { for (const pv of Object.keys(PROVIDERS)) { if (rememberCb.checked && keys[pv]) store.set(`pg.key.${pv}`, keys[pv]); else store.del(`pg.key.${pv}`); } }
provSel.addEventListener('input', () => { keys[curProv] = keyIn.value; curProv = provSel.value; keyIn.value = keys[curProv] || ''; store.set('pg.provider', curProv); modelIn.value = ''; store.set('pg.model', ''); persistKeys(); syncAiState(); });
for (const el of [modelIn, keyIn, rememberCb]) el.addEventListener('input', () => { keys[curProv] = keyIn.value; store.set('pg.model', modelIn.value); persistKeys(); syncAiState(); });
syncAiState(); updateToday();

// ------------------------------------------------------------------ 실행
const fileToBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file); });

async function run() {
  const go = $('#go');
  const key = keyIn.value.trim();
  const useFile = !$('#pane-file').hidden && state.file;
  const text = normalizeText($('#doc').value);
  if (!useFile && text.length < 8) { toast('풀어 볼 글을 먼저 넣어 주세요'); return; }
  if (useFile && !key) { toast('사진·PDF는 AI 키가 있어야 읽을 수 있어요'); $('#ai-box').open = true; return; }
  if (useFile && provSel.value === 'openai' && state.file.type === 'application/pdf') { toast('OpenAI 로는 PDF를 읽을 수 없어요. 사진으로 올리거나 Gemini·Claude를 고르세요'); return; }
  go.disabled = true; go.textContent = '풀고 있어요…';
  const steps = [{ name: '① 읽기', st: 'done' }, { name: '② 날짜·금액 뽑기(이 기기)', st: 'done' }, { name: '③ 쉬운 말로 풀기(AI)', st: key ? 'pending' : 'skip' }, { name: '④ 원문과 맞춰 보기', st: key ? 'pending' : 'skip' }, { name: '⑤ 챙기기', st: 'done' }];
  let agent = null, error = null, masked = false;
  try {
    let image = null;
    if (useFile) image = { mime: state.file.type || 'application/octet-stream', base64: await fileToBase64(state.file) };
    let local, verified = null;
    if (key) {
      const mstate = { map: new Map(), counters: {} };
      const mask = (s) => (!image && $('#mask').checked ? maskExtra(s, mstate).masked : s);
      const callAI = async ({ text: tx, today, image: im, repair }) => {
        const rep = repair ? { previous: JSON.parse(mask(JSON.stringify(repair.previous))), problems: repair.problems.map(mask) } : null;
        const raw = await analyzeWithAI({ provider: provSel.value, key, model: modelIn.value.trim(), text: mask(tx || '(첨부된 문서를 읽어 주세요)'), today, image: im, repair: rep });
        return JSON.parse(unmask(JSON.stringify(raw), mstate.map));
      };
      try {
        agent = await runAgent({ text, today: baseDate(), callAI, image });
        masked = mstate.map.size > 0;
        steps[2].st = 'done'; steps[3].st = 'done';
        if (agent.repaired) steps.splice(4, 0, { name: agent.adopted ? `④′ 걸린 ${agent.rounds[1].problems}곳 AI가 다시 고침` : `④′ 다시 요청(나아지지 않아 처음 답 유지)`, st: agent.adopted ? 'done' : 'fail' });
        local = agent.local; verified = agent.verified;
      } catch (e) { error = `AI 호출에 실패해 이 기기 분석만 보여 드립니다. (${e.message})`; steps[2].st = 'fail'; steps[3].st = 'skip'; }
    }
    if (!local) local = analyzeLocal(text, { base: baseDate() });
    render({ local, verified, steps, error, masked, usedAI: !!verified, provider: PROVIDERS[provSel.value].label, agent });
  } catch (e) {
    $('#result').replaceChildren(h('div', { class: 'card' }, h('div', { class: 'err' }, `문제가 생겼어요: ${e.message}`)));
  } finally { go.disabled = false; go.textContent = '풀어줘'; }
}
$('#go').onclick = run;

// ------------------------------------------------------------------ 결과 그리기
const LEVEL = { low: ['알려진 위험 신호를 못 찾았어요', '안전하다는 뜻은 아니에요. 중요한 건 기관에 직접 확인하세요'], medium: ['확인이 필요해요', '링크·전화번호를 바로 누르지 마세요'], high: ['사기 의심이 높아요', '링크·앱·송금 모두 하지 마세요'] };

function ddayChip(iso) {
  const n = daysBetween(baseDate(), iso);
  const cls = n < 0 ? 'past' : n === 0 ? 'today' : n <= 7 ? 'soon' : '';
  return h('span', { class: `dday ${cls}` }, n === 0 ? '오늘' : n > 0 ? `D-${n}` : `${-n}일 지남`);
}
const dateLabel = (iso, time) => { const [y, m, d] = iso.split('-'); return `${Number(m)}월 ${Number(d)}일(${weekdayOf(iso)})${time ? ' ' + time : ''}`; };

function render({ local, verified, steps, error, masked, usedAI, provider, agent, extra }) {
  const out = [];
  if (error) out.push(h('div', { class: 'err' }, error));
  const scam = verified ? verified.scam : { level: local.scam.level };
  const risky = scam.level === 'high';
  const [vt, vs] = LEVEL[scam.level];
  const oneLine = verified?.oneLine || localSummary(local);
  out.push(h('div', { class: 'card head-card' },
    h('div', { class: 'txt' }, h('span', { class: 'doc-type' }, local.docType), h('div', { class: 'one-line' }, oneLine, verified?.oneLineIssues?.length ? h('div', { class: 'ev', style: 'color:#9a4a00;font-size:13px;font-weight:400' }, '⚠ 원문에서 확인 안 됨: ' + verified.oneLineIssues.join(', ')) : null),
      h('div', { class: 'steps' }, steps.map((s) => h('span', { class: `step ${s.st === 'pending' ? '' : s.st}` }, s.name)))),
    h('div', { class: `verdict ${scam.level}` }, vt, h('small', {}, vs))));

  if (local.truncated) out.push(h('div', { class: 'callout warn' }, '글이 너무 길어 앞 3만 자만 분석했어요. 뒤쪽의 기한·금액은 빠졌을 수 있으니 원문을 직접 확인하세요.'));
  if (extra) out.push(extra);
  if (agent?.repaired) out.push(h('div', { class: 'callout info' }, agent.adopted ? `검증에서 ${agent.rounds[1].problems}곳이 걸려 AI에게 그 부분만 다시 고치게 했어요 (걸린 항목 ${agent.rounds[0].flagged + agent.rounds[0].missed}개 → ${agent.rounds[1].flagged + agent.rounds[1].missed}개).` : `검증에서 ${agent.rounds[1].problems}곳이 걸려 AI에게 다시 요청했지만 나아지지 않아 처음 답을 보여 드려요. ⚠ 표시된 항목은 원문으로 확인하세요.`));
  if (agent?.imageMode) out.push(h('div', { class: 'callout warn' }, '사진·PDF는 독립적인 원문이 없어, AI가 읽어 낸 글자를 기준으로 맞춰 봤어요. 중요한 날짜·금액은 사진과 직접 비교하세요.'));
  // 해야 할 일 (사기 의심이 높으면 '하지 마세요' 목록으로)
  const todo = buildTodo(local, verified);
  if (risky) out.push(h('div', { class: 'card' }, h('h2', {}, '이 문서가 요구하는 것 — 하지 마세요'),
    h('div', { class: 'callout bad' }, '사기 의심이 높아 일정·할 일로 만들지 않았어요. 아래 요구를 따르지 말고, 공식 번호로 직접 확인하세요.'),
    todo.length ? h('ul', { class: 'plain' }, todo.map((t) => h('li', {}, '✗ ', t.task))) : null));
  else out.push(h('div', { class: 'card' }, h('h2', {}, '꼭 해야 할 일'),
    todo.length ? h('ul', { class: 'todo' }, todo.map((t) => h('li', { class: t.warn ? 'warn' : '' },
      h('input', { type: 'checkbox', 'aria-label': t.task }),
      h('div', {}, h('div', { class: 'task' }, sourceTag(t), t.task), t.evidence ? h('div', { class: 'ev' }, '원문: ', t.evidence) : null, t.note ? h('div', { class: 'ev', style: 'color:#9a4a00' }, t.note) : null),
      t.due ? h('div', { class: 'due' }, dateLabel(t.due, t.time), h('small', {}, ddayChip(t.due))) : h('div', { class: 'due' }, h('small', {}, '날짜 없음'))))) : h('p', { class: 'note' }, '글에서 ‘해 달라’는 요청 문장을 찾지 못했어요.'),
    local.relative.length ? h('div', { class: 'callout info' }, '상대 기한도 있어요: ', local.relative.map((r) => `“${r.phrase}”`).join(', '), ' — 시작일(받은 날 등)부터 세므로 원문 기준을 확인하세요.') : null,
    verified?.missedDates.length ? h('div', { class: 'callout warn' }, 'AI가 빠뜨린 기한을 원문에서 찾았어요: ', verified.missedDates.map((d) => d.raw).join(', ')) : null));

  // 돈
  out.push(moneyCard(local, verified));

  // 하지 않으면
  const cons = verified && verified.consequences.length ? verified.consequences.map((c) => ({ text: c.text, ev: c.evidence, st: c.ok ? 'exact' : 'missing', reason: c.reason })) : local.consequences.map((s) => ({ text: s, ev: '', st: 'exact' }));
  if (cons.length) out.push(h('div', { class: 'card' }, h('h2', {}, '기한을 놓치면'), h('ul', { class: 'plain' }, cons.map((c) => h('li', {}, c.st === 'missing' ? h('span', { class: 'tag bad' }, c.reason || '원문에서 확인 안 됨') : null, c.text, c.ev && c.ev !== c.text ? h('div', { class: 'ev', style: 'font-size:.82rem;color:#566783' }, '원문: ', c.ev) : null)))));

  // 쉬운 말 풀이
  if (verified?.plain.length) out.push(h('div', { class: 'card' }, h('h2', {}, h('span', { class: 'tag ai' }, `AI · ${provider}`), '쉬운 말로 풀면'), h('ul', { class: 'plain' }, verified.plain.map((p, i) => h('li', {}, (verified.plainIssues?.[i] || []).length ? h('span', { class: 'tag bad' }, '원문에서 확인 안 됨: ' + verified.plainIssues[i].join(', ')) : null, p))),
    verified.questions.length ? [h('h3', {}, '기관에 확인하면 좋은 점'), h('ul', { class: 'plain' }, verified.questions.map((q) => h('li', {}, q)))] : null));

  // 사기 점검
  out.push(scamCard(local, verified));

  // 어려운 말
  const terms = mergeTerms(local, verified);
  if (terms.length) out.push(h('div', { class: 'card' }, h('h2', {}, '어려운 말 풀이'), h('div', { class: 'terms' }, terms.map((t) => h('div', {}, h('b', {}, t.term), ' — ', t.easy)))));

  // 원문 보기
  out.push(h('div', { class: 'card' }, h('h2', {}, '원문에서 표시한 곳'),
    h('div', { class: 'legend' }, h('span', { class: 'd deadline', style: 'background:#ffc9c9' }, '기한'), h('span', { style: 'background:#ffe9b8' }, '그 밖의 날짜'), h('span', { style: 'background:#cfeeff' }, '금액'), h('span', { style: 'border-bottom:2px dotted #1a56db' }, '어려운 말(눌러 보기)')),
    sourceView(local)));

  // 챙기기
  out.push(actionsCard(local, verified, masked, usedAI, risky));
  $('#result').replaceChildren(...out);
}

function localSummary(local) {
  if (local.scam.level === 'high') return '사기 의심이 높아요. 링크·앱 설치·송금은 하지 말고 공식 번호로 직접 확인하세요.';
  const dl = local.dates.filter((d) => d.role === 'deadline').map((d) => d.iso).sort();
  const pay = local.amounts.filter((a) => a.kind === 'pay');
  const bits = [];
  if (dl.length) bits.push(`가장 가까운 기한은 ${dateLabel(dl.find((x) => x >= baseDate()) || dl[0])}`);
  if (pay.length) bits.push(`내야 할 돈이 보입니다(${formatWon(Math.max(...pay.map((a) => a.krw)))} 안팎)`);
  if (local.scam.level !== 'low') bits.push('사기 의심 신호가 있어요');
  return bits.length ? `${bits.join(', ')}.` : '날짜·금액을 찾으려면 AI를 켜거나 더 자세한 글을 넣어 보세요.';
}

function buildTodo(local, verified) {
  const list = [];
  if (verified) for (const t of verified.must) {
    const bad = !t.ok;
    list.push({ task: t.task, due: bad ? null : t.due, time: t.time, evidence: t.evidence, from: 'ai', ok: !bad, warn: bad, note: bad ? `⚠ ${t.reason}${t.due ? ` (AI가 말한 기한: ${t.due})` : ''} — 일정에서 뺐어요. 원문을 확인하세요.` : null });
  }
  for (const a of local.actions) {
    if (verified && verified.must.some((t) => t.due && t.due === a.due)) continue;
    if (verified && verified.must.some((t) => bigramOverlap(t.task + ' ' + t.evidence, a.text) >= 0.6)) continue;   // 같은 문장을 AI도 이미 말한 경우
    list.push({ task: a.text, due: a.due, time: a.time, evidence: '', from: 'local', ok: true, warn: false });
  }
  return list.sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999'));
}
function sourceTag(t) { return t.from === 'ai' ? h('span', { class: `tag ${t.ok ? 'ok' : 'bad'}` }, t.ok ? 'AI·날짜·금액·인용 일치 ✓' : 'AI·확인 필요') : h('span', { class: 'tag local' }, '이 기기에서 찾음'); }

function moneyCard(local, verified) {
  const rows = [];
  if (verified && verified.money.length) {
    for (const m of verified.money) rows.push({ label: m.label, krw: m.krw, ok: m.ok, reason: m.reason, ai: true, recv: /환급|지급|받/.test(m.label) });
  } else for (const a of local.amounts) rows.push({ label: `${a.label} ${a.kind === 'receive' ? '(받을 돈)' : a.kind === 'pay' ? '(낼 돈)' : ''}`.trim(), krw: a.krw, ok: true, ai: false, recv: a.kind === 'receive' });
  if (!rows.length && !local.accounts.length) return h('div', { class: 'card' }, h('h2', {}, '돈'), h('p', { class: 'note' }, '금액을 찾지 못했어요.'));
  return h('div', { class: 'card' }, h('h2', {}, '돈'),
    h('div', { class: 'money' }, rows.map((r) => h('div', { class: 'm' }, h('div', {}, r.ai ? h('span', { class: `tag ${r.ok ? 'ok' : 'bad'}` }, r.ok ? 'AI·날짜·금액·인용 일치 ✓' : (r.reason || '원문에 없는 금액')) : null, r.label), h('div', { class: `amt ${r.recv ? 'recv' : ''}` }, r.krw == null ? '-' : formatWon(r.krw))))),
    local.totals.map((t) => h('div', { class: `callout ${t.ok ? 'ok' : 'bad'}` }, t.ok ? `합계 ${formatWon(t.total)} = ${t.parts.map(formatWon).join(' + ')} ✓ 검산이 맞아요` : `⚠ 합계 ${formatWon(t.total)} 가 앞의 금액을 더한 값(${formatWon(t.sum)})과 달라요. 기관에 확인하세요.`)),
    local.accounts.length ? [h('h3', {}, '입금 계좌 (원문 그대로)'), local.accounts.map((a) => h('div', { class: 'acct' }, a.raw, h('button', { class: 'ghost', type: 'button', on: { click: () => copy(a.raw, '계좌번호를 복사했습니다') } }, '복사')))] : null,
    local.accounts.length ? h('p', { class: 'note' }, '입금 전에 기관의 공식 누리집·고지서에 적힌 계좌와 같은지 꼭 비교하세요.') : null);
}

function scamCard(local, verified) {
  const lvl = verified ? verified.scam.level : local.scam.level;
  const reasons = local.scam.reasons;
  return h('div', { class: 'card' }, h('h2', {}, '사기 의심 점검'),
    h('div', { class: `callout ${lvl === 'high' ? 'bad' : lvl === 'medium' ? 'warn' : 'ok'}` }, `${LEVEL[lvl][0]} — ${LEVEL[lvl][1]}`),
    verified?.scam.raisedByRules ? h('div', { class: 'callout warn' }, 'AI는 더 낮게 봤지만, 원문의 위험 신호가 확인돼 높게 유지했어요. (AI 판단이 규칙 점검을 낮출 수 없어요)') : null,
    reasons.length ? h('ul', { class: 'plain' }, reasons.map((r) => h('li', {}, h('b', {}, r.label), ' ', h('span', { class: 'ev', style: 'color:#566783' }, r.evidence)))) : h('p', { class: 'note' }, '글 안에서 알려진 사기 신호를 찾지 못했어요.'),
    verified?.scam.aiReasons.length ? h('ul', { class: 'plain' }, verified.scam.aiReasons.map((r) => h('li', {}, h('span', { class: 'tag ai' }, 'AI'), r))) : null,
    lvl !== 'low' ? h('div', { class: 'checks' }, OFFICIAL_CHECKS.map((c) => h('a', { href: `tel:${c.tel}` }, `${c.tel} ${c.name}`))) : null);
}

function mergeTerms(local, verified) {
  const seen = new Set(); const out = [];
  for (const t of [...(verified?.terms || []), ...local.terms]) if (!seen.has(t.term)) { seen.add(t.term); out.push(t); }
  return out.slice(0, 16);
}

function sourceView(local) {
  const text = local.text;
  const marks = [];
  for (const d of local.dates) marks.push({ s: d.index, e: d.end, cls: `d ${d.role}` });
  for (const a of local.amounts) marks.push({ s: a.index, e: a.index + a.raw.length, cls: 'a' });
  marks.sort((x, y) => x.s - y.s);
  const kids = []; let last = 0;
  const plain = (str) => { for (const p of highlightTerms(str)) kids.push(p.easy ? h('abbr', { class: 't', title: p.easy, tabIndex: 0, on: { click: () => toast(`${p.text}: ${p.easy}`) } }, p.text) : p.text); };
  for (const m of marks) {
    if (m.s < last) continue;
    if (m.s > last) plain(text.slice(last, m.s));
    kids.push(h('mark', { class: m.cls }, text.slice(m.s, m.e)));
    last = m.e;
  }
  if (last < text.length) plain(text.slice(last));
  return h('div', { class: 'src' }, kids);
}

function actionsCard(local, verified, masked, usedAI, risky) {
  const events = risky ? [] : calendarEvents({ verified, local, docType: local.docType });
  const ics = events.length ? buildICS(events) : '';
  const checklist = (risky ? [] : buildTodo(local, verified)).map((t) => `□ ${t.task}${t.due ? ` (${dateLabel(t.due, t.time)})` : ''}`).join('\n');
  // 사기 의심이 높으면 ‘답장하세요’ 초안을 만들지 않는다(사기범에게 답장하게 하는 꼴이 된다)
  const reply = risky ? '답장하지 마세요. 문서가 요구하는 링크·앱 설치·송금은 따르지 말고, 한국인터넷진흥원 118 또는 경찰 112에 신고하거나 해당 기관의 공식 번호로 직접 확인하세요.' : (verified?.reply || localReply(local));
  const body = [h('div', { class: 'btns' },
    events.length ? h('a', { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })), download: '풀어줘_기한.ics' }, `캘린더에 담기 (.ics · 일정 ${events.length}개, 7일 전·1일 전 알림)`) : null,
    h('button', { class: 'sec', type: 'button', on: { click: () => copy(checklist, '할 일 목록을 복사했습니다') } }, '할 일 목록 복사')),
  events.length ? h('ul', { class: 'plain' }, events.map((e) => h('li', {}, `${dateLabel(e.iso, e.time)} — ${e.title.replace('[공문] ', '')}`))) : h('p', { class: 'note' }, risky ? '사기 의심이 높은 문서라 캘린더 일정은 만들지 않았어요.' : '캘린더에 담을 기한을 찾지 못했어요.'),
  h('h3', {}, risky ? '답장하지 마세요' : usedAI && verified?.reply ? '문의·답장 초안 (AI)' : '문의·답장 초안'),
  verified?.replyIssues?.length ? h('div', { class: 'callout warn' }, '⚠ 초안에 원문에 없는 ' + verified.replyIssues.join(', ') + ' 이 들어 있어요. 보내기 전에 고치세요.') : null,
  h('pre', { class: 'draft' }, reply),
  h('div', { class: 'btns', style: 'margin-top:10px' }, h('button', { class: 'sec', type: 'button', on: { click: () => copy(reply, '초안을 복사했습니다') } }, '초안 복사')),
  masked ? h('div', { class: 'callout info' }, 'AI에 보낼 때 주민번호·계좌·전화·이메일은 가려서 보냈어요.') : null,
  !usedAI ? h('div', { class: 'callout info' }, 'AI를 켜면 쉬운 말 풀이, 놓친 기한 점검, 맞춤 답장 초안이 추가됩니다. (왼쪽 ‘AI 켜기’)') : null];
  return h('div', { class: 'card' }, h('h2', {}, '챙기기'), body);
}

function localReply(local) {
  const q = [];
  const dl = local.dates.find((d) => d.role === 'deadline');
  if (dl && dl.weekdayMismatch) q.push(`원문에는 ‘${dl.raw}’로 적혀 있는데 적힌 요일(${dl.weekdayGiven})과 실제 요일(${dl.weekday})이 달라, 어느 쪽이 맞는지 확인 부탁드립니다.`);
  else if (dl) q.push(`${dateLabel(dl.iso, dl.time)}까지라고 안내받았는데, 이 날짜가 맞는지 확인 부탁드립니다.`);
  if (local.amounts.some((a) => a.kind === 'pay')) q.push('안내된 금액의 산출 근거와 납부 방법(공식 계좌)을 알려 주세요.');
  q.push('제출·납부 후 접수되었는지 확인할 수 있는 방법이 있을까요?');
  return `안녕하세요. ${local.docType}${josa(local.docType, '을', '를')} 받았습니다.\n${q.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n바쁘시겠지만 답변 부탁드립니다. 감사합니다.`;
}

// 첫 화면에서 예시를 바로 볼 수 있게 주소에 ?sample=fine 지원
const want = new URLSearchParams(location.search).get('sample');
const pre = SAMPLES.find((s) => s.id === want);
if (pre) { state.sampleId = pre.id; $('#doc').value = pre.text; updateToday(); run(); }

// ------------------------------------------------------------------ 키 없이 보기: 예시 문서에 대해 미리 받아 둔 실제 AI 답을 검증기에 넣어 보여 준다
$('#rec-btn').onclick = () => {
  const s = SAMPLES.find((x) => x.id === state.sampleId);
  const rec = s && RECORDED[s.id];
  if (!s || !rec || $('#doc').value !== s.text) { toast('먼저 위의 예시 문서를 하나 눌러 주세요(글을 고치면 기록과 달라져 쓸 수 없어요)'); return; }
  const ai = JSON.parse(rec.answer);
  const cur = evaluate(ai, s.text, sampleBase(s.id));
  const steps = [{ name: '① 읽기', st: 'done' }, { name: '② 날짜·금액 뽑기(이 기기)', st: 'done' }, { name: '③ 쉬운 말로 풀기(기록된 AI 답)', st: 'done' }, { name: '④ 원문과 맞춰 보기', st: 'done' }, { name: '⑤ 챙기기', st: 'done' }];
  const extra = h('div', { class: 'callout warn' }, `이 화면은 지금 AI를 부른 것이 아니라, 미리 받아 둔 실제 답(${rec.via})을 같은 검증기에 넣은 기록 재생입니다. 내 글로 쓰려면 ‘AI 켜기’에서 키를 넣거나 챗봇 복사·붙여넣기를 쓰세요.`);
  render({ local: cur.local, verified: cur.verified, steps, error: null, masked: false, usedAI: true, provider: `${rec.via.split(' · ')[0]}(기록)`, agent: null, extra });
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ------------------------------------------------------------------ 키 없이 쓰기: 챗봇에 복사·붙여넣기
// API 키가 없어도 gemini.google.com 같은 챗봇에 질문을 붙여넣고 받은 JSON 답을 넣으면 같은 검증·자기 점검이 돈다.
const manual = { text: '', today: '', mstate: null, best: null, stage: 'idle' };
$('#m-copy').onclick = async () => {
  if (!$('#pane-file').hidden && state.file) { toast('사진·PDF는 복사·붙여넣기 모드에서 쓸 수 없어요(글만 가능)'); return; }
  const text = normalizeText($('#doc').value);
  if (text.length < 8) { toast('먼저 풀어 볼 글을 넣어 주세요'); return; }
  Object.assign(manual, { text, today: baseDate(), mstate: { map: new Map(), counters: {} }, best: null, stage: 'asked' });
  const sendText = $('#mask').checked ? maskExtra(text, manual.mstate).masked : text;
  await copy(buildManualPrompt(sendText, manual.today), '질문을 복사했어요. 챗봇에 붙여넣어 보내 주세요');
};
$('#m-go').onclick = () => manualSubmit();

function manualSubmit() {
  try { manualSubmitInner(); } catch (e) { toast(`답을 처리하지 못했어요: ${e.message}`); }
}
function manualSubmitInner() {
  if (manual.stage === 'idle') { toast('먼저 ‘질문 복사’를 눌러 질문을 만들어 주세요'); return; }
  let raw;
  try { raw = parseJson($('#m-answer').value); } catch { toast('답에서 JSON 을 찾지 못했어요. 챗봇의 답 전체를 붙여 넣어 주세요'); return; }
  const ai = JSON.parse(unmask(JSON.stringify(raw), manual.mstate.map));
  const cur = evaluate(ai, manual.text, manual.today);
  const prev = manual.best;
  let adopted = false, agent = null;
  if (manual.stage === 'repair' && prev) {
    adopted = problemScore(cur.verified) < problemScore(prev.verified);
    if (adopted) manual.best = { ai, ...cur };
    agent = { repaired: true, adopted, manual: true, rounds: [{ flagged: prev.verified.flagged, missed: prev.verified.missedDates.length }, { problems: problemsOf(prev.verified).length, flagged: cur.verified.flagged, missed: cur.verified.missedDates.length }] };
  } else manual.best = { ai, ...cur };
  const best = manual.best;
  const problems = problemsOf(best.verified);
  const canRepair = problems.length > 0 && !agent;
  manual.stage = canRepair ? 'repair-ready' : 'done';
  const steps = [{ name: '① 읽기', st: 'done' }, { name: '② 날짜·금액 뽑기(이 기기)', st: 'done' }, { name: '③ 쉬운 말로 풀기(챗봇)', st: 'done' }, { name: '④ 원문과 맞춰 보기', st: 'done' }];
  if (agent) steps.push({ name: adopted ? `④′ 걸린 ${agent.rounds[1].problems}곳 다시 고침` : '④′ 다시 요청(나아지지 않아 처음 답 유지)', st: adopted ? 'done' : 'fail' });
  steps.push({ name: '⑤ 챙기기', st: 'done' });
  let extra = null;
  if (canRepair) {
    const sendPrev = $('#mask').checked ? JSON.parse(maskExtra(JSON.stringify(best.ai), manual.mstate).masked) : best.ai;
    const mp = $('#mask').checked ? problems.map((p) => maskExtra(p, manual.mstate).masked) : problems;
    const sendText = $('#mask').checked ? maskExtra(manual.text, manual.mstate).masked : manual.text;
    extra = h('div', { class: 'card' }, h('h2', {}, `검증에서 ${problems.length}곳이 걸렸어요 — 챗봇에게 한 번 더 고치게 할까요?`),
      h('ul', { class: 'plain' }, problems.slice(0, 6).map((p) => h('li', {}, p))),
      h('div', { class: 'btns' }, h('button', { type: 'button', id: 'm-repair', on: { click: async () => { manual.stage = 'repair'; await copy(buildManualPrompt(sendText, manual.today, { previous: sendPrev, problems: mp }), '수정 요청을 복사했어요. 같은 대화에 붙여넣고, 받은 답을 위 칸에 다시 넣어 주세요'); } } }, '수정 요청 복사')));
  }
  render({ local: best.local, verified: best.verified, steps, error: null, masked: manual.mstate.map.size > 0, usedAI: true, provider: '챗봇(복사·붙여넣기)', agent, extra });
}
