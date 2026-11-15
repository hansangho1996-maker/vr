// MusicXML(score-partwise) 이조
// 브라우저 DOMParser 문서와 Node의 @xmldom/xmldom 문서 모두에서 동작하도록
// 표준 DOM API(childNodes, getElementsByTagName 등)만 사용한다.

import { makeTransposer, transposePitch, LETTERS, keyName } from './theory.js';

const ACCIDENTAL_NAMES = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const KNOWN_ACCIDENTALS = new Set(Object.values(ACCIDENTAL_NAMES));

const children = (el, name) => {
  const out = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || n.nodeName === name)) out.push(n);
  }
  return out;
};
const child = (el, name) => children(el, name)[0] || null;
const text = (el) => (el ? el.textContent.trim() : '');

function setText(el, value) {
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(el.ownerDocument.createTextNode(String(value)));
}

/** parent 안의 stepName 요소 다음에 alterName 요소를 맞춰 넣거나 지운다. */
function writeStepAlter(parent, stepName, alterName, step, alter) {
  const stepEl = child(parent, stepName);
  setText(stepEl, LETTERS[step]);
  let alterEl = child(parent, alterName);
  if (alter === 0) {
    if (alterEl) parent.removeChild(alterEl);
    return;
  }
  if (!alterEl) {
    alterEl = parent.ownerDocument.createElement(alterName);
    parent.insertBefore(alterEl, stepEl.nextSibling);
  }
  setText(alterEl, alter);
}

function readStepAlter(parent, stepName, alterName) {
  const step = LETTERS.indexOf(text(child(parent, stepName)).toUpperCase());
  const alterStr = text(child(parent, alterName));
  const alter = alterStr ? parseFloat(alterStr) : 0;
  return { step, alter };
}

/** 악보의 첫 조표를 읽는다. */
export function detectKey(doc) {
  const key = doc.getElementsByTagName('key')[0];
  if (!key || !child(key, 'fifths')) return { fifths: 0, minor: false };
  return {
    fifths: parseInt(text(child(key, 'fifths')), 10) || 0,
    minor: text(child(key, 'mode')) === 'minor',
  };
}

/**
 * MusicXML 문서를 제자리에서 이조한다.
 * @returns {{fromKey:string, toKey:string, notes:number}}
 */
export function transposeMusicXml(doc, semitones, { prefer = 'auto' } = {}) {
  const root = doc.documentElement;
  if (root.nodeName === 'score-timewise') {
    throw new Error('score-timewise 형식은 지원하지 않습니다. 악보 프로그램에서 일반 MusicXML로 다시 내보내 주세요.');
  }
  if (root.nodeName !== 'score-partwise') {
    throw new Error('MusicXML 악보가 아닙니다 (score-partwise 요소를 찾을 수 없음).');
  }

  const first = detectKey(doc);
  let notes = 0;
  let quarterToneSkipped = 0;

  for (const part of children(root, 'part')) {
    let tr = makeTransposer(0, semitones, prefer);
    for (const measure of children(part, 'measure')) {
      for (const el of children(measure)) {
        if (el.nodeName === 'attributes') {
          for (const key of children(el, 'key')) {
            const fifthsEl = child(key, 'fifths');
            if (!fifthsEl) continue; // 비전통 조표(key-step 등)는 건너뜀
            tr = makeTransposer(parseInt(text(fifthsEl), 10) || 0, semitones, prefer);
            setText(fifthsEl, tr.newFifths);
          }
        } else if (el.nodeName === 'note') {
          const pitch = child(el, 'pitch');
          if (!pitch) continue; // 쉼표, 타악기(unpitched)
          const { step, alter } = readStepAlter(pitch, 'step', 'alter');
          if (!Number.isInteger(alter)) { quarterToneSkipped++; continue; }
          const octave = parseInt(text(child(pitch, 'octave')), 10);
          const p = transposePitch({ step, alter, octave }, tr);
          writeStepAlter(pitch, 'step', 'alter', p.step, p.alter);
          setText(child(pitch, 'octave'), p.octave);
          const acc = child(el, 'accidental');
          if (acc && KNOWN_ACCIDENTALS.has(text(acc)) && ACCIDENTAL_NAMES[p.alter]) {
            setText(acc, ACCIDENTAL_NAMES[p.alter]);
          }
          notes++;
        } else if (el.nodeName === 'harmony') {
          for (const [box, s, a] of [['root', 'root-step', 'root-alter'], ['bass', 'bass-step', 'bass-alter']]) {
            const boxEl = child(el, box);
            if (!boxEl || !child(boxEl, s)) continue;
            const { step, alter } = readStepAlter(boxEl, s, a);
            const p = transposePitch({ step, alter: Math.round(alter), octave: 4 }, tr);
            writeStepAlter(boxEl, s, a, p.step, p.alter);
          }
        }
      }
    }
  }

  const tr0 = makeTransposer(first.fifths, semitones, prefer);
  return {
    fromKey: keyName(first.fifths, first.minor),
    toKey: keyName(tr0.newFifths, first.minor),
    notes,
    quarterToneSkipped,
  };
}
