// 음 이름·조표·이조 계산의 핵심 로직 (DOM 의존성 없음)
//
// 이조 원리
//   1) 원래 조표(fifths)와 반음 수로 새 조표를 정한다. (예: C장조 +2 → D장조, fifths 0 → 2)
//   2) 두 조의 으뜸음 글자 차이(예: C→D = 1글자)만큼 모든 음의 글자를 옮기고,
//      실제 음높이(반음)를 맞추도록 변화표(alter)를 다시 계산한다.
//   이렇게 하면 조성 안의 음은 조성 안에, 임시표가 붙은 음은 같은 성격의 임시표로 옮겨져
//   C# / Db 같은 이명동음이 음악적으로 올바르게 표기된다.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5]; // 각 글자를 으뜸음으로 하는 장조의 조표

export const mod = (n, m) => ((n % m) + m) % m;

/**
 * 반음 이동 후의 새 조표(장조 기준 fifths, -7..7)를 고른다.
 * prefer: 'auto'  = 조표 수가 적은 쪽 (동률이면 ♯)
 *         'sharp' = 가능한 한 ♯ 조 (예: Db → C#)
 *         'flat'  = 가능한 한 ♭ 조 (예: F# → Gb, B → Cb)
 */
export function targetFifths(fifths, semitones, prefer = 'auto') {
  const base = mod(fifths + 7 * semitones, 12);
  const candidates = [base - 12, base, base + 12].filter((k) => k >= -7 && k <= 7);
  if (prefer === 'sharp') return Math.max(...candidates);
  if (prefer === 'flat') return Math.min(...candidates);
  return candidates.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)[0];
}

/** 조표(fifths) → 장조 으뜸음 { step: 0..6, alter } */
export function tonicOfFifths(fifths) {
  const step = mod(4 * fifths, 7);
  const alter = Math.round((fifths - LETTER_FIFTHS[step]) / 7);
  return { step, alter };
}

/** 장조 으뜸음 → 조표 fifths */
export function fifthsOfTonic(step, alter) {
  return LETTER_FIFTHS[step] + 7 * alter;
}

/**
 * 하나의 이조 규칙을 만든다.
 * 반환 객체의 diatonic = 글자(음계 단계) 이동량, semitones = 반음 이동량, newFifths = 새 조표.
 */
export function makeTransposer(fifths, semitones, prefer = 'auto') {
  const newFifths = targetFifths(fifths, semitones, prefer);
  const letterDelta = mod(4 * (newFifths - fifths), 7);
  // 반음 이동량과 가장 잘 맞는 실제 글자 이동량(옥타브 포함)을 고른다.
  const ideal = (semitones * 7) / 12;
  const k = Math.round((ideal - letterDelta) / 7);
  const diatonic = letterDelta + 7 * k;
  return { fifths, newFifths, semitones, diatonic };
}

/** 음 하나({step 0..6, alter, octave})를 이조한다. octave가 없으면(코드 이름 등) 옥타브 무시. */
export function transposePitch(pitch, tr) {
  const { step, alter = 0, octave = 4 } = pitch;
  const absStep = octave * 7 + step + tr.diatonic;
  const newStep = mod(absStep, 7);
  const newOctave = Math.floor(absStep / 7);
  const oldMidi = octave * 12 + NATURAL_PC[step] + alter;
  const targetMidi = oldMidi + tr.semitones;
  const naturalMidi = newOctave * 12 + NATURAL_PC[newStep];
  return { step: newStep, alter: targetMidi - naturalMidi, octave: newOctave };
}

// ---------- 음 이름 문자열 처리 ----------

export function accidentalText(alter, style = 'ascii') {
  if (style === 'unicode') {
    return { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' }[alter] ?? '';
  }
  return { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' }[alter] ?? '';
}

export function noteName(step, alter, style = 'ascii') {
  return LETTERS[step] + accidentalText(alter, style);
}

/** "C#", "Bb", "E♭" 등 → { step, alter } (실패 시 null) */
export function parseNoteName(s) {
  const m = /^([A-Ga-g])(##|bb|#|b|♯|♭|𝄪|𝄫)?$/.exec(s.trim());
  if (!m) return null;
  const step = LETTERS.indexOf(m[1].toUpperCase());
  const acc = m[2] || '';
  const alter = { '': 0, '#': 1, '♯': 1, '##': 2, '𝄪': 2, b: -1, '♭': -1, bb: -2, '𝄫': -2 }[acc];
  return { step, alter };
}

/** 키 이름("Bb", "F#m", "C#minor")을 장조 fifths로 변환 */
export function parseKey(s) {
  const m = /^\s*([A-Ga-g](?:##|bb|#|b|♯|♭)?)\s*(m|min|minor|마이너|단조)?\s*$/i.exec(s);
  if (!m) return null;
  const n = parseNoteName(m[1]);
  if (!n) return null;
  const minor = !!m[2];
  return { fifths: fifthsOfTonic(n.step, n.alter) - (minor ? 3 : 0), minor };
}

/** 장조 fifths + 단조 여부 → 키 이름 */
export function keyName(fifths, minor = false, style = 'ascii') {
  const t = tonicOfFifths(minor ? fifths + 3 : fifths);
  return noteName(t.step, t.alter, style) + (minor ? 'm' : '');
}

/** 두 음 사이의 반음 거리(위쪽, 0..11) */
export function semitoneDistance(from, to) {
  return mod(NATURAL_PC[to.step] + to.alter - (NATURAL_PC[from.step] + from.alter), 12);
}

/** 이조악기 프리셋: 실음(콘서트) 악보 → 해당 악기 기보음으로 바꿀 때의 반음 수 */
export const INSTRUMENT_PRESETS = [
  { id: 'none', label: '직접 입력', semitones: null },
  { id: 'bb', label: 'B♭ 트럼펫·클라리넷 — 실음 → 기보음 (+2)', semitones: 2 },
  { id: 'tsax', label: 'B♭ 테너색소폰 — 실음 → 기보음 (+14)', semitones: 14 },
  { id: 'eb', label: 'E♭ 알토색소폰 — 실음 → 기보음 (+9)', semitones: 9 },
  { id: 'bsax', label: 'E♭ 바리톤색소폰 — 실음 → 기보음 (+21)', semitones: 21 },
  { id: 'f', label: 'F 호른 — 실음 → 기보음 (+7)', semitones: 7 },
  { id: 'bb-r', label: 'B♭ 트럼펫·클라리넷 기보음 → 실음 (−2)', semitones: -2 },
  { id: 'eb-r', label: 'E♭ 알토색소폰 기보음 → 실음 (−9)', semitones: -9 },
  { id: 'f-r', label: 'F 호른 기보음 → 실음 (−7)', semitones: -7 },
];
