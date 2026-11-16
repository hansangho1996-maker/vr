import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { buildMusicXml, extractJson, mergePages, buildSystemPrompt, mergeSystems, validateSystem, parseGroups } from '../src/omr.js';
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
  assert.match(buildSystemPrompt({ index: 2, total: 3, context: '{"x":1}' }), /2\/3번째 단[\s\S]*\{"x":1\}/);
});

// 새 형식: 단(system) 단위, 큰보표·두 성부·가사·셈여림
const sys1 = {
  title: '고향',
  staves: [{ part: 'Piano', clef: 'G' }, { part: 'Piano', clef: 'F' }],
  key: { fifths: -5, mode: 'major' },
  time: '4/4',
  measures: [{
    dirs: [{ staff: 1, beat: 1, dyn: 'mp' }, { staff: 0, beat: 1, text: '보통 빠르기로, 곱게' }],
    staves: [
      [[{ p: 'Ab5', d: '8', g: 1 }, { p: 'Db6', d: 'w', fer: 1 }]],
      [[{ r: 1, d: '8' }, { p: 'Db3', d: '8' }, { p: 'F3', d: '8' }, { p: 'Ab3', d: '8' }, { p: 'Db4', d: '8' }, { p: 'Ab3', d: '8' }, { p: 'F3', d: '8' }, { p: 'Db3', d: '8' }],
       [{ p: 'Db2', d: 'w' }]],
    ],
  }],
};
const sys2 = {
  staves: [{ part: 'Voice', clef: 'G' }, { part: 'Piano', clef: 'G' }, { part: 'Piano', clef: 'F' }],
  key: { fifths: -5, mode: 'major' },
  time: '4/4',
  measures: [{
    dirs: [{ staff: 0, beat: 1, dyn: 'mp', place: 'above' }],
    staves: [
      [[{ p: 'Ab4', d: 'h', dot: 1, slur: 'start', ly: ['국', '달'] }, { p: 'F4', d: '8', ly: ['화', '가'] }, { p: 'Db4', d: '8', slur: 'stop', ly: ['', '고'] }]],
      [[{ r: 1, d: 'w' }]],
      [[{ p: 'Db2', d: 'w' }]],
    ],
  }],
};

test('단 합치기: 오선이 많은 단 기준으로 파트 순서·빈 오선 채움', () => {
  const merged = mergeSystems([sys1, sys2]);
  assert.deepEqual(merged.staves.map((s) => s.part + s.clef), ['VoiceG', 'PianoG', 'PianoF']);
  assert.equal(merged.measures.length, 2);
  assert.deepEqual(merged.measures[0].staves[0], [[]]); // 첫 단에는 성악 없음
  assert.equal(merged.measures[0].dirs[0].staff, 2);     // mp는 왼손(전체 3번째 오선)
  assert.equal(merged.title, '고향');
});

test('큰보표·두 성부·가사·셈여림·꾸밈음·늘임표가 MusicXML에 들어간다', () => {
  const xml = buildMusicXml(mergeSystems([sys1, sys2]));
  const doc = parse(xml);
  assert.equal(doc.getElementsByTagName('score-part').length, 2); // Voice, Piano
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<clef number="2"><sign>F<\/sign>/);
  assert.match(xml, /<backup><duration>96<\/duration><\/backup>/);
  assert.match(xml, /<step>D<\/step><alter>-1<\/alter><octave>2<\/octave><\/pitch><duration>96<\/duration><voice>6<\/voice><type>whole<\/type><staff>2<\/staff>/);
  assert.match(xml, /<grace slash="yes"\/>/);
  assert.match(xml, /<fermata type="upright"\/>/);
  assert.match(xml, /<dynamics><mp\/><\/dynamics><\/direction-type><staff>2<\/staff>/);
  assert.match(xml, /<words font-weight="bold">보통 빠르기로, 곱게<\/words>/);
  assert.match(xml, /<lyric number="1"><syllabic>single<\/syllabic><text>국<\/text><\/lyric><lyric number="2">/);
  assert.match(xml, /<slur type="start" number="1"\/>/);
  assert.match(xml, /<slur type="stop" number="1"\/>/);
  // 이조해도 가사·셈여림은 그대로, 꾸밈음은 함께 이조
  const d = parse(xml);
  transposeMusicXml(d, 1);
  const out = new XMLSerializer().serializeToString(d);
  assert.match(out, /<fifths>2<\/fifths>/);
  assert.match(out, /<grace slash="yes"\/><pitch><step>A<\/step><octave>5<\/octave>/);
  assert.match(out, /<text>국<\/text>/);
});

test('박자 검사·단 묶음 응답 검증', () => {
  assert.deepEqual(validateSystem(sys2), []);
  const bad = structuredClone(sys2);
  bad.measures[0].staves[0][0].pop();
  const probs = validateSystem(bad);
  assert.equal(probs.length, 1);
  assert.match(probs[0], /0번 오선 1성부: 길이 합이 4분음표 3.5개/);
  assert.deepEqual(validateSystem(bad, { allowPickup: true }), []);
  assert.deepEqual(parseGroups('{"systems":[[1,2],[3,4,5]]}', 5), [[0, 1], [2, 3, 4]]);
  assert.equal(parseGroups('{"systems":[[1,3],[2]]}', 3), null);
});

test('같은 글자 지시(rit. 등)가 여러 오선에 있으면 한 번만', () => {
  const s = structuredClone(sys2);
  s.measures[0].dirs = [{ staff: 0, beat: 3, text: 'rit.' }, { staff: 1, beat: 3, text: 'rit.' }, { staff: 2, beat: 1, dyn: 'p' }, { staff: 0, beat: 1, dyn: 'p' }];
  const xml = buildMusicXml(mergeSystems([s]));
  assert.equal((xml.match(/>rit\.</g) || []).length, 1);
  assert.equal((xml.match(/<p\/>/g) || []).length, 2); // 셈여림은 오선마다 유지
});
