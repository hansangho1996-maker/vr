// 코드(화음) 악보 텍스트 이조
//   - 가사 위에 코드가 따로 적힌 "코드 줄" 형식
//   - [C]가사 처럼 대괄호 안에 코드가 들어간 ChordPro 형식
// 두 가지를 모두 지원하며, 코드 줄의 칸 맞춤(가사와의 위치)을 최대한 유지한다.

import {
  makeTransposer, transposePitch, parseNoteName, noteName, keyName, mod,
} from './theory.js';

const ROOT_RE = /^([A-G](?:#|b|♯|♭)?)(.*)$/;
const SUFFIX_RE = /^(?:maj|Maj|min|dim|aug|sus|add|alt|omit|no|M|m|\+|-|°|o|ø|Δ|\d+|#|b|♯|♭|\(|\)|,)*$/;
const FILLER_RE = /^(?:\|+|\|:|:\||\/|-|%|\.+|N\.?C\.?|\(?x\d+\)?|\d+x|:)$/i;

/** "F#m7/C#" → { root:{step,alter}, suffix:'m7', bass:{step,alter}|null } */
export function parseChord(token) {
  let main = token;
  let bass = null;
  const slash = token.lastIndexOf('/');
  if (slash > 0) {
    bass = parseNoteName(token.slice(slash + 1));
    if (!bass) return null;
    main = token.slice(0, slash);
  }
  const m = ROOT_RE.exec(main);
  if (!m) return null;
  const root = parseNoteName(m[1]);
  if (!root || !SUFFIX_RE.test(m[2])) return null;
  return { root, suffix: m[2], bass };
}

export function isMinorSuffix(suffix) {
  return /^(m|min|-)(?!aj)/.test(suffix);
}

function simplify(p) {
  // 코드 이름에서는 겹올림/겹내림 대신 단순한 이명동음을 쓴다.
  if (Math.abs(p.alter) < 2) return p;
  const pcs = [0, 2, 4, 5, 7, 9, 11];
  const pc = mod(pcs[p.step] + p.alter, 12);
  for (const dir of [Math.sign(p.alter)]) {
    for (let d = 1; d <= 2; d++) {
      const step = mod(p.step + dir * d, 7);
      const alter = pc - pcs[step];
      const a = ((alter + 18) % 12) - 6;
      if (Math.abs(a) <= 1) return { step, alter: a };
    }
  }
  return p;
}

export function formatChord(ch, style) {
  let s = noteName(ch.root.step, ch.root.alter, style) + ch.suffix;
  if (ch.bass) s += '/' + noteName(ch.bass.step, ch.bass.alter, style);
  return s;
}

function transposeChord(ch, tr) {
  const t = (p) => {
    const r = transposePitch({ ...p, octave: 4 }, tr);
    return simplify({ step: r.step, alter: r.alter });
  };
  return { root: t(ch.root), suffix: ch.suffix, bass: ch.bass ? t(ch.bass) : null };
}

function tokenize(line) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) out.push({ text: m[0], col: m.index });
  return out;
}

export function isChordLine(line) {
  const tokens = tokenize(line);
  let chords = 0;
  for (const { text } of tokens) {
    if (parseChord(text)) chords++;
    else if (!FILLER_RE.test(text)) return false;
  }
  return chords > 0;
}

/** 텍스트에서 첫 코드를 찾아 조를 추정한다 (장조 fifths 반환). */
export function detectKey(text) {
  for (const line of text.split('\n')) {
    const bracket = /\[([^\]\s]+)\]/.exec(line);
    let ch = bracket ? parseChord(bracket[1]) : null;
    if (!ch && isChordLine(line)) {
      ch = tokenize(line).map((t) => parseChord(t.text)).find(Boolean);
    }
    if (ch) {
      const minor = isMinorSuffix(ch.suffix);
      const { step, alter } = ch.root;
      const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5];
      const fifths = LETTER_FIFTHS[step] + 7 * alter - (minor ? 3 : 0);
      return { fifths, minor };
    }
  }
  return null;
}

/**
 * 코드 악보 텍스트를 이조한다.
 * options: { fromKey?: {fifths, minor}, prefer?: 'auto'|'sharp'|'flat', style?: 'ascii'|'unicode' }
 */
export function transposeChordText(text, semitones, options = {}) {
  const { prefer = 'auto', style = 'ascii' } = options;
  const key = options.fromKey || detectKey(text) || { fifths: 0, minor: false };
  const tr = makeTransposer(key.fifths, semitones, prefer);
  const conv = (token) => {
    const ch = parseChord(token);
    return ch ? formatChord(transposeChord(ch, tr), style) : token;
  };

  const lines = text.split('\n').map((line) => {
    if (isChordLine(line)) {
      let out = '';
      for (const { text: tok, col } of tokenize(line)) {
        const target = out.length === 0 ? col : Math.max(col, out.length + 1);
        out = out.padEnd(target, ' ') + conv(tok);
      }
      return out;
    }
    return line.replace(/\[([^\]\s]+)\]/g, (whole, inner) => (parseChord(inner) ? `[${conv(inner)}]` : whole));
  });

  return {
    text: lines.join('\n'),
    fromKey: keyName(key.fifths, key.minor, style),
    toKey: keyName(tr.newFifths, key.minor, style),
  };
}
