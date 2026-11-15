// 예제 데이터 (직접 만든 짧은 멜로디)

const notes = [
  // [step, alter, octave, type, duration]
  [['G', 0, 4, 'quarter', 1], ['B', 0, 4, 'quarter', 1], ['D', 0, 5, 'quarter', 1], ['B', 0, 4, 'quarter', 1]],
  [['C', 0, 5, 'quarter', 1], ['E', 0, 5, 'quarter', 1], ['D', 0, 5, 'half', 2]],
  [['A', 0, 4, 'quarter', 1], ['C', 1, 5, 'quarter', 1, 'sharp'], ['D', 0, 5, 'quarter', 1], ['F', 1, 5, 'quarter', 1]],
  [['G', 0, 5, 'whole', 4]],
];
const chords = [['G', 'major'], ['C', 'major'], ['D', 'dominant'], ['G', 'major']];

function noteXml([step, alter, octave, type, duration, acc]) {
  return `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`
    + `<duration>${duration}</duration><type>${type}</type>${acc ? `<accidental>${acc}</accidental>` : ''}</note>`;
}

export const SAMPLE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>예제 멜로디</work-title></work>
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
${notes.map((m, i) => `    <measure number="${i + 1}">
${i === 0 ? '      <attributes><divisions>1</divisions><key><fifths>1</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>\n' : ''}      <harmony><root><root-step>${chords[i][0]}</root-step></root><kind>${chords[i][1]}</kind></harmony>
      ${m.map(noteXml).join('\n      ')}
    </measure>`).join('\n')}
  </part>
</score-partwise>`;

export const SAMPLE_CHORDS = `[Verse]
G          D/F#       Em      C
오늘 하루도 수고했어요   천천히 걸어가요
G          D          C   D7  G
작은 별빛이 우리를 비춰    | 주네요 |

[Chorus - ChordPro 형식도 지원]
[C]함께라면 [D]괜찮아 [Bm7]언제든 [Em]웃어요
[Am7]그대 [D7sus4]곁에 [D7]있을 [G]게요`;
