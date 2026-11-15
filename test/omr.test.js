import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { buildMusicXml, extractJson, mergePages, buildPrompt } from '../src/omr.js';
import { transposeMusicXml } from '../src/musicxml.js';

const score = {
  title: '테스트 & 곡',
  parts: [{ name: 'RH', clef: 'G' }, { name: 'LH', clef: 'F' }],
  key: { fifths: -1, mode: 'major' },
  time: '3/4',
  measures: [
    {
      chords: [{ beat: 1, symbol: 'F' }, { beat: 3, symbol: 'C7/E' }],
      parts: [
        [{ p: 'A4', d: 'q' }, { p: 'Bb4', d: 'q' }, { p: 'B4', d: 'q' }],
        [{ p: ['F2', 'C3'], d: 'h', dot: 1 }],
      ],
    },
    {
      parts: [
        [{ p: 'C5', d: '8', t: 1 }, { p: 'D5', d: '8', t: 1 }, { p: 'C5', d: '8', t: 1 }, { p: 'A4', d: 'q', tie: 1 }],
        [{ r: 1, d: 'h', dot: 1 }],
      ],
    },
    { parts: [[{ p: 'A4', d: 'q' }], []] },
  ],
};

const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');

test('JSON → MusicXML 변환', () => {
  const xml = buildMusicXml(score);
  const doc = parse(xml);
  assert.equal(doc.getElementsByTagName('part').length, 2);
  assert.equal(doc.getElementsByTagName('measure').length, 6);
  assert.match(xml, /<work-title>테스트 &amp; 곡<\/work-title>/);
  assert.match(xml, /<fifths>-1<\/fifths>/);
  assert.match(xml, /<beats>3<\/beats>/);
  // F장조의 Bb은 임시표 없음, B♮에는 제자리표
  assert.doesNotMatch(xml, /<step>B<\/step><alter>-1<\/alter><octave>4<\/octave><\/pitch><duration>24<\/duration><voice>1<\/voice><type>quarter<\/type><accidental>/);
  assert.match(xml, /<step>B<\/step><octave>4<\/octave><\/pitch><duration>24<\/duration><voice>1<\/voice><type>quarter<\/type><accidental>natural<\/accidental>/);
  assert.match(xml, /<chord\/><pitch><step>C<\/step><octave>3<\/octave>/);
  assert.match(xml, /<duration>72<\/duration>/); // 점2분
  assert.match(xml, /<actual-notes>3<\/actual-notes>/);
  assert.match(xml, /<tuplet type="start"/);
  assert.match(xml, /<tuplet type="stop"\/>/);
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<tie type="stop"\/>/); // 다음 마디 A4로 이어짐
  assert.match(xml, /<root-step>C<\/root-step><\/root><kind text="7">dominant<\/kind><bass><bass-step>E<\/bass-step>/);
  // 3마디 오른손: 모자란 박 쉼표 채움 (24 + 48)
  assert.match(xml, /<note><rest\/><duration>48<\/duration>/);
  // 빈 왼손 마디 → 온마디 쉼표
  assert.match(xml, /<rest measure="yes"\/><duration>72<\/duration>/);
});

test('인식 결과도 이조된다', () => {
  const doc = parse(buildMusicXml(score));
  const info = transposeMusicXml(doc, 2);
  assert.equal(info.fromKey, 'F');
  assert.equal(info.toKey, 'G');
  const out = new XMLSerializer().serializeToString(doc);
  assert.match(out, /<root-step>G<\/root-step>/);
});

test('응답에서 JSON 추출·페이지 병합', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('죄송합니다'));
  const m = mergePages([
    { parts: [{}], key: { fifths: 0 }, time: '4/4', measures: [{ parts: [[]] }] },
    { parts: [{}], key: { fifths: 2 }, time: '4/4', measures: [{ parts: [[]] }, { parts: [[]] }] },
  ]);
  assert.equal(m.measures.length, 3);
  assert.deepEqual(m.measures[1].key, { fifths: 2 });
  assert.match(buildPrompt({ page: 2, pages: 3, context: '{"x":1}' }), /2\/3 페이지[\s\S]*\{"x":1\}/);
});
