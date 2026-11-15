import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTransposer, transposePitch, noteName, keyName, parseKey, targetFifths } from '../src/theory.js';

const tp = (fifths, semis, name, octave = 4, prefer) => {
  const tr = makeTransposer(fifths, semis, prefer);
  const m = /^([A-G])(#|b|##|bb)?$/.exec(name);
  const step = 'CDEFGAB'.indexOf(m[1]);
  const alter = { undefined: 0, '#': 1, b: -1, '##': 2, bb: -2 }[m[2]];
  const r = transposePitch({ step, alter, octave }, tr);
  return noteName(r.step, r.alter) + r.octave;
};

test('새 조표 선택', () => {
  assert.equal(targetFifths(0, 2), 2);   // C → D
  assert.equal(targetFifths(0, 1), -5);  // C → Db
  assert.equal(targetFifths(0, 3), -3);  // C → Eb
  assert.equal(targetFifths(0, 6), 6);   // C → F# (동률이면 ♯)
  assert.equal(targetFifths(0, 6, 'flat'), -6);
  assert.equal(targetFifths(0, 1, 'sharp'), 7); // C#
  assert.equal(targetFifths(0, -2), -2); // C → Bb
});

test('음 이조와 이명동음 표기', () => {
  assert.equal(tp(0, 2, 'C'), 'D4');
  assert.equal(tp(0, 2, 'B'), 'C#5');
  assert.equal(tp(0, 1, 'E'), 'F4');    // C→Db: E → F
  assert.equal(tp(0, 1, 'F#'), 'G4');   // 임시표 #4 → Db 조에서 G♮
  assert.equal(tp(0, -2, 'F#'), 'E4');  // C→Bb: F# → E♮
  assert.equal(tp(0, 12, 'G'), 'G5');
  assert.equal(tp(0, -12, 'G'), 'G3');
  assert.equal(tp(0, 9, 'C'), 'A4');    // 알토색소폰
  assert.equal(tp(0, 14, 'C'), 'D5');   // 테너색소폰
  assert.equal(tp(-3, 4, 'Eb'), 'G4');  // Eb → G
  assert.equal(tp(2, 3, 'C#'), 'E4');   // D → F
  assert.equal(tp(0, 4, 'G#'), 'B#4');  // C→E 에서 #5 는 B#
});

test('키 이름', () => {
  assert.deepEqual(parseKey('Bb'), { fifths: -2, minor: false });
  assert.deepEqual(parseKey('F#m'), { fifths: 3, minor: true });
  assert.equal(keyName(-3), 'Eb');
  assert.equal(keyName(0, true), 'Am');
  assert.equal(keyName(4, true), 'C#m');
});
