// Líneas de bajo sobre la progresión. Como la melodía, las notas se guardan en
// semitonos desde la tónica (8 corcheas por compás), dos octavas por debajo.
(function () {
  'use strict';
  const { mod } = globalThis.Theory;
  const M = globalThis.Melody;

  const LOW = -32;  // Mi1 con tónica Do (la cuerda grave del bajo)
  const HIGH = -10; // Re3
  const HOME = -22; // zona cómoda para empezar

  // Estilos: qué nota va en cada corchea. R raíz, O octava, 5 quinta, 3 tercera,
  // T nota de paso de la escala, A aproximación cromática a la raíz siguiente.
  const STYLES = {
    whole: { name: ['Redondas', 'Whole notes'], steps: { 0: 'R' } },
    root5: { name: ['Raíz y quinta', 'Root and fifth'], steps: { 0: 'R', 4: '5' } },
    octave: { name: ['Octavas', 'Octaves'], steps: { 0: 'R', 2: 'O', 4: 'R', 6: 'O' } },
    arp: { name: ['Arpegio', 'Arpeggio'], steps: { 0: 'R', 2: '3', 4: '5', 6: 'O' } },
    walking: { name: ['Walking', 'Walking'], steps: { 0: 'R', 2: '3', 4: '5', 6: 'A' } },
    funk: { name: ['Síncopa', 'Syncopated'], steps: { 0: 'R', 3: 'R', 5: '5', 6: 'O', 7: 'R' } },
  };

  // Filas: escala y notas de los acordes, más las que ya use la línea (p. ej. las
  // aproximaciones cromáticas del walking), para que se vean donde suenan.
  function rows(key, chords, used = []) {
    const extra = { pcs: used.filter((o) => o !== null && o !== undefined).map((o) => mod(key.pc + o)) };
    return M.rows(key, [...chords, extra], LOW, HIGH);
  }

  // La nota de clase pc más cercana a `near` dentro del registro.
  function nearest(pc, key, near) {
    let best = null;
    for (let off = LOW; off <= HIGH; off++) {
      if (mod(key.pc + off) !== pc) continue;
      if (best === null || Math.abs(off - near) < Math.abs(best - near)) best = off;
    }
    return best;
  }

  const toneWith = (chord, test) => chord.tones.find((t) => test(t.deg));

  function generate(chords, key, style = 'root5', rand = Math.random) {
    const pattern = (STYLES[style] || STYLES.root5).steps;
    // Raíces encadenadas: cada una cerca de la anterior, con algo de variedad.
    const roots = [];
    chords.forEach((c, i) => {
      const prev = i ? roots[i - 1] : HOME;
      let r = nearest(c.root.pc, key, prev + (rand() < .5 ? -1 : 1));
      if (r + 12 > HIGH && r - 12 >= LOW && r > HOME + 5) r -= 12;
      roots.push(r);
    });
    return chords.map((c, i) => {
      const R = roots[i];
      const next = roots[(i + 1) % roots.length];
      const third = toneWith(c, (d) => /3$/.test(d)) || toneWith(c, (d) => /^[24]$/.test(d));
      const fifth = toneWith(c, (d) => /5$/.test(d));
      const up = (pc) => { const o = nearest(pc, key, R + 5); return o !== null && o >= R ? o : nearest(pc, key, R); };
      const bar = Array(M.STEPS).fill(null);
      let last = R;
      Object.entries(pattern).forEach(([step, what]) => {
        let off;
        if (what === 'R') off = R;
        else if (what === 'O') off = R + 12 <= HIGH ? R + 12 : R - 12 >= LOW ? R - 12 : R;
        else if (what === '5') off = fifth ? up(fifth.pc) : R + 7 <= HIGH ? R + 7 : R - 5;
        else if (what === '3') off = third ? up(third.pc) : R;
        else if (what === 'A') {
          // Semitono por encima o por debajo de la raíz siguiente, el más cercano a la nota anterior.
          const a = next + 1 <= HIGH ? next + 1 : next - 1;
          const b = next - 1 >= LOW ? next - 1 : next + 1;
          off = Math.abs(a - last) < Math.abs(b - last) ? a : b;
        }
        bar[Number(step)] = Math.max(LOW, Math.min(HIGH, off));
        last = bar[Number(step)];
      });
      return bar;
    });
  }

  globalThis.Bass = { LOW, HIGH, STYLES, rows, generate };
})();
