import { INSTRUMENT_PRESETS, keyName, targetFifths, tonicOfFifths, semitoneDistance, mod } from './theory.js';
import { transposeChordText, detectKey as detectChordKey } from './chords.js';
import { transposeMusicXml, detectKey as detectXmlKey } from './musicxml.js';
import { SAMPLE_MUSICXML, SAMPLE_CHORDS } from './sample.js';
import { isChordLine } from './chords.js';
import { buildSystemPrompt, buildFixPrompt, buildGroupingPrompt, parseGroups, extractJson, validateSystem, mergeSystems, buildMusicXml, contextFrom } from './omr.js';
import { openPdf, extractText, renderPage, imageToCanvas, grayOf, cropToBlob, labeledPage, canvasToBlob } from './pdf.js';
import { detectStaves, systemBands, guessGroups } from './layout.js';

const $ = (id) => document.getElementById(id);
const el = {
  fromKey: $('fromKey'), toKey: $('toKey'), direction: $('direction'), semis: $('semis'),
  preset: $('preset'), prefer: $('prefer'), summary: $('summary'),
  file: $('file'), drop: $('drop'), xmlActions: $('xmlActions'), fileName: $('fileName'),
  xmlError: $('xmlError'), score: $('score'), viewResult: $('viewResult'), viewOriginal: $('viewOriginal'),
  chordIn: $('chordIn'), chordOut: $('chordOut'),
};

const state = {
  tab: 'xml',
  xml: { original: null, transposed: null, name: '', key: { fifths: 0, minor: false }, view: 'result' },
  chordKey: { fifths: 0, minor: false }, // 자동 감지 결과
};

const INTERVALS = ['완전1도(같은 음)', '단2도', '장2도', '단3도', '장3도', '완전4도', '증4도/감5도', '완전5도', '단6도', '장6도', '단7도', '장7도', '옥타브'];
const PITCH_ORDER = (f) => mod(7 * f, 12); // 조표 → 으뜸음 피치클래스

// ---------- 설정 UI ----------

INSTRUMENT_PRESETS.forEach((p) => el.preset.add(new Option(p.label, p.id)));

function currentFromKey() {
  if (state.tab === 'xml') return state.xml.key;
  const v = el.fromKey.value;
  if (v === 'auto') return state.chordKey;
  const [f, m] = v.split(':');
  return { fifths: +f, minor: m === 'm' };
}

function keysFor(minor) {
  const list = [];
  for (let f = -7; f <= 7; f++) list.push(f);
  return list.sort((a, b) => PITCH_ORDER(minor ? a + 3 : a) - PITCH_ORDER(minor ? b + 3 : b) || a - b)
    .map((f) => ({ f, name: keyName(f, minor, 'unicode') }));
}

function fillFromKeySelect() {
  const sel = el.fromKey;
  const prev = sel.value;
  sel.innerHTML = '';
  if (state.tab === 'xml') {
    const k = state.xml.key;
    sel.add(new Option(`${keyName(k.fifths, k.minor, 'unicode')}${k.minor ? ' (단조)' : ' (장조)'} — 악보 조표`, 'xml'));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const k = state.chordKey;
  sel.add(new Option(`자동 감지 (${keyName(k.fifths, k.minor, 'unicode')})`, 'auto'));
  for (const minor of [false, true]) {
    for (const { f, name } of keysFor(minor)) sel.add(new Option(name, `${f}:${minor ? 'm' : ''}`));
  }
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : 'auto';
}

function fillToKeySelect() {
  const from = currentFromKey();
  const sel = el.toKey;
  sel.innerHTML = '';
  for (const { f, name } of keysFor(from.minor)) sel.add(new Option(name, f));
  sel.value = targetFifths(from.fifths, +el.semis.value || 0, el.prefer.value);
}

function semisForTarget(from, toFifths) {
  const offset = from.minor ? 3 : 0;
  const a = tonicOfFifths(from.fifths + offset);
  const b = tonicOfFifths(toFifths + offset);
  const up = semitoneDistance(a, b);
  const dir = el.direction.value;
  if (dir === 'up') return up;
  if (dir === 'down') return up === 0 ? 0 : up - 12;
  return up > 6 ? up - 12 : up;
}

function interval(semis) {
  if (semis === 0) return '이동 없음';
  const abs = Math.abs(semis);
  const oct = Math.floor(abs / 12);
  const rest = abs % 12;
  const name = rest === 0 ? `${oct === 1 ? '' : oct}옥타브` : (oct ? `${oct}옥타브 + ` : '') + INTERVALS[rest];
  return `${name} ${semis > 0 ? '위' : '아래'}`;
}

function updateSummary(fromName, toName) {
  const s = +el.semis.value || 0;
  el.summary.textContent = `${fromName} → ${toName}  ·  반음 ${s > 0 ? '+' : ''}${s} (${interval(s)})`;
}

// ---------- MusicXML ----------

let osmd = null;
let renderTimer = null;

function getOsmd() {
  if (!osmd) {
    if (!window.opensheetmusicdisplay) throw new Error('악보 렌더러를 불러오지 못했습니다 (인터넷 연결 확인). 다운로드는 정상 동작합니다.');
    osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(el.score, {
      backend: 'svg', autoResize: true, drawTitle: true, drawingParameters: 'default',
    });
  }
  return osmd;
}

function showError(msg) {
  el.xmlError.textContent = msg || '';
  el.xmlError.hidden = !msg;
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    const xml = state.xml.view === 'result' ? state.xml.transposed : state.xml.original;
    if (!xml) return;
    try {
      const o = getOsmd();
      await o.load(xml);
      o.render();
    } catch (e) {
      showError(e.message || String(e));
    }
  }, 150);
}

function transposeXml() {
  if (!state.xml.original) return;
  try {
    const doc = new DOMParser().parseFromString(state.xml.original, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.');
    const info = transposeMusicXml(doc, +el.semis.value || 0, { prefer: el.prefer.value });
    state.xml.transposed = new XMLSerializer().serializeToString(doc);
    state.xml.info = info;
    showError(info.quarterToneSkipped ? `미분음 ${info.quarterToneSkipped}개는 이조하지 않았습니다.` : '');
    const k = state.xml.key;
    updateSummary(keyName(k.fifths, k.minor, 'unicode'), keyName(targetFifths(k.fifths, +el.semis.value || 0, el.prefer.value), k.minor, 'unicode'));
    scheduleRender();
  } catch (e) {
    showError(e.message || String(e));
  }
}

async function readScoreFile(file) {
  if (/\.mxl$/i.test(file.name)) {
    if (!window.JSZip) throw new Error('.mxl 압축 해제 라이브러리를 불러오지 못했습니다. .musicxml 파일을 사용해 주세요.');
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    let path = null;
    const container = zip.file('META-INF/container.xml');
    if (container) {
      const c = new DOMParser().parseFromString(await container.async('string'), 'application/xml');
      path = c.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
    }
    path ||= Object.keys(zip.files).find((p) => !p.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(p));
    if (!path || !zip.file(path)) throw new Error('.mxl 안에서 악보 파일을 찾을 수 없습니다.');
    return zip.file(path).async('string');
  }
  return file.text();
}

function loadXml(xmlString, name) {
  $('omrNote').hidden = true;
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    showError('XML을 읽을 수 없습니다. MusicXML 파일이 맞는지 확인해 주세요.');
    return;
  }
  state.xml.original = xmlString;
  state.xml.name = name;
  state.xml.key = detectXmlKey(doc);
  el.fileName.textContent = name;
  el.xmlActions.hidden = false;
  el.score.hidden = false;
  setView('result');
  fillFromKeySelect();
  fillToKeySelect();
  transposeXml();
}

async function handleFile(file) {
  if (!file) return;
  showError('');
  try {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return await handlePdf(file);
    if (/^image\//.test(file.type)) return await recognizePages([await imageToCanvas(file)], file.name);
    loadXml(await readScoreFile(file), file.name);
  } catch (e) {
    showError(e.message || String(e));
  }
}

// ---------- PDF / 사진 악보 ----------

const MAX_PAGES = 12;
let omrAbort = null;

function setStatus(msg) {
  $('omrStatus').hidden = !msg;
  $('omrText').textContent = msg || '';
}

async function handlePdf(file) {
  setStatus('PDF를 읽는 중…');
  try {
    const pdf = await openPdf(await file.arrayBuffer());
    const text = await extractText(pdf);
    const lines = text.split('\n');
    const chordLines = lines.filter((l) => isChordLine(l)).length;
    const bracketChords = (text.match(/\[[A-G][^\]\s]*\]/g) || []).length;
    if (chordLines >= 2 || bracketChords >= 3) {
      // 글자로 된 코드 악보 → 코드 악보 탭으로
      setStatus('');
      document.querySelector('.tabs [data-tab="chord"]').click();
      el.chordIn.value = text;
      el.fromKey.value = 'auto';
      transposeChords();
      fillToKeySelect();
      $('chordNote').textContent = `"${file.name}"에서 코드 ${chordLines}줄을 읽어 왔습니다. 줄 맞춤이 어긋난 곳은 직접 고쳐 주세요.`;
      return;
    }
    const n = Math.min(pdf.numPages, MAX_PAGES);
    const pages = [];
    for (let i = 1; i <= n; i++) {
      setStatus(`페이지 이미지 준비 중… (${i}/${n})`);
      pages.push(await renderPage(pdf, i));
    }
    await recognizePages(pages, file.name, pdf.numPages > MAX_PAGES ? `앞 ${MAX_PAGES}페이지만 인식했습니다.` : '');
  } finally {
    if (!omrAbort) setStatus('');
  }
}

const SAMPLE_ERRORS = {
  cancelled: '악보 인식을 멈췄습니다.',
  not_granted: 'Claude 사용을 허용하지 않아 악보를 인식할 수 없습니다.',
  rate_limited: '요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
  image_rejected: '이미지를 보낼 수 없습니다 (형식이나 크기 문제).',
};
const sampleMessage = (e) => SAMPLE_ERRORS[e?.code] || `악보 인식 중 오류가 났습니다 (${e?.code || e?.message || e}).`;

/** 페이지 하나를 단(system) 이미지들로 자른다. */
async function splitPage(sample, canvas, pageNo, pageCount) {
  const { staves, skew, xRef } = detectStaves(grayOf(canvas), canvas.width, canvas.height);
  if (staves.length === 0) {
    // 오선을 못 찾음(기울어진 사진 등) → 페이지 통째로
    return [{ blob: await cropToBlob(canvas, 0, canvas.height, 2400), page: pageNo }];
  }
  let groups = null;
  if (staves.length > 1) {
    setStatus(`${pageNo}/${pageCount} 페이지: 단 나누는 중…`);
    try {
      const { text } = await sample(buildGroupingPrompt(staves.length), {
        images: [await labeledPage(canvas, staves)],
        modelTier: 'default',
        signal: omrAbort.signal,
      });
      groups = parseGroups(text, staves.length);
    } catch (e) {
      if (e?.code === 'cancelled' || e?.code === 'not_granted') throw e;
    }
  }
  if (!groups) groups = staves.length > 1 ? guessGroups(grayOf(canvas), canvas.width, canvas.height, staves, skew, xRef) : [[0]];
  const bands = systemBands(staves, groups, canvas.width, canvas.height, skew);
  const out = [];
  for (const b of bands) out.push({ blob: await cropToBlob(canvas, b.y0, b.y1), page: pageNo });
  return out;
}

/** 단 하나를 받아 적고, 박자가 안 맞으면 한 번 검토시킨다. */
async function transcribeSystem(sample, task, index, total, context, onProgress) {
  const ask = (prompt) => sample(prompt, {
    images: [task.blob],
    modelTier: 'complex',
    signal: omrAbort.signal,
    onText: ({ text }) => onProgress(text.length),
  });
  let json = extractJson((await ask(buildSystemPrompt({ index, total, context }))).text);
  const opts = { allowPickup: index === 1 };
  let problems = validateSystem(json, opts);
  if (problems.length) {
    onProgress(0, true);
    try {
      const fixed = extractJson((await ask(buildFixPrompt(json, problems.slice(0, 20)))).text);
      const after = validateSystem(fixed, opts);
      if (after.length <= problems.length) { json = fixed; problems = after; }
    } catch (e) {
      if (e?.code === 'cancelled') throw e;
    }
  }
  return { json, problems };
}

async function recognizePages(canvases, name, note = '') {
  const sample = window.claude?.use ? await window.claude.use('sample') : null;
  if (!sample) {
    throw new Error('오선 악보 인식은 claude.ai에서 이 페이지를 열었을 때만 쓸 수 있습니다. 글자로 된 코드 악보 PDF는 어디서나 됩니다.');
  }
  const limits = await sample.limits().catch(() => null);
  if (!limits?.images) throw new Error('이 화면에서는 악보 이미지를 Claude에게 보낼 수 없습니다.');

  showPages(await Promise.all(canvases.map((c) => canvasToBlob(c))));
  omrAbort = new AbortController();
  const notes = note ? [note] : [];
  let results = [];
  try {
    // 1) 페이지 → 단 이미지
    const tasks = [];
    for (let i = 0; i < canvases.length; i++) {
      setStatus(`${i + 1}/${canvases.length} 페이지: 오선 찾는 중…`);
      tasks.push(...(await splitPage(sample, canvases[i], i + 1, canvases.length)));
    }

    // 2) 단마다 받아 적기 (첫 단으로 파트 구성을 정한 뒤 나머지는 2개씩 동시에)
    results = new Array(tasks.length);
    const status = new Array(tasks.length).fill('');
    const show = () => {
      const done = results.filter(Boolean).length;
      const active = status.map((s, i) => (s ? `${i + 1}번 ${s}` : '')).filter(Boolean).join(', ');
      setStatus(`악보 읽는 중: ${done}/${tasks.length}단 완료${active ? ` (${active})` : ''} — 단마다 1~2분 걸려요.`);
    };
    let context = '';
    const run = async (i) => {
      status[i] = '읽는 중';
      show();
      const r = await transcribeSystem(sample, tasks[i], i + 1, tasks.length, context, (chars, fixing) => {
        status[i] = fixing ? '검토 중' : `받아 적는 중 ${Math.round(chars / 100) / 10}k자`;
        show();
      });
      status[i] = '';
      results[i] = r;
      show();
      return r;
    };
    const firstResult = await run(0);
    context = contextFrom(firstResult.json);
    let next = 1;
    const worker = async () => {
      while (next < tasks.length) {
        const i = next++;
        try {
          await run(i);
        } catch (e) {
          if (e?.code === 'cancelled' || e?.code === 'not_granted') throw e;
          status[i] = '';
          results[i] = { failed: true, error: e };
        }
      }
    };
    await Promise.all([worker(), worker()]);
  } catch (e) {
    const done = (results || []).filter((r) => r && !r.failed);
    if (!done.length) { omrAbort = null; setStatus(''); throw new Error(sampleMessage(e)); }
    notes.push(`${sampleMessage(e)} 읽은 부분까지만 보여 드립니다.`);
  }
  omrAbort = null;
  setStatus('');

  const ok = [];
  const failed = [];
  const unsure = [];
  (results || []).forEach((r, i) => {
    if (!r) return;
    if (r.failed) { failed.push(i + 1); return; }
    ok.push(r.json);
    if (r.problems.length) unsure.push(i + 1);
  });
  if (failed.length) notes.push(`${failed.join(', ')}번째 단은 읽지 못해 빠졌습니다.`);
  if (unsure.length) notes.push(`${unsure.join(', ')}번째 단은 박자가 맞지 않는 마디가 있어요. 특히 확인해 주세요.`);

  const merged = mergeSystems(ok);
  if (!merged.title) merged.title = name.replace(/\.[^.]+$/, '');
  const xml = buildMusicXml(merged);
  loadXml(xml, name.replace(/\.[^.]+$/, '') + '.musicxml');
  $('omrNote').hidden = false;
  $('omrNote').textContent = `자동 인식 결과입니다. 틀린 음이 있을 수 있으니 아래 원본 페이지와 비교해 주세요. ${notes.join(' ')}`.trim();
}

function showPages(blobs) {
  const box = $('pages');
  box.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
  box.innerHTML = '';
  for (const b of blobs) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(b);
    img.alt = '원본 악보 페이지';
    box.appendChild(img);
  }
  $('pagesBox').hidden = false;
}

function setView(v) {
  state.xml.view = v;
  el.viewResult.setAttribute('aria-pressed', v === 'result');
  el.viewOriginal.setAttribute('aria-pressed', v === 'original');
  scheduleRender();
}

async function download() {
  if (!state.xml.transposed) return;
  const base = state.xml.name.replace(/\.(musicxml|xml|mxl)$/i, '');
  const to = keyName(targetFifths(state.xml.key.fifths, +el.semis.value || 0, el.prefer.value), state.xml.key.minor);
  const filename = `${base}_${to}.musicxml`;

  // claude.ai 아티팩트 안에서는 직접 다운로드가 막혀 있으므로 downloads 기능으로 zip을 저장한다.
  const downloads = window.claude?.use ? await window.claude.use('downloads') : null;
  if (downloads) {
    try {
      const zip = new window.JSZip();
      zip.file(filename, state.xml.transposed);
      const data = await zip.generateAsync({ type: 'blob' });
      await downloads.save({ filename: `${base}_${to}.zip`, data });
    } catch (e) {
      if (e?.code !== 'declined') showError(`저장하지 못했습니다: ${e?.message || e}`);
    }
    return;
  }

  const blob = new Blob([state.xml.transposed], { type: 'application/vnd.recordare.musicxml+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 코드 악보 ----------

function transposeChords() {
  const text = el.chordIn.value;
  const detected = detectChordKey(text);
  if (detected) state.chordKey = detected;
  const autoOpt = el.fromKey.querySelector('option[value="auto"]');
  if (autoOpt) autoOpt.textContent = `자동 감지 (${keyName(state.chordKey.fifths, state.chordKey.minor, 'unicode')})`;
  if (el.fromKey.value === 'auto') fillToKeySelect();
  const from = currentFromKey();
  const r = transposeChordText(text, +el.semis.value || 0, { fromKey: from, prefer: el.prefer.value });
  el.chordOut.value = r.text;
  updateSummary(keyName(from.fifths, from.minor, 'unicode'), keyName(targetFifths(from.fifths, +el.semis.value || 0, el.prefer.value), from.minor, 'unicode'));
}

// ---------- 공통 ----------

function refresh() {
  if (state.tab === 'xml') {
    if (state.xml.original) transposeXml();
    else updateSummary(keyName(0, false, 'unicode'), keyName(targetFifths(0, +el.semis.value || 0, el.prefer.value), false, 'unicode'));
  } else {
    transposeChords();
  }
}

function setSemis(v, { keepPreset = false } = {}) {
  el.semis.value = Math.max(-36, Math.min(36, v));
  if (!keepPreset) el.preset.value = 'none';
  fillToKeySelect();
  refresh();
}

el.semis.addEventListener('input', () => setSemis(+el.semis.value || 0));
$('semiUp').addEventListener('click', () => setSemis((+el.semis.value || 0) + 1));
$('semiDown').addEventListener('click', () => setSemis((+el.semis.value || 0) - 1));
el.preset.addEventListener('change', () => {
  const p = INSTRUMENT_PRESETS.find((x) => x.id === el.preset.value);
  if (p && p.semitones !== null) setSemis(p.semitones, { keepPreset: true });
});
el.prefer.addEventListener('change', () => { fillToKeySelect(); refresh(); });
el.toKey.addEventListener('change', () => {
  const to = +el.toKey.value;
  el.prefer.value = to > 0 ? 'sharp' : to < 0 ? 'flat' : 'auto';
  el.preset.value = 'none';
  el.semis.value = semisForTarget(currentFromKey(), to);
  refresh();
});
el.direction.addEventListener('change', () => el.toKey.dispatchEvent(new Event('change')));
el.fromKey.addEventListener('change', () => {
  const to = +el.toKey.value;
  fillToKeySelect();
  // 단/장조가 같으면 목표 조를 유지하도록 반음 수를 다시 계산
  if ([...el.toKey.options].some((o) => +o.value === to)) {
    el.toKey.value = to;
    el.semis.value = semisForTarget(currentFromKey(), to);
  }
  refresh();
});

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  state.tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
  $('tab-xml').hidden = state.tab !== 'xml';
  $('tab-chord').hidden = state.tab !== 'chord';
  fillFromKeySelect();
  fillToKeySelect();
  refresh();
}));

el.file.addEventListener('change', () => handleFile(el.file.files[0]));
['dragenter', 'dragover'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => el.drop.addEventListener(t, () => el.drop.classList.remove('over')));
el.drop.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
$('loadSample').addEventListener('click', () => { $('pagesBox').hidden = true; loadXml(SAMPLE_MUSICXML, '예제 멜로디.musicxml'); });
$('omrStop').addEventListener('click', () => omrAbort?.abort());
el.viewResult.addEventListener('click', () => setView('result'));
el.viewOriginal.addEventListener('click', () => setView('original'));
$('download').addEventListener('click', download);
$('print').addEventListener('click', () => window.print());
if (window.claude?.use) {
  $('print').hidden = true; // 아티팩트 화면에서는 인쇄 창을 열 수 없음
  $('download').textContent = 'MusicXML 다운로드 (.zip)';
}

el.chordIn.addEventListener('input', () => { $('chordNote').textContent = ''; transposeChords(); });
$('chordSample').addEventListener('click', () => { el.chordIn.value = SAMPLE_CHORDS; el.fromKey.value = 'auto'; transposeChords(); fillToKeySelect(); });
$('chordCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(el.chordOut.value); $('chordCopy').textContent = '복사됨!'; } catch { el.chordOut.select(); }
  setTimeout(() => { $('chordCopy').textContent = '복사'; }, 1200);
});

fillFromKeySelect();
fillToKeySelect();
refresh();
