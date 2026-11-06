// Melodía sobre la progresión: qué papel juega cada nota sobre un acorde, qué
// nota conviene después y un generador de ideas. Las notas se guardan como
// semitonos desde la tónica, así que la melodía se transporta con la tonalidad.
(function () {
  'use strict';
  const { mod } = globalThis.Theory;

  const STEPS = 8; // corcheas por compás de 4/4
  const LOW = -5;
  const HIGH = 19;

  // root: fundamental · chord: nota del acorde · tension: de la escala, colorea
  // avoid: de la escala, pero a semitono sobre una nota del acorde · out: ajena.
  function role(pc, chord, key) {
    if (pc === chord.root.pc) return 'root';
    if (chord.pcs.includes(pc)) return 'chord';
    if (!key.pcs.has(pc)) return 'out';
    return chord.pcs.includes(mod(pc - 1)) ? 'avoid' : 'tension';
  }

  // Filas disponibles (agudo → grave): escala más las notas de los acordes usados.
  function rows(key, chords) {
    const pcs = new Set(key.pcs);
    chords.forEach((c) => c.pcs.forEach((pc) => pcs.add(pc)));
    const out = [];
    for (let off = HIGH; off >= LOW; off--) {
      if (pcs.has(mod(key.pc + off))) out.push(off);
    }
    return out;
  }

  const tonicMidi = (key) => 60 + (key.pc > 6 ? key.pc - 12 : key.pc);
  const midiOf = (off, key) => tonicMidi(key) + off;

  function snap(off, list) {
    let best = list[0];
    for (const r of list) if (Math.abs(r - off) < Math.abs(best - off)) best = r;
    return best;
  }

  // Qué tan buena es una nota tras la anterior: predominan el grado conjunto y
  // las notas del acorde; un salto grande pide recuperarse por grado.
  function nextScore(off, prev, chord, key, strong) {
    const r = role(mod(key.pc + off), chord, key);
    const jump = Math.abs(off - prev);
    let s = { root: 3, chord: 3, tension: strong ? .5 : 2, avoid: strong ? -3 : .4, out: -4 }[r];
    if (jump === 0) s -= .5;
    else if (jump <= 2) s += 2.2;
    else if (jump <= 4) s += 1.2;
    else if (jump <= 7) s += .2;
    else s -= 1.5;
    return s;
  }

  function hints(prev, chord, key, list, strong, count = 3) {
    return list
      .map((off) => ({ off, s: nextScore(off, prev, chord, key, strong) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, count)
      .map((x) => x.off);
  }

  // Generador pseudoaleatorio con semilla: cada clic da una idea reproducible.
  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  const MOTIFS = [
    [0, 2, 4, 6], [0, 3, 4, 6], [0, 2, 3, 4], [0, 4, 6], [0, 3, 6],
    [0, 1, 2, 4], [0, 2, 4], [0, 4, 5, 6], [0, 3, 4],
  ];
  const ENDINGS = [[0], [0, 4], [0, 2, 4]];

  // Dos motivos rítmicos alternados dan cohesión; la línea dibuja un arco que
  // se apoya en notas del acorde en los tiempos fuertes (pasos 0 y 4).
  function generate(chords, key, rand = Math.random) {
    const list = rows(key, chords);
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const motifA = pick(MOTIFS);
    const motifB = pick(MOTIFS);
    const center = 5 + Math.floor(rand() * 3);
    const span = 3 + Math.floor(rand() * 5);
    const n = chords.length;

    const chordRows = (c) => list.filter((off) => {
      const r = role(mod(key.pc + off), c, key);
      return r === 'root' || r === 'chord';
    });

    let cur = null;
    return chords.map((chord, i) => {
      const last = i === n - 1;
      const motif = last ? pick(ENDINGS) : (i % 2 ? motifB : motifA);
      const bar = Array(STEPS).fill(null);
      const safe = chordRows(chord);

      motif.forEach((step, j) => {
        const t = (i + step / STEPS) / n;
        const target = center + span * Math.sin(Math.PI * t) - (last ? 3 : 0);
        const strong = step % 4 === 0;
        const pool = strong ? safe : list.filter((off) => !['avoid', 'out'].includes(role(mod(key.pc + off), chord, key)));
        const ending = last && j === motif.length - 1;

        let choice;
        if (ending) {
          const tonic = safe.filter((off) => mod(off) === 0);
          const roots = safe.filter((off) => mod(key.pc + off) === chord.root.pc);
          const ref = cur === null ? target : cur;
          choice = snap(ref, tonic.length ? tonic : roots.length ? roots : safe);
        } else {
          const scored = pool.map((off) => ({
            off,
            s: (cur === null ? 0 : nextScore(off, cur, chord, key, strong)) - Math.abs(off - target) * .45 + rand() * 1.4,
          }));
          scored.sort((a, b) => b.s - a.s);
          choice = scored[0].off;
        }
        bar[step] = choice;
        cur = choice;
      });
      return bar;
    });
  }

  // Golpes de acorde dentro del compás (en corcheas).
  const COMP = {
    whole: { name: 'Redonda', hits: [0] },
    quarters: { name: 'Negras', hits: [0, 2, 4, 6] },
    charleston: { name: 'Charlestón', hits: [0, 3] },
    eighths: { name: 'Corcheas', hits: [0, 1, 2, 3, 4, 5, 6, 7] },
  };

  // Swing en % del pulso que ocupa la primera corchea: 50 es recto, 67 es tresillo.
  // Solo se retrasan las corcheas a contratiempo; la parte fuerte no se mueve.
  const swingShift = (step, swing, stepMs) => (step % 2 ? (swing / 100 - .5) * 2 * stepMs : 0);

  // Duración real entre dos pasos del compás, teniendo en cuenta el swing.
  const spanMs = (from, to, swing, stepMs) =>
    (to - from) * stepMs + swingShift(to, swing, stepMs) - swingShift(from, swing, stepMs);

  globalThis.Melody = { COMP, swingShift, spanMs, STEPS, role, rows, snap, midiOf, tonicMidi, hints, generate, seeded };
})();
