// Dibujos SVG: diagrama de acorde, teclado y mástil. Los colores salen de CSS.
(function () {
  'use strict';
  const { mod } = globalThis.Theory;
  const { TUNING } = globalThis.Voicings;

  function guitar(v, rootPc, { fingers = true, label = '' } = {}) {
    if (!v) return '<div class="nodiagram">Sin digitación cómoda</div>';
    const SX = 17, SY = 21, X = 26, Y = 24, FRETS = 5;
    const fretted = v.frets.filter((f) => f > 0);
    const max = fretted.length ? Math.max(...fretted) : 0;
    const min = fretted.length ? Math.min(...fretted) : 1;
    const base = max <= FRETS ? 1 : min;
    const w = X + SX * 5 + 14;
    const h = Y + SY * FRETS + 8;
    const yOf = (f) => Y + (f - base + .5) * SY;
    let s = `<svg class="dg-guitar" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">`;
    for (let i = 0; i <= FRETS; i++) {
      s += `<line class="g-fret" x1="${X}" x2="${X + SX * 5}" y1="${Y + i * SY}" y2="${Y + i * SY}"/>`;
    }
    for (let i = 0; i < 6; i++) {
      s += `<line class="g-string" x1="${X + i * SX}" x2="${X + i * SX}" y1="${Y}" y2="${Y + FRETS * SY}"/>`;
    }
    if (base === 1) s += `<rect class="g-nut" x="${X - 1}" y="${Y - 4}" width="${SX * 5 + 2}" height="4"/>`;
    else s += `<text class="g-base" x="${X - 8}" y="${yOf(base) + 4}" text-anchor="end">${base}ª</text>`;
    if (v.barre) {
      const y = yOf(v.barre.fret);
      s += `<rect class="g-barre" x="${X + v.barre.from * SX - 7}" y="${y - 7}" width="${(v.barre.to - v.barre.from) * SX + 14}" height="14" rx="7"/>`;
    }
    v.frets.forEach((f, i) => {
      const x = X + i * SX;
      if (f < 0) s += `<text class="g-mute" x="${x}" y="${Y - 9}" text-anchor="middle">×</text>`;
      else if (f === 0) {
        const root = mod(TUNING[i]) === rootPc;
        s += `<circle class="g-open${root ? ' is-root' : ''}" cx="${x}" cy="${Y - 13}" r="4.5"/>`;
      } else {
        const root = mod(TUNING[i] + f) === rootPc;
        const y = yOf(f);
        s += `<circle class="g-dot${root ? ' is-root' : ''}" cx="${x}" cy="${y}" r="7.5"/>`;
        if (fingers) s += `<text class="g-finger" x="${x}" y="${y + 3.6}" text-anchor="middle">${v.fingers[i]}</text>`;
      }
    });
    return s + '</svg>';
  }

  const BLACK = new Set([1, 3, 6, 8, 10]);
  const WHITE_INDEX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

  // marks: Map midi → { cls, label }
  function piano(start, end, marks, { label = '', height = 76 } = {}) {
    const W = 15;
    const whiteAt = (m) => (Math.floor(m / 12) - Math.floor(start / 12)) * 7 + WHITE_INDEX[mod(m)] - WHITE_INDEX[mod(start)];
    const count = whiteAt(end) + 1;
    const bh = height * .62;
    let whites = '';
    let blacks = '';
    let dots = '';
    for (let m = start; m <= end; m++) {
      const mark = marks.get(m);
      const isBlack = BLACK.has(mod(m));
      const x = isBlack ? (whiteAt(m) + 1) * W : whiteAt(m) * W + W / 2;
      const y = isBlack ? bh - 11 : height - 12;
      if (isBlack) {
        blacks += `<rect class="p-black" x="${x - 5}" y="0" width="10" height="${bh}" rx="1.5"/>`;
      } else {
        whites += `<rect class="p-white" x="${whiteAt(m) * W}" y="0" width="${W}" height="${height}" rx="1.5"/>`;
      }
      if (mark) {
        dots += `<circle class="p-mark ${mark.cls}" cx="${x}" cy="${y}" r="6"/>`;
        if (mark.label) dots += `<text class="p-label" x="${x}" y="${y + 2.6}" text-anchor="middle">${mark.label}</text>`;
      }
    }
    return `<svg class="dg-piano" viewBox="0 0 ${count * W} ${height}" role="img" aria-label="${label}">${whites}${blacks}${dots}</svg>`;
  }

  function pianoRange(midis) {
    const low = Math.min(...midis);
    const high = Math.max(...midis);
    const start = low - mod(low);
    let end = start + 23;
    while (end < high) end += 12;
    return [start, end];
  }

  // Mástil horizontal con la prima arriba. marks: Map pc → { cls, label }
  function fretboard(marks, { frets = 15, label = '' } = {}) {
    const FW = 46, SH = 19, X = 26, Y = 12;
    const w = X + FW * frets + 10;
    const h = Y + SH * 5 + 26;
    let s = `<svg class="dg-neck" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">`;
    for (let f = 0; f <= frets; f++) {
      s += `<line class="${f === 0 ? 'n-nut' : 'n-fret'}" x1="${X + f * FW}" x2="${X + f * FW}" y1="${Y}" y2="${Y + 5 * SH}"/>`;
      if (f > 0 && [3, 5, 7, 9, 12, 15].includes(f)) {
        s += `<text class="n-num" x="${X + (f - .5) * FW}" y="${Y + 5 * SH + 18}" text-anchor="middle">${f}</text>`;
      }
    }
    TUNING.slice().reverse().forEach((open, i) => {
      const y = Y + i * SH;
      s += `<line class="n-string" x1="${X}" x2="${X + frets * FW}" y1="${y}" y2="${y}"/>`;
      for (let f = 0; f <= frets; f++) {
        const mark = marks.get(mod(open + f));
        if (!mark) continue;
        const x = f === 0 ? X - 13 : X + (f - .5) * FW;
        s += `<circle class="p-mark ${mark.cls}" cx="${x}" cy="${y}" r="8.5"/>`;
        s += `<text class="n-label" x="${x}" y="${y + 3}" text-anchor="middle">${mark.label}</text>`;
      }
    });
    return s + '</svg>';
  }

  globalThis.Diagrams = { guitar, piano, pianoRange, fretboard };
})();
