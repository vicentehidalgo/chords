// Dibujos SVG: diagrama de acorde, teclado y mástil. Los colores salen de CSS.
(function () {
  'use strict';
  const { mod } = globalThis.Theory;
  const { TUNING } = globalThis.Voicings;

  function guitar(v, rootPc, { fingers = true, label = '' } = {}) {
    if (!v) return `<div class="nodiagram">${globalThis.I18n ? I18n.tx('Sin digitación cómoda', 'No comfortable fingering') : 'Sin digitación cómoda'}</div>`;
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

  // Rueda de ritmos: un anillo por instrumento, con la primera posición arriba.
  function wheel(rings, families) {
    const SIZE = 440;
    const C = SIZE / 2;
    const OUTER = 204;
    const GAP = 30;
    const point = (radius, step, n) => {
      const a = (step / n) * 2 * Math.PI - Math.PI / 2;
      return [(C + radius * Math.cos(a)).toFixed(1), (C + radius * Math.sin(a)).toFixed(1)];
    };
    let s = `<svg class="dg-wheel" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${globalThis.I18n ? I18n.tx('Rueda de ritmos', 'Rhythm wheel') : 'Rueda de ritmos'}">`;
    for (let b = 0; b < 4; b++) {
      const [x, y] = point(OUTER + 12, b, 4);
      s += `<line class="w-beat" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/>`;
      const [tx, ty] = point(OUTER + 12, b + .17, 4);
      s += `<text class="w-num" x="${tx}" y="${ty}" text-anchor="middle">${b + 1}</text>`;
    }
    rings.forEach((r, i) => {
      const radius = OUTER - i * GAP;
      const n = r.steps.length;
      const fam = 'fam-' + families[i];
      const pts = r.steps.flatMap((on, step) => (on ? [point(radius, step, n).join(',')] : []));
      s += `<g class="w-ring ${fam} ${r.muted ? 'is-muted' : ''}">`;
      s += `<circle class="w-track" cx="${C}" cy="${C}" r="${radius}"/>`;
      if (pts.length >= 2) s += `<polygon class="w-shape" points="${pts.join(' ')}"/>`;
      r.steps.forEach((on, step) => {
        const [x, y] = point(radius, step, n);
        s += `<circle class="w-dot ${on ? 'on' : ''}" data-dot="${i}:${step}" cx="${x}" cy="${y}" r="${on ? 8 : 5}"/>`;
      });
      s += '</g>';
    });
    return s + `<line class="w-hand" x1="${C}" y1="${C}" x2="${C}" y2="${C - OUTER - 14}" hidden/></svg>`;
  }

  globalThis.Diagrams = { guitar, piano, pianoRange, wheel };
})();
