// 악보 이미지 인식(OMR) 보조 모듈
//   - Claude에게 보낼 프롬프트를 만들고
//   - Claude가 돌려준 간단한 JSON 악보를 MusicXML로 바꾼다.
// DOM 의존성이 없어서 Node 테스트에서도 그대로 쓸 수 있다.

const DIVISIONS = 24; // 4분음표 = 24 (셋잇단 16분음표까지 정수로 표현)
const BASE = { w: 96, h: 48, q: 24, 8: 12, 16: 6, 32: 3 };
const TYPE_NAME = { w: 'whole', h: 'half', q: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };
const STEP_FIFTHS_ORDER = 'FCGDAEB'; // 조표에 ♯이 붙는 순서
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const CLEFS = { G: ['G', 2], F: ['F', 4], C: ['C', 3], T: ['C', 4], P: ['percussion', 2] };

export const JSON_FORMAT = `{
  "title": "곡 제목(없으면 빈 문자열)",
  "parts": [{"name": "Piano RH", "clef": "G"}, {"name": "Piano LH", "clef": "F"}],
  "key": {"fifths": -2, "mode": "major"},
  "time": "4/4",
  "measures": [
    {
      "chords": [{"beat": 1, "symbol": "Cm7"}, {"beat": 3, "symbol": "F7"}],
      "parts": [
        [{"p": "D5", "d": "q"}, {"p": ["F4", "Bb4"], "d": "h", "dot": 1}, {"r": 1, "d": "8"}],
        [{"p": "Bb2", "d": "w"}]
      ]
    }
  ]
}`;

export function buildPrompt({ page, pages, context }) {
  return `너는 악보 판독(OMR) 전문가다. 첨부한 이미지는 악보 PDF의 ${page}/${pages} 페이지다.
이 페이지의 모든 마디를 빠짐없이 읽어서 아래 JSON 형식 하나만 출력하라. 설명이나 코드펜스 없이 JSON만 출력한다.

형식:
${JSON_FORMAT}

규칙:
- "parts"는 위에서 아래로 보이는 오선 순서. 피아노 큰보표는 오른손/왼손 두 파트로 나눈다. clef는 G(높은음자리표), F(낮은음자리표), C(알토), T(테너) 중 하나.
- "measures[i].parts[j]"는 j번째 파트의 그 마디 음표 목록. 파트 수와 순서는 모든 마디에서 같아야 한다.
- 음표 "p"는 실제 음 이름+옥타브(가운데 도 = C4). 조표에 의해 올라가거나 내려간 음도 반영해서 적는다 (예: F장조의 시 → "Bb4"). 임시표도 반영한다. ♯은 #, ♭은 b.
- 화음(동시에 울리는 여러 음)은 "p"를 배열로 쓴다. 한 오선에 성부가 둘이면 리듬이 같을 때는 화음으로 합치고, 다르면 윗성부만 적는다.
- 쉼표는 {"r": 1, "d": ...}.
- "d" 길이: "w" 온음표, "h" 2분, "q" 4분, "8" 8분, "16" 16분, "32" 32분. 점은 "dot": 1(겹점 2), 셋잇단은 "t": 1, 다음 음과 붙임줄은 "tie": 1.
- 코드 심볼(마디 위 Am7 같은 글자)이 있으면 "chords"에 박(1부터 시작, 소수 가능)과 함께 적는다. 없으면 생략.
- 마디 중간에 조표나 박자표가 바뀌면 그 마디에 "key": {"fifths": n, "mode": "..."} 또는 "time": "3/4"를 넣는다.
- 가사, 셈여림, 아티큘레이션은 생략한다.
- 확신이 없는 부분도 최선의 추측으로 채운다. 마디를 빼먹지 않는 것이 가장 중요하다.
${context ? `\n앞 페이지에서 확인된 정보(반드시 같은 파트 구성 유지): ${context}\n이 페이지의 "key"/"time"은 페이지 시작 시점의 값을 적는다.` : ''}`;
}

/** 모델 응답 텍스트에서 JSON 객체를 꺼낸다. */
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('인식 결과에서 악보 데이터를 찾지 못했습니다.');
  return JSON.parse(text.slice(start, end + 1));
}

/** 여러 페이지의 결과를 하나로 합친다. */
export function mergePages(pages) {
  const first = pages[0];
  const merged = { ...first, measures: [] };
  for (const pg of pages) {
    const firstMeasure = pg.measures?.[0];
    if (pg !== first && firstMeasure) {
      // 페이지 경계에서 조표/박자가 바뀌었으면 그 마디에 기록
      const prevKey = merged._lastKey ?? first.key?.fifths;
      if (pg.key && pg.key.fifths !== prevKey && firstMeasure.key == null) firstMeasure.key = pg.key;
    }
    for (const m of pg.measures || []) {
      merged.measures.push(m);
      if (m.key) merged._lastKey = m.key.fifths;
    }
  }
  delete merged._lastKey;
  return merged;
}

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

function durationOf(ev) {
  let d = BASE[ev.d] ?? BASE.q;
  if (ev.dot === 1 || ev.dot === true) d *= 1.5;
  else if (ev.dot === 2) d *= 1.75;
  if (ev.t) d = (d * 2) / 3;
  return Math.round(d);
}

const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));

const KIND_RULES = [
  [/^(maj7|M7|Δ7?|ma7)/, 'major-seventh', 'maj7'],
  [/^(m7b5|ø7?)/, 'half-diminished', 'm7b5'],
  [/^(dim7|°7|o7)/, 'diminished-seventh', 'dim7'],
  [/^(dim|°|o)/, 'diminished', 'dim'],
  [/^(aug|\+)/, 'augmented', 'aug'],
  [/^(m6|min6)/, 'minor-sixth', 'm6'],
  [/^(m9|min9)/, 'minor-ninth', 'm9'],
  [/^(m7|min7|-7)/, 'minor-seventh', 'm7'],
  [/^(m|min|-)(?!aj)/, 'minor', 'm'],
  [/^sus4?/, 'suspended-fourth', 'sus4'],
  [/^sus2/, 'suspended-second', 'sus2'],
  [/^9/, 'dominant-ninth', '9'],
  [/^7/, 'dominant', '7'],
  [/^6/, 'major-sixth', '6'],
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
  let text = suffix;
  for (const [re, k] of KIND_RULES) {
    if (re.test(suffix)) { kind = k; break; }
  }
  return `<harmony><root><root-step>${m[1]}</root-step>${rootAlter ? `<root-alter>${rootAlter}</root-alter>` : ''}</root>`
    + `<kind text="${esc(text)}">${kind}</kind>`
    + (bass ? `<bass><bass-step>${bass.step}</bass-step>${bass.alter ? `<bass-alter>${bass.alter}</bass-alter>` : ''}</bass>` : '')
    + '</harmony>';
}

function timeParts(t) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(t || '4/4'));
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [4, 4];
}

/** Claude가 돌려준 JSON 악보 → MusicXML 문자열 */
export function buildMusicXml(score) {
  const parts = (score.parts && score.parts.length ? score.parts : [{ name: 'Music', clef: 'G' }]);
  let fifths = Math.max(-7, Math.min(7, parseInt(score.key?.fifths, 10) || 0));
  const mode = score.key?.mode === 'minor' ? 'minor' : 'major';
  let [beats, beatType] = timeParts(score.time);
  const measures = score.measures || [];

  const partXml = parts.map((part, pi) => {
    let partFifths = fifths;
    let partMode = mode;
    let [b, bt] = [beats, beatType];
    let tiePending = new Set(); // 앞 음에서 붙임줄이 이어지는 음들
    const out = [];
    measures.forEach((meas, mi) => {
      const attrs = [];
      if (mi === 0) attrs.push(`<divisions>${DIVISIONS}</divisions>`);
      if (meas.key && mi > 0) {
        partFifths = parseInt(meas.key.fifths, 10) || 0;
        partMode = meas.key.mode === 'minor' ? 'minor' : 'major';
      }
      if (mi === 0 || meas.key) attrs.push(`<key><fifths>${partFifths}</fifths><mode>${partMode}</mode></key>`);
      if (meas.time && mi > 0) [b, bt] = timeParts(meas.time);
      if (mi === 0 || meas.time) attrs.push(`<time><beats>${b}</beats><beat-type>${bt}</beat-type></time>`);
      if (mi === 0) {
        const [sign, line] = CLEFS[part.clef] || CLEFS.G;
        attrs.push(`<clef><sign>${sign}</sign><line>${line}</line></clef>`);
      }

      const measureLen = Math.round((b * 4 * DIVISIONS) / bt);
      const events = (meas.parts && meas.parts[pi]) || [];
      const chords = pi === 0 ? [...(meas.chords || [])].sort((x, y) => (x.beat ?? 1) - (y.beat ?? 1)) : [];
      const beatUnit = (4 * DIVISIONS) / bt;
      const accState = {}; // 마디 안 임시표 상태: "C4" → alter
      const body = [];
      let pos = 0;
      let tupletOpen = 0;

      const flushChordsUntil = (p) => {
        while (chords.length && Math.round(((chords[0].beat ?? 1) - 1) * beatUnit) <= p) {
          body.push(harmonyXml(chords.shift().symbol));
        }
      };

      for (const ev of events) {
        flushChordsUntil(pos);
        const dur = durationOf(ev);
        const type = TYPE_NAME[ev.d] || 'quarter';
        const dots = ev.dot === 2 ? '<dot/><dot/>' : ev.dot ? '<dot/>' : '';
        let tm = '';
        let tupletNote = '';
        if (ev.t) {
          tm = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
          if (tupletOpen === 0) tupletNote = '<tuplet type="start" bracket="yes"/>';
          tupletOpen += dur;
          const groupLen = Math.round(BASE[ev.d] * 2 * (ev.dot ? 1.5 : 1));
          if (tupletOpen >= groupLen) { tupletNote += '<tuplet type="stop"/>'; tupletOpen = 0; }
        } else {
          tupletOpen = 0;
        }
        const nextTies = new Set();
        const tieXml = (id) => {
          const stop = tiePending.has(id);
          if (ev.tie) nextTies.add(id);
          return {
            tie: (stop ? '<tie type="stop"/>' : '') + (ev.tie ? '<tie type="start"/>' : ''),
            tied: (stop ? '<tied type="stop"/>' : '') + (ev.tie ? '<tied type="start"/>' : ''),
          };
        };

        if (ev.r || ev.p == null) {
          const whole = ev.d === 'w' && dur === measureLen;
          const notations = tupletNote ? `<notations>${tupletNote}</notations>` : '';
          body.push(`<note><rest${whole ? ' measure="yes"' : ''}/><duration>${dur}</duration><voice>1</voice><type>${type}</type>${dots}${tm}${notations}</note>`);
        } else {
          const pitches = (Array.isArray(ev.p) ? ev.p : [ev.p]).map(parsePitch).filter(Boolean);
          pitches.forEach((pt, i) => {
            const id = pt.step + pt.octave;
            const expected = id in accState ? accState[id] : keyAlter(pt.step, partFifths);
            const acc = expected !== pt.alter ? `<accidental>${ACC[pt.alter]}</accidental>` : '';
            accState[id] = pt.alter;
            const t = tieXml(id + ':' + pt.alter);
            const notations = (t.tied || (i === 0 && tupletNote)) ? `<notations>${t.tied}${i === 0 ? tupletNote : ''}</notations>` : '';
            body.push(`<note>${i ? '<chord/>' : ''}<pitch><step>${pt.step}</step>${pt.alter ? `<alter>${pt.alter}</alter>` : ''}<octave>${pt.octave}</octave></pitch>`
              + `<duration>${dur}</duration>${t.tie}<voice>1</voice><type>${type}</type>${dots}${acc}${tm}${notations}</note>`);
          });
        }
        tiePending = nextTies;
        pos += dur;
      }
      flushChordsUntil(Infinity);
      if (pos < measureLen && mi > 0) {
        // 모자란 박은 쉼표로 채운다 (첫 마디는 못갖춘마디일 수 있어 그대로 둔다)
        body.push(`<note><rest/><duration>${measureLen - pos}</duration><voice>1</voice></note>`);
      }
      if (events.length === 0 && pos === 0) {
        body.push(`<note><rest measure="yes"/><duration>${measureLen}</duration><voice>1</voice></note>`);
      }
      out.push(`<measure number="${mi + 1}">${attrs.length ? `<attributes>${attrs.join('')}</attributes>` : ''}${body.join('')}</measure>`);
    });
    return `<part id="P${pi + 1}">${out.join('\n')}</part>`;
  });

  const partList = parts.map((p, i) => `<score-part id="P${i + 1}"><part-name>${esc(p.name || `Part ${i + 1}`)}</part-name></score-part>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
${score.title ? `<work><work-title>${esc(score.title)}</work-title></work>` : ''}
<part-list>${partList}</part-list>
${partXml.join('\n')}
</score-partwise>`;
}

/** 페이지 사이에 넘겨줄 요약 정보 */
export function contextFrom(score) {
  const last = [...(score.measures || [])].reverse();
  const key = last.find((m) => m.key)?.key || score.key;
  const time = last.find((m) => m.time)?.time || score.time;
  return JSON.stringify({ parts: score.parts, key, time });
}
