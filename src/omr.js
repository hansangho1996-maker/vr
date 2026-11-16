// 악보 이미지 인식(OMR) 보조 모듈 — DOM 의존성 없음 (Node 테스트 가능)
//
// 흐름
//   1) 페이지에서 오선을 찾고(layout.js), 번호를 붙인 이미지를 Claude에게 보여 단(system)으로 묶는다.
//   2) 단마다 잘라서 크게 보내고, 아래 JSON 형식으로 받아 적게 한다.
//   3) 박자 합이 안 맞는 단은 문제 목록과 함께 한 번 더 검토시킨다.
//   4) 모든 단을 이어 붙여(mergeSystems) MusicXML로 만든다(buildMusicXml).

const DIVISIONS = 24; // 4분음표 = 24 (셋잇단 16분음표까지 정수)
const BASE = { w: 96, h: 48, q: 24, 8: 12, 16: 6, 32: 3 };
const TYPE_NAME = { w: 'whole', h: 'half', q: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };
const STEP_FIFTHS_ORDER = 'FCGDAEB';
const ACC = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const CLEFS = { G: ['G', 2], F: ['F', 4], C: ['C', 3], T: ['C', 4], P: ['percussion', 2], G8: ['G', 2, -1] };
const DYNAMICS = new Set(['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sf', 'sfz', 'sffz', 'fp', 'rf', 'rfz', 'fz', 'sfp']);
const ARTICULATIONS = { stacc: 'staccato', acc: 'accent', ten: 'tenuto', marc: 'strong-accent', stacs: 'staccatissimo' };

// ---------------------------------------------------------------- 프롬프트

export const SYSTEM_FORMAT = `{
  "title": "곡 제목 (이 이미지에 보일 때만, 아니면 생략)",
  "staves": [{"part": "Voice", "clef": "G"}, {"part": "Piano", "clef": "G"}, {"part": "Piano", "clef": "F"}],
  "key": {"fifths": -5, "mode": "major"},
  "time": "4/4",
  "measures": [
    {
      "dirs": [{"staff": 0, "beat": 1, "dyn": "mp"}, {"staff": 1, "beat": 1, "text": "보통 빠르기로, 곱게"}, {"staff": 0, "beat": 3, "text": "rit."}],
      "chords": [{"beat": 1, "symbol": "Dbmaj7"}],
      "staves": [
        [[{"p": "Ab4", "d": "h", "dot": 1, "slur": "start", "ly": ["국", "달"]}, {"p": "F4", "d": "8", "ly": ["화", "가"]}, {"p": "Db4", "d": "8", "slur": "stop"}]],
        [[{"p": "Db6", "d": "h", "g": 0}, {"r": 1, "d": "h"}]],
        [[{"r": 1, "d": "8"}, {"p": "Db3", "d": "8"}, {"p": "F3", "d": "8"}, {"p": "Ab3", "d": "8"}, {"p": "Db4", "d": "8"}, {"p": "Ab3", "d": "8"}, {"p": "F3", "d": "8"}, {"p": "Db3", "d": "8"}],
         [{"p": "Db2", "d": "w"}]]
      ]
    }
  ]
}`;

const RULES = `규칙:
- "staves": 이 이미지의 오선을 위에서 아래 순서로 모두 적는다. "part"는 악기/성부 이름(같은 피아노의 두 오선은 같은 이름 "Piano"), "clef"는 G(높은음자리), F(낮은음자리), C(알토), T(테너), G8(옥타브 아래 테너용 높은음자리).
- "measures[i].staves[s]": s번째 오선의 그 마디. 성부(voice) 배열의 배열이다. 대부분 성부 하나 [[...]].
  한 오선에 리듬이 다른 두 성부가 있으면(예: 위 기둥 8분음표 + 아래 기둥 온음표 베이스) 성부 두 개 [[윗성부...], [아랫성부...]]로 나눈다. 같은 리듬으로 함께 움직이는 음은 화음으로 합친다.
- 각 성부의 길이 합은 박자표에 맞아야 한다(4/4면 온음표 하나 길이). 성부 2는 비는 구간을 쉼표로 채운다.
- 음 "p": 실제 음 이름+옥타브(가운데 도=C4). 조표와 임시표를 반영해서 적는다(예: D♭장조의 레 → "Db4"). ♯은 #, ♭은 b, 겹올림 ##, 겹내림 bb. 화음은 배열 ["Db4","F4","Ab4"].
  음높이 읽는 기준 — 덧줄 개수를 반드시 세라:
    높은음자리표: 줄(아래→위) E4 G4 B4 D5 F5 / 칸 F4 A4 C5 E5 / 위로 G5(맨 윗줄 바로 위 칸), A5(덧줄 1개 위), B5, C6(덧줄 2개), D6, E6(덧줄 3개) / 아래로 D4(맨 아랫줄 바로 아래), C4(덧줄 1개), B3, A3(덧줄 2개)
    낮은음자리표: 줄 G2 B2 D3 F3 A3 / 칸 A2 C3 E3 G3 / 위로 B3, C4(덧줄 1개), D4, E4(덧줄 2개) / 아래로 F2, E2(덧줄 1개), D2, C2(덧줄 2개), B1, A1(덧줄 3개)
  임시표는 같은 마디의 같은 줄·칸 음에 마디 끝까지 적용된다. 제자리표(♮)를 ♯/♭과 헷갈리지 마라.
  같은 가사·같은 리듬으로 반복되는 악구(예: 1절과 같은 선율이 다시 나오는 곳)는 서로 비교해서 일관되게 읽어라.
- 8va/8vb(점선 괄호) 구간의 음은 실제 소리 나는 높이(한 옥타브 위/아래)로 적고, "dirs"에는 8va를 적지 않는다.
- 쉼표: {"r": 1, "d": ...}. 길이 "d": "w" 온음표, "h" 2분, "q" 4분, "8" 8분, "16" 16분, "32" 32분. 점 "dot": 1(겹점 2), 셋잇단 "t": 1.
- 붙임줄(같은 음이 이어짐): 앞 음에 "tie": 1. 이음줄(슬러): 시작 음에 "slur": "start", 끝 음에 "slur": "stop"(끝과 동시에 새로 시작이면 "stop-start"). 단을 넘어가면 시작만 적는다.
- 꾸밈음(작은 음표): "g": 1 (짧은 앞꾸밈음은 "g": 1, 사선 없는 긴 앞꾸밈음은 "g": 2), 꾸며 주는 음 바로 앞에 둔다. "d"는 보이는 모양대로.
- 늘임표 "fer": 1, 아르페지오(물결 세로선) "arp": 1, 아티큘레이션 "art": ["stacc"|"acc"|"ten"|"marc"].
- 가사 "ly": 그 음 아래 가사를 절 순서대로 배열(1절, 2절...). 그 절에 가사가 없으면 "". 한 음절씩. 가사 줄의 "-"나 밑줄(늘임)은 적지 않는다.
- "dirs": 셈여림("dyn": pp, p, mp, mf, f, ff, sf...)과 글자 지시("text": 빠르기말, rit., a tempo, cresc., dim. 등)를 붙은 오선 번호(0부터)와 박(1부터, 소수 가능)으로 적는다.
- "chords": 오선 위 코드 이름(있을 때만).
- 마디 중간에 조표/박자표가 바뀌면 그 마디에 "key"/"time"을 넣는다.
- 보이는 마디를 하나도 빼지 말고, 확실하지 않아도 최선의 추측으로 채운다. 설명 없이 JSON만 출력한다.`;

const partsNote = (n) => (n > 1
  ? `이미지 ${n}장은 한 단을 마디선에서 잘라 왼쪽부터 순서대로 나눈 것이다. 이어 붙여 하나의 단으로 받아 적어라 (같은 마디를 두 번 적지 말 것). 뒤쪽 이미지에는 음자리표·조표가 없으니 첫 이미지의 것을 그대로 적용한다.`
  : '');

export function buildSystemPrompt({ index, total, context, parts = 1 }) {
  return `너는 정확하기로 유명한 악보 판독 전문가다. 첨부한 이미지는 악보의 한 단(동시에 연주되는 오선 묶음)이다 (${index}/${total}번째 단).
${partsNote(parts)}
이 단을 첫 마디부터 끝 마디까지 빠짐없이 아래 JSON 형식으로 받아 적어라.

형식 예시:
${SYSTEM_FORMAT}

${RULES}
${context ? `\n앞 단에서 확인된 정보 (파트 이름은 같은 것을 그대로 쓴다): ${context}` : ''}`;
}

export function buildFixPrompt(json, problems, parts = 1) {
  return `첨부한 악보 단을 받아 적은 JSON을 검토하라. ${partsNote(parts)}
자동 검사에서 아래 문제가 발견되었다.
${problems.map((p) => '- ' + p).join('\n')}

이미지를 다시 꼼꼼히 보고 문제가 있는 마디를 바로잡은 전체 JSON을 같은 형식으로 출력하라. 문제가 없는 부분은 그대로 둔다.
흔한 원인: 점음표의 점 누락, 셋잇단 표시 누락, 두 성부를 하나로 합쳐 길이가 넘침, 쉼표 누락, 8분/16분 혼동.

${RULES}

받아 적은 JSON:
${JSON.stringify(json)}`;
}

export function buildVerifyPrompt(json, parts = 1) {
  const orig = parts > 1 ? `1~${parts}번째 이미지: 원본 악보의 한 단을 마디선에서 나눈 것 (정답, 왼쪽부터 순서대로)` : '첫 번째 이미지: 원본 악보의 한 단 (정답)';
  return `원본과 다시 그린 악보를 비교해 악보 받아쓰기를 교정하라.
- ${orig}
- 마지막 이미지: 아래 JSON을 다시 그린 악보 (조표·음자리표·마디 순서는 같다. 줄바꿈 위치는 다를 수 있다)

마디별·오선별로 음표 하나하나 대조해서 차이를 찾아라: 음높이(덧줄 개수, 오선 위 높은 음, 이웃한 음 B♭/C·G♭/A♭ 혼동, 제자리표 특히 주의), 리듬(점, 셋잇단, 8분/16분), 쉼표, 붙임줄·이음줄, 꾸밈음(원본에 없는 꾸밈음은 지운다), 가사 음절의 위치, 셈여림, 빠진 음.
원본이 기준이다. 아래 형식의 JSON만 출력하라:
{"changes": ["3마디 0번 오선: 두 번째 8분음표 F4 → Ab4", ...], "system": { 고친 전체 JSON (원래와 같은 형식) }}
차이가 없으면 "changes"를 빈 배열로 두고 "system"에 원래 JSON을 그대로 넣는다.

${RULES}

받아 적은 JSON:
${JSON.stringify(json)}`;
}

export function buildGroupingPrompt(count) {
  return `첨부한 악보 페이지의 오선마다 왼쪽에 빨간 번호(1~${count})를 붙였다.
동시에 연주되는 오선끼리(단, system) 묶어서 아래 형식의 JSON만 출력하라.
{"systems": [[1, 2], [3, 4, 5]]}
판단 근거: 왼쪽의 중괄호·대괄호·세로줄, 마디선의 위치, 가사가 붙은 성악 오선과 그 아래 피아노 오선의 관계, 단 사이의 넓은 여백.
모든 번호를 순서대로 한 번씩만 써야 한다.`;
}

/** 단 묶음 응답 검증: 1..n을 순서대로 빠짐없이 나눈 것인지 */
export function parseGroups(text, n) {
  const obj = extractJson(text);
  const groups = obj.systems;
  if (!Array.isArray(groups)) return null;
  const flat = groups.flat();
  if (flat.length !== n || flat.some((v, i) => v !== i + 1)) return null;
  return groups.map((g) => g.map((v) => v - 1));
}

/** 모델 응답 텍스트에서 JSON 객체를 꺼낸다. */
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('인식 결과에서 악보 데이터를 찾지 못했습니다.');
  return JSON.parse(text.slice(start, end + 1));
}

// ---------------------------------------------------------------- 형식 정리·검사

function durationOf(ev) {
  let d = BASE[ev.d] ?? BASE.q;
  if (ev.dot === 1 || ev.dot === true) d *= 1.5;
  else if (ev.dot === 2) d *= 1.75;
  if (ev.t) d = (d * 2) / 3;
  return Math.round(d);
}

function timeParts(t) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(t || '4/4'));
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [4, 4];
}

const measureLength = ([b, bt]) => Math.round((b * 4 * DIVISIONS) / bt);

/** 한 마디의 오선 데이터를 [성부][음표] 형태로 맞춘다. */
function voicesOf(staffData) {
  if (!Array.isArray(staffData) || staffData.length === 0) return [[]];
  if (staffData.every((v) => Array.isArray(v))) return staffData.length ? staffData : [[]];
  return [staffData]; // 성부 하나를 바로 음표 배열로 준 경우
}

/** 예전 형식({parts, measures[].parts}) → 새 형식으로 */
function normalizeSystem(sys) {
  if (sys.staves) return sys;
  const parts = sys.parts && sys.parts.length ? sys.parts : [{ name: 'Music', clef: 'G' }];
  return {
    ...sys,
    staves: parts.map((p) => ({ part: p.name || 'Music', clef: p.clef || 'G' })),
    measures: (sys.measures || []).map((m) => ({ ...m, staves: parts.map((_, i) => [(m.parts && m.parts[i]) || []]) })),
  };
}

/**
 * 박자 합 검사. 문제 설명 문자열 배열을 돌려준다.
 * allowPickup: 곡의 첫 마디가 못갖춘마디일 수 있으면 true
 */
export function validateSystem(input, { allowPickup = false } = {}) {
  const sys = normalizeSystem(input);
  const problems = [];
  let time = timeParts(sys.time);
  (sys.measures || []).forEach((m, mi) => {
    if (m.time) time = timeParts(m.time);
    const len = measureLength(time);
    (m.staves || []).forEach((staffData, si) => {
      voicesOf(staffData).forEach((voice, vi) => {
        if (!voice.length) return;
        const sum = voice.filter((e) => !e.g).reduce((a, e) => a + durationOf(e), 0);
        const pickup = allowPickup && mi === 0 && sum < len;
        if (sum !== len && !pickup && !(vi > 0 && sum < len)) {
          problems.push(`${mi + 1}번째 마디, ${si}번 오선 ${vi + 1}성부: 길이 합이 4분음표 ${sum / DIVISIONS}개인데 박자표(${time[0]}/${time[1]})는 ${len / DIVISIONS}개`);
        }
      });
    });
    if ((m.staves || []).length !== (sys.staves || []).length) {
      problems.push(`${mi + 1}번째 마디: 오선 수(${(m.staves || []).length})가 "staves" 목록(${sys.staves.length})과 다름`);
    }
  });
  return problems;
}

/** 여러 단(또는 예전 형식의 여러 페이지)을 하나의 악보로 합친다. */
export function mergeSystems(systemsIn) {
  const systems = systemsIn.filter(Boolean).map(normalizeSystem);
  if (!systems.length) throw new Error('인식된 악보가 없습니다.');
  // 오선이 가장 많은 단을 기준으로 전체 오선 순서를 정한다 (첫 단이 피아노만 있는 전주인 경우 등)
  const template = systems.reduce((a, b) => (b.staves.length > a.staves.length ? b : a));
  const global = [];
  const keyOf = (st, k) => `${(st.part || '').trim().toLowerCase()}#${k}`;
  const addStaves = (sys) => {
    const seen = {};
    for (const st of sys.staves) {
      const name = (st.part || '').trim().toLowerCase();
      const k = (seen[name] = (seen[name] || 0) + 1);
      if (!global.some((g) => g.key === keyOf(st, k))) {
        // 같은 파트의 마지막 오선 뒤에 넣는다
        const lastSame = global.map((g) => g.name).lastIndexOf(name);
        const entry = { key: keyOf(st, k), name, part: st.part || 'Part', clef: st.clef || 'G' };
        if (lastSame >= 0) global.splice(lastSame + 1, 0, entry);
        else global.push(entry);
      }
    }
  };
  addStaves(template);
  systems.forEach(addStaves);

  const first = systems[0];
  let curKey = first.key?.fifths ?? template.key?.fifths ?? 0;
  let curTime = first.time || template.time || '4/4';
  const measures = [];
  for (const sys of systems) {
    const seen = {};
    const map = sys.staves.map((st) => {
      const name = (st.part || '').trim().toLowerCase();
      const k = (seen[name] = (seen[name] || 0) + 1);
      return global.findIndex((g) => g.key === keyOf(st, k));
    });
    (sys.measures || []).forEach((m, mi) => {
      const out = { ...m, staves: global.map(() => [[]]), dirs: [] };
      (m.staves || []).forEach((sd, si) => { if (map[si] >= 0) out.staves[map[si]] = voicesOf(sd); });
      for (const d of m.dirs || []) out.dirs.push({ ...d, staff: map[d.staff ?? 0] ?? 0 });
      if (mi === 0 && measures.length) {
        if (sys.key && sys.key.fifths !== curKey && !m.key) out.key = sys.key;
        if (sys.time && sys.time !== curTime && !m.time) out.time = sys.time;
      }
      if (out.key) curKey = out.key.fifths;
      if (out.time) curTime = out.time;
      measures.push(out);
    });
  }
  return {
    title: systems.find((s) => s.title)?.title || '',
    staves: global.map((g) => ({ part: g.part, clef: g.clef })),
    key: first.key || template.key || { fifths: 0, mode: 'major' },
    time: first.time || template.time || '4/4',
    measures,
  };
}

/** 예전 이름 호환 */
export const mergePages = mergeSystems;

/** 다음 단에 넘겨줄 요약 정보 */
export function contextFrom(sys) {
  const s = normalizeSystem(sys);
  const last = [...(s.measures || [])].reverse();
  return JSON.stringify({
    staves: s.staves,
    key: last.find((m) => m.key)?.key || s.key,
    time: last.find((m) => m.time)?.time || s.time,
  });
}

// ---------------------------------------------------------------- MusicXML 만들기

function parsePitch(s) {
  const m = /^\s*([A-Ga-g])(##|bb|#|b|♯|♭|x)?\s*(-?\d)\s*$/.exec(String(s));
  if (!m) return null;
  const alter = { '##': 2, x: 2, '#': 1, '♯': 1, b: -1, '♭': -1, bb: -2 }[m[2]] ?? 0;
  return { step: m[1].toUpperCase(), alter, octave: parseInt(m[3], 10) };
}

function keyAlter(step, fifths) {
  const i = STEP_FIFTHS_ORDER.indexOf(step);
  if (fifths > 0 && i < fifths) return 1;
  if (fifths < 0 && i >= 7 + fifths) return -1;
  return 0;
}

const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));

const KIND_RULES = [
  [/^(maj7|M7|Δ7?|ma7)/, 'major-seventh'],
  [/^(m7b5|ø7?)/, 'half-diminished'],
  [/^(dim7|°7|o7)/, 'diminished-seventh'],
  [/^(dim|°|o)/, 'diminished'],
  [/^(aug|\+)/, 'augmented'],
  [/^(m6|min6)/, 'minor-sixth'],
  [/^(m9|min9)/, 'minor-ninth'],
  [/^(m7|min7|-7)/, 'minor-seventh'],
  [/^(m|min|-)(?!aj)/, 'minor'],
  [/^sus4?/, 'suspended-fourth'],
  [/^sus2/, 'suspended-second'],
  [/^9/, 'dominant-ninth'],
  [/^7/, 'dominant'],
  [/^6/, 'major-sixth'],
];

function harmonyXml(symbol) {
  let main = String(symbol).trim();
  let bass = null;
  const slash = main.lastIndexOf('/');
  if (slash > 0) {
    bass = parsePitch(main.slice(slash + 1) + '4');
    main = main.slice(0, slash);
  }
  const m = /^([A-G])(#|b|♯|♭)?(.*)$/.exec(main);
  if (!m) return '';
  const rootAlter = { '#': 1, '♯': 1, b: -1, '♭': -1 }[m[2]] ?? 0;
  const suffix = m[3];
  let kind = 'major';
  for (const [re, k] of KIND_RULES) if (re.test(suffix)) { kind = k; break; }
  return `<harmony><root><root-step>${m[1]}</root-step>${rootAlter ? `<root-alter>${rootAlter}</root-alter>` : ''}</root>`
    + `<kind text="${esc(suffix)}">${kind}</kind>`
    + (bass ? `<bass><bass-step>${bass.step}</bass-step>${bass.alter ? `<bass-alter>${bass.alter}</bass-alter>` : ''}</bass>` : '')
    + '</harmony>';
}

function directionXml(d, staffNo) {
  const staff = staffNo ? `<staff>${staffNo}</staff>` : '';
  if (d.dyn && DYNAMICS.has(String(d.dyn).toLowerCase())) {
    return `<direction placement="${d.place || 'below'}"><direction-type><dynamics><${String(d.dyn).toLowerCase()}/></dynamics></direction-type>${staff}</direction>`;
  }
  const text = d.text ?? d.dyn;
  if (!text) return '';
  if (/^\s*(8va|8vb|15ma|15mb|loco)\b/i.test(text)) return ''; // 음은 실제 높이로 적으므로 표시하지 않음
  const italic = /rit|rall|accel|tempo|cresc|dim|dolce|espr|poco|molto|sempre|^8va|^8vb/i.test(text) ? ' font-style="italic"' : '';
  const bold = !italic && /[가-힣]|andante|allegro|moderato|adagio|largo|lento|presto|vivace/i.test(text) ? ' font-weight="bold"' : '';
  return `<direction placement="${d.place || 'above'}"><direction-type><words${italic}${bold}>${esc(text)}</words></direction-type>${staff}</direction>`;
}

/** 정리된 악보 데이터 → MusicXML 문자열 */
export function buildMusicXml(input) {
  const score = input.staves ? input : mergeSystems([input]);
  const staves = score.staves.length ? score.staves : [{ part: 'Music', clef: 'G' }];

  // 같은 이름이 이어지는 오선들을 한 파트(큰보표)로 묶는다
  const parts = [];
  staves.forEach((st, gi) => {
    const last = parts[parts.length - 1];
    if (last && last.name.toLowerCase() === String(st.part).toLowerCase()) last.staves.push(gi);
    else parts.push({ name: String(st.part || `Part ${parts.length + 1}`), staves: [gi] });
  });

  // 같은 마디·같은 박에 여러 오선이 같은 글자 지시(rit., a tempo 등)를 가지면 맨 위 오선 것만 남긴다
  for (const m of score.measures || []) {
    if (!Array.isArray(m.dirs)) continue;
    const seen = new Set();
    m.dirs = [...m.dirs].sort((a, b) => (a.staff ?? 0) - (b.staff ?? 0)).filter((d) => {
      if (!d.text || (d.dyn && DYNAMICS.has(String(d.dyn).toLowerCase()))) return true;
      const k = `${String(d.text).trim().toLowerCase()}@${d.beat ?? 1}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const startFifths = Math.max(-7, Math.min(7, parseInt(score.key?.fifths, 10) || 0));
  const startMode = score.key?.mode === 'minor' ? 'minor' : 'major';
  const measures = score.measures || [];

  const partXml = parts.map((part, pi) => {
    let fifths = startFifths;
    let mode = startMode;
    let time = timeParts(score.time);
    const multi = part.staves.length > 1;
    const ties = new Map(); // "staff/voice" → 붙임줄이 이어질 음 집합
    const slurs = new Map(); // "staff/voice" → 열린 이음줄 수
    const out = [];

    measures.forEach((meas, mi) => {
      const attrs = [];
      if (mi === 0) attrs.push(`<divisions>${DIVISIONS}</divisions>`);
      if (meas.key && mi > 0) {
        fifths = parseInt(meas.key.fifths, 10) || 0;
        mode = meas.key.mode === 'minor' ? 'minor' : 'major';
      }
      if (mi === 0 || (meas.key && mi > 0)) attrs.push(`<key><fifths>${fifths}</fifths><mode>${mode}</mode></key>`);
      if (meas.time && mi > 0) time = timeParts(meas.time);
      if (mi === 0 || (meas.time && mi > 0)) attrs.push(`<time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time>`);
      if (mi === 0) {
        if (multi) attrs.push(`<staves>${part.staves.length}</staves>`);
        part.staves.forEach((gi, k) => {
          const [sign, line, oct] = CLEFS[staves[gi].clef] || CLEFS.G;
          attrs.push(`<clef${multi ? ` number="${k + 1}"` : ''}><sign>${sign}</sign><line>${line}</line>${oct ? `<clef-octave-change>${oct}</clef-octave-change>` : ''}</clef>`);
        });
      }

      const len = measureLength(time);
      const beatUnit = (4 * DIVISIONS) / time[1];
      const body = [];
      let cursor = 0; // 지금까지 적은 위치 (backup 계산용)

      part.staves.forEach((gi, k) => {
        const staffNo = multi ? k + 1 : 0;
        const staffTag = multi ? `<staff>${staffNo}</staff>` : '';
        const voices = voicesOf(meas.staves?.[gi]);
        const accState = {};
        const dirs = (meas.dirs || []).filter((d) => (d.staff ?? 0) === gi)
          .sort((a, b) => (a.beat ?? 1) - (b.beat ?? 1));
        const chords = pi === 0 && k === 0 ? [...(meas.chords || [])].sort((a, b) => (a.beat ?? 1) - (b.beat ?? 1)) : [];

        voices.forEach((voice, vi) => {
          const voiceNo = k * 4 + vi + 1;
          const vkey = `${k}/${vi}`;
          if (cursor > 0) body.push(`<backup><duration>${cursor}</duration></backup>`);
          cursor = 0;
          let pos = 0;
          let tupletAcc = 0;
          const flush = (p) => {
            if (vi !== 0) return;
            while (chords.length && Math.round(((chords[0].beat ?? 1) - 1) * beatUnit) <= p) body.push(harmonyXml(chords.shift().symbol));
            while (dirs.length && Math.round(((dirs[0].beat ?? 1) - 1) * beatUnit) <= p) body.push(directionXml(dirs.shift(), staffNo));
          };
          const pending = ties.get(vkey) || new Set();
          const nextTies = new Set();

          for (const ev of voice) {
            flush(pos);
            const grace = !!ev.g;
            const dur = grace ? 0 : durationOf(ev);
            const type = TYPE_NAME[ev.d] || (grace ? 'eighth' : 'quarter');
            const dots = ev.dot === 2 ? '<dot/><dot/>' : ev.dot ? '<dot/>' : '';
            let tm = '';
            let tuplet = '';
            if (ev.t && !grace) {
              tm = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
              if (tupletAcc === 0) tuplet = '<tuplet type="start" bracket="yes"/>';
              tupletAcc += dur;
              const unit = Math.round(BASE[ev.d] ?? BASE.q) * 2;
              if (tupletAcc >= unit) { tuplet += '<tuplet type="stop"/>'; tupletAcc = 0; }
            } else if (!grace) tupletAcc = 0;

            // 이음줄
            let slur = '';
            const open = slurs.get(vkey) || 0;
            if (ev.slur === 'stop' || ev.slur === 'stop-start') {
              if (open > 0) { slur += `<slur type="stop" number="${open}"/>`; slurs.set(vkey, open - 1); }
            }
            if (ev.slur === 'start' || ev.slur === 'stop-start') {
              const n = (slurs.get(vkey) || 0) + 1;
              slurs.set(vkey, n);
              slur += `<slur type="start" number="${n}"/>`;
            }
            const arts = (Array.isArray(ev.art) ? ev.art : ev.art ? [ev.art] : []).map((a) => ARTICULATIONS[a]).filter(Boolean);
            const artXml = arts.length ? `<articulations>${arts.map((a) => `<${a}/>`).join('')}</articulations>` : '';
            const fer = ev.fer ? '<fermata type="upright"/>' : '';
            const graceTag = grace ? (ev.g === 2 ? '<grace/>' : '<grace slash="yes"/>') : '';

            if (ev.r || ev.p == null) {
              if (grace) continue;
              const whole = voice.length === 1 && dur === len;
              const hide = vi > 0 && !ev.show ? ' print-object="no"' : '';
              const nots = (tuplet || fer) ? `<notations>${tuplet}${fer}</notations>` : '';
              body.push(`<note${hide}><rest${whole ? ' measure="yes"' : ''}/><duration>${dur}</duration><voice>${voiceNo}</voice>${whole ? '' : `<type>${type}</type>${dots}`}${tm}${staffTag}${nots}</note>`);
            } else {
              const pitches = (Array.isArray(ev.p) ? ev.p : [ev.p]).map(parsePitch).filter(Boolean);
              pitches.forEach((pt, i) => {
                const id = pt.step + pt.octave;
                const tieId = id + ':' + pt.alter;
                const stop = pending.has(tieId);
                const expected = id in accState ? accState[id] : keyAlter(pt.step, fifths);
                const acc = expected !== pt.alter && !stop ? `<accidental>${ACC[pt.alter]}</accidental>` : '';
                accState[id] = pt.alter;
                if (ev.tie && !grace) nextTies.add(tieId);
                const tie = (stop ? '<tie type="stop"/>' : '') + (ev.tie && !grace ? '<tie type="start"/>' : '');
                const tied = (stop ? '<tied type="stop"/>' : '') + (ev.tie && !grace ? '<tied type="start"/>' : '');
                const first = i === 0;
                const inner = tied + (first ? slur + tuplet : '') + (first ? fer + artXml : '') + (ev.arp ? '<arpeggiate/>' : '');
                const nots = inner ? `<notations>${inner}</notations>` : '';
                let lyrics = '';
                if (first && Array.isArray(ev.ly)) {
                  ev.ly.forEach((t, li) => {
                    const txt = String(t ?? '').trim();
                    if (txt && !/^[-_–—~]+$/.test(txt)) lyrics += `<lyric number="${li + 1}"><syllabic>single</syllabic><text>${esc(txt)}</text></lyric>`;
                  });
                }
                body.push(`<note>${graceTag}${i ? '<chord/>' : ''}<pitch><step>${pt.step}</step>${pt.alter ? `<alter>${pt.alter}</alter>` : ''}<octave>${pt.octave}</octave></pitch>`
                  + `${grace ? '' : `<duration>${dur}</duration>`}${tie}<voice>${voiceNo}</voice><type>${type}</type>${dots}${acc}${tm}${staffTag}${nots}${lyrics}</note>`);
              });
            }
            if (!grace) {
              ties.set(vkey, nextTies);
              pending.clear();
              nextTies.forEach((t) => pending.add(t));
              nextTies.clear();
            }
            pos += dur;
          }
          flush(Infinity);
          if (voice.length === 0 && vi === 0) {
            body.push(`<note><rest measure="yes"/><duration>${len}</duration><voice>${voiceNo}</voice>${staffTag}</note>`);
            pos = len;
          } else if (pos < len && (mi > 0 || vi > 0)) {
            const hide = vi > 0 ? ' print-object="no"' : '';
            body.push(`<note${hide}><rest/><duration>${len - pos}</duration><voice>${voiceNo}</voice>${staffTag}</note>`);
            pos = len;
          }
          ties.set(vkey, new Set(pending));
          cursor = pos;
        });
      });

      out.push(`<measure number="${mi + 1}">${attrs.length ? `<attributes>${attrs.join('')}</attributes>` : ''}${body.join('')}</measure>`);
    });
    return `<part id="P${pi + 1}">${out.join('\n')}</part>`;
  });

  // 피아노처럼 오선이 여러 개인 파트는 MusicXML의 staves로 이미 묶이고, 중괄호는 렌더러가 그린다.
  const partList = parts.map((p, i) => `<score-part id="P${i + 1}"><part-name>${esc(p.name)}</part-name></score-part>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
${score.title ? `<work><work-title>${esc(score.title)}</work-title></work>` : ''}
<part-list>${partList}</part-list>
${partXml.join('\n')}
</score-partwise>`;
}
