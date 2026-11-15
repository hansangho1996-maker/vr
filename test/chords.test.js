import test from 'node:test';
import assert from 'node:assert/strict';
import { transposeChordText, parseChord, isChordLine } from '../src/chords.js';

test('코드 파싱', () => {
  assert.ok(parseChord('F#m7b5/C#'));
  assert.ok(parseChord('Cmaj7'));
  assert.ok(parseChord('Bbsus4'));
  assert.equal(parseChord('Hello'), null);
  assert.ok(isChordLine('C   G/B  | Am  F'));
  assert.ok(!isChordLine('A man walks'));
  assert.ok(!isChordLine('사랑해요'));
});

test('코드 줄 이조 + 칸 맞춤 유지', () => {
  const src = 'C       G/B      Am\n사랑한다 말해도  괜찮아';
  const r = transposeChordText(src, 2);
  assert.equal(r.text, 'D       A/C#     Bm\n사랑한다 말해도  괜찮아');
  assert.equal(r.fromKey, 'C');
  assert.equal(r.toKey, 'D');
});

test('조에 맞는 ♭/♯ 표기', () => {
  assert.equal(transposeChordText('C F G7 C', 1).text, 'Db Gb Ab7 Db');
  assert.equal(transposeChordText('C F G7 C', 1, { prefer: 'sharp' }).text, 'C# F# G#7 C#');
  assert.equal(transposeChordText('Am Dm E7 Am', 3).text, 'Cm Fm G7 Cm');
  assert.equal(transposeChordText('Em C D G', -2).text, 'Dm Bb C F');
});

test('ChordPro 대괄호 형식', () => {
  const r = transposeChordText('[G]오늘도 [Em]너를 [C]생각[D7]해', 5);
  assert.equal(r.text, '[C]오늘도 [Am]너를 [F]생각[G7]해');
});

test('긴 코드로 바뀔 때 겹치지 않음', () => {
  const r = transposeChordText('E A', 1);
  assert.equal(r.text, 'F Bb');
  const r2 = transposeChordText('C D', 1, { prefer: 'sharp' });
  assert.equal(r2.text, 'C# D#');
});
