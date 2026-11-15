import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { transposeMusicXml } from '../src/musicxml.js';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <harmony><root><root-step>C</root-step></root><kind>major</kind><bass><bass-step>E</bass-step></bass></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><accidental>sharp</accidental></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><rest/><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const run = (semis, opts) => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const info = transposeMusicXml(doc, semis, opts);
  return { info, out: new XMLSerializer().serializeToString(doc) };
};

test('C → Bb (−2)', () => {
  const { info, out } = run(-2);
  assert.equal(info.fromKey, 'C');
  assert.equal(info.toKey, 'Bb');
  assert.equal(info.notes, 3);
  assert.match(out, /<fifths>-2<\/fifths>/);
  assert.match(out, /<step>B<\/step><alter>-1<\/alter><octave>3<\/octave>/);
  assert.match(out, /<step>E<\/step><octave>4<\/octave>/);         // F# → E♮
  assert.match(out, /<accidental>natural<\/accidental>/);
  assert.match(out, /<step>A<\/step><octave>4<\/octave>/);
  assert.match(out, /<root-step>B<\/root-step><root-alter>-1<\/root-alter>/);
  assert.match(out, /<bass-step>D<\/bass-step>/);
});

test('C → D (+2)', () => {
  const { out } = run(2);
  assert.match(out, /<fifths>2<\/fifths>/);
  assert.match(out, /<step>G<\/step><alter>1<\/alter><octave>4<\/octave>/);
  assert.match(out, /<accidental>sharp<\/accidental>/);
  assert.match(out, /<step>C<\/step><alter>1<\/alter><octave>5<\/octave>/);
});
