// 악보 페이지 이미지에서 오선과 단(system: 동시에 연주되는 오선 묶음)의 위치를 찾는다.
// 순수 함수라서 Node 테스트에서도 쓸 수 있다.
//
//   gray: Uint8Array (0=검정 ~ 255=흰색), width, height
//   반환: [{ y0, y1, top, bottom, staves }] — y0~y1이 잘라낼 범위. 찾지 못하면 null.

const DARK = 140;

/** x0~x1 세로 띠 안에서 오선 줄의 y 위치들을 찾는다 (띠가 좁아 기울기의 영향이 거의 없다) */
function findStaffLines(gray, w, h, x0, x1) {
  const width = x1 - x0;
  const lines = [];
  let y = 0;
  const dark = (yy) => {
    let c = 0;
    const off = yy * w;
    for (let x = x0; x < x1; x++) if (gray[off + x] < DARK) c++;
    return c / width;
  };
  while (y < h) {
    if (dark(y) >= 0.5) {
      const start = y;
      while (y < h && dark(y) >= 0.5) y++;
      if (y - start <= 12) lines.push((start + y - 1) / 2); // 너무 두꺼운 건 줄이 아님(빔·글자)
    } else y++;
  }
  return lines;
}

function groupStaves(lines) {
  const staves = [];
  let i = 0;
  while (i + 4 < lines.length) {
    const ys = lines.slice(i, i + 5);
    const gaps = ys.slice(1).map((v, k) => v - ys[k]);
    const med = [...gaps].sort((a, b) => a - b)[2];
    if (med >= 3 && gaps.every((g) => Math.abs(g - med) <= med * 0.35)) {
      staves.push({ top: ys[0], bottom: ys[4], spacing: med, lines: ys });
      i += 5;
    } else i++;
  }
  return staves;
}

/** 오선 하나의 세로줄(마디선) x 위치들. 위 줄부터 아래 줄까지 끊김 없이 이어진 세로선을 찾는다. */
function barlines(gray, w, h, staff, skew, xRef) {
  const xs = [];
  const pad = staff.spacing * 0.4;
  let run = -1;
  for (let x = 0; x < w; x++) {
    const dy = (x - xRef) * skew;
    const y0 = Math.max(0, Math.round(staff.top + dy + pad));
    const y1 = Math.min(h - 1, Math.round(staff.bottom + dy - pad));
    let dark = 0;
    for (let y = y0; y <= y1; y++) if (gray[y * w + x] < DARK) dark++;
    const isBar = y1 > y0 && dark / (y1 - y0 + 1) >= 0.95;
    if (isBar && run < 0) run = x;
    if (!isBar && run >= 0) {
      if (x - run <= staff.spacing * 0.8) xs.push((run + x - 1) / 2); // 굵은 덩어리는 제외
      run = -1;
    }
  }
  return xs;
}

/** 두 오선의 마디선 위치가 얼마나 겹치는가 (0~1) */
function barMatch(a, b, tol) {
  if (!a.length || !b.length) return 0;
  const hit = a.filter((x) => b.some((y) => Math.abs(x - y) <= tol)).length;
  return hit / Math.min(a.length, b.length);
}

/** 페이지의 오선들을 찾는다. 세로 띠 5개에서 찾은 결과를 합쳐 빔·글자에 가려진 오선도 놓치지 않는다. */
export function detectStaves(gray, w, h) {
  const strips = [0.15, 0.3, 0.45, 0.6, 0.75].map((a) => {
    const x0 = Math.round(w * a);
    const x1 = Math.round(w * (a + 0.1));
    return { cx: (x0 + x1) / 2, staves: groupStaves(findStaffLines(gray, w, h, x0, x1)) };
  });
  // 기울기: 가장 바깥쪽 두 띠에서 가까운 오선끼리 짝지어 높이 차이의 중앙값
  let skew = 0;
  const full = strips.filter((st) => st.staves.length);
  if (full.length >= 2) {
    const a = full[0];
    const b = full[full.length - 1];
    const diffs = [];
    for (const st of a.staves) {
      const m = b.staves.find((o) => Math.abs(o.top - st.top) < st.spacing * 1.5);
      if (m) diffs.push(m.top - st.top);
    }
    if (diffs.length) {
      diffs.sort((x, y) => x - y);
      skew = diffs[Math.floor(diffs.length / 2)] / (b.cx - a.cx);
      if (Math.abs(skew) > 0.05) skew = 0;
    }
  }
  const xRef = w / 2;
  const clusters = [];
  for (const strip of strips) {
    for (const st of strip.staves) {
      const top = st.top - (strip.cx - xRef) * skew;
      const bottom = st.bottom - (strip.cx - xRef) * skew;
      const c = clusters.find((k) => Math.abs(k.top - top) < st.spacing * 2);
      if (c) { c.tops.push(top); c.bottoms.push(bottom); } else clusters.push({ top, tops: [top], bottoms: [bottom], spacing: st.spacing });
    }
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const staves = clusters
    .map((c) => ({ top: med(c.tops), bottom: med(c.bottoms), spacing: c.spacing, hits: c.tops.length }))
    .sort((a, b) => a.top - b.top);
  return { staves, skew, xRef };
}

/**
 * 오선 묶음(단)별로 잘라낼 세로 범위를 계산한다.
 * groups: [[0,1,2],[3,4,5],...] (staves의 인덱스)
 */
export function systemBands(staves, groups, w, h, skew = 0) {
  const sys = groups.map((g) => ({
    top: staves[g[0]].top,
    bottom: staves[g[g.length - 1]].bottom,
    spacing: staves[g[0]].spacing,
    staves: g.length,
  }));
  const shift = Math.abs(w * skew) / 2;
  return sys.map((s, i) => {
    const staffH = s.spacing * 4;
    const prev = sys[i - 1];
    const next = sys[i + 1];
    const y0 = prev ? (prev.bottom + s.top) / 2 : s.top - staffH * 3;
    const y1 = next ? (s.bottom + next.top) / 2 : s.bottom + staffH * 2.5;
    return { ...s, y0: Math.max(0, Math.round(y0 - shift)), y1: Math.min(h, Math.round(y1 + shift)) };
  });
}

/** 마디선 위치로 단을 추정 (Claude에게 물을 수 없을 때 쓰는 대체 방법) */
export function guessGroups(gray, w, h, staves, skew, xRef) {
  const bars = staves.map((st) => barlines(gray, w, h, st, skew, xRef));
  const inner = bars.map((b, i) => {
    if (b.length < 2) return [];
    const margin = staves[i].spacing * 2.5;
    const lo = Math.min(...b) + margin;
    const hi = Math.max(...b) - margin;
    return b.filter((x) => x > lo && x < hi);
  });
  const groups = [[0]];
  for (let i = 1; i < staves.length; i++) {
    const same = barMatch(inner[i - 1], inner[i], Math.max(3, staves[i].spacing * 0.3)) >= 0.6;
    if (same) groups[groups.length - 1].push(i);
    else groups.push([i]);
  }
  return groups;
}
