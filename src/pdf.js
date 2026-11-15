// PDF 읽기 (브라우저 전용, pdf.js 사용)
//   - 텍스트가 들어 있는 PDF: 글자 위치를 이용해 줄/칸을 복원한다 (코드 악보용)
//   - 스캔·악보 PDF: 페이지를 PNG 이미지로 그린다 (악보 인식용)

function lib() {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('PDF 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
  // index.html에서 pdf.worker.min.js를 일반 <script>로 불러와 두므로(window.pdfjsWorker)
  // 별도 워커 없이 메인 스레드에서 동작한다. (아티팩트 화면은 외부 워커를 막기 때문)
  return pdfjs;
}

export async function openPdf(arrayBuffer) {
  return lib().getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
}

/** 한 페이지의 글자들을 줄 단위 텍스트로 복원 (가로 위치는 공백으로 맞춤) */
async function pageText(page) {
  const content = await page.getTextContent();
  const items = content.items.filter((it) => it.str && it.str.trim());
  if (!items.length) return '';
  // 글자 폭 추정: 라틴 문자가 들어간 조각들의 평균 글자 폭
  const widths = items
    .filter((it) => /^[\x20-\x7e]+$/.test(it.str) && it.width > 0)
    .map((it) => it.width / it.str.length)
    .sort((a, b) => a - b);
  const charW = widths.length ? widths[Math.floor(widths.length / 2)] : 6;
  const minX = Math.min(...items.map((it) => it.transform[4]));

  const rows = [];
  for (const it of items) {
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < h * 0.4);
    if (!row) rows.push((row = { y, items: [] }));
    row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);

  const lines = [];
  let prevY = null;
  for (const row of rows) {
    if (prevY !== null && prevY - row.y > 2.2 * (Math.abs(row.items[0].transform[3]) || 10)) lines.push('');
    prevY = row.y;
    row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let line = '';
    let prevEnd = null;
    for (const it of row.items) {
      const x = it.transform[4];
      const gap = prevEnd === null ? Infinity : x - prevEnd;
      if (gap < charW * 1.5) {
        // 같은 문장 안의 단어 사이: 공백 하나만
        if (gap > charW * 0.2 && !line.endsWith(' ')) line += ' ';
        line += it.str;
      } else {
        // 멀리 떨어진 글자(코드 등): 가로 위치를 칸 수로 맞춤
        const col = Math.round((x - minX) / charW);
        line = line.padEnd(Math.max(col, line.length + (line && !line.endsWith(' ') ? 1 : 0)), ' ') + it.str;
      }
      prevEnd = x + (it.width || it.str.length * charW);
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

export async function extractText(pdf) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) pages.push(await pageText(await pdf.getPage(i)));
  return pages.join('\n\n');
}

/** 페이지를 PNG Blob으로 그린다. 긴 변이 maxSide 픽셀 정도가 되도록 맞춘다. */
export async function renderPage(pdf, pageNo, maxSide = 2000) {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, maxSide / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

/** 사진 파일을 적당한 크기의 JPEG/PNG로 줄인다. */
export async function normalizeImage(file, maxSide = 2000) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
}
