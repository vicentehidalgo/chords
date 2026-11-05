// Generación de digitaciones de guitarra y posiciones de piano.
(function () {
  'use strict';
  const { mod } = globalThis.Theory;

  const TUNING = [40, 45, 50, 55, 59, 64]; // Mi grave → Mi agudo
  const MAX_FRET = 14;
  const cache = new Map();

  function fingering(frets) {
    const fretted = frets.map((f, s) => ({ f, s })).filter((x) => x.f > 0);
    if (!fretted.length) return { count: 0, fingers: frets.map(() => 0), barre: null };
    const min = Math.min(...fretted.map((x) => x.f));
    const atMin = fretted.filter((x) => x.f === min);
    const first = atMin[0].s;
    const last = atMin[atMin.length - 1].s;

    let barre = null;
    if (atMin.length >= 2 && (atMin.length >= 3 || last - first >= 3)) {
      let clean = true;
      for (let s = first; s <= last; s++) if (frets[s] < min) clean = false;
      if (clean) barre = { fret: min, from: first, to: last };
    }

    const fingers = frets.map(() => 0);
    let finger = 1;
    if (barre) {
      atMin.forEach((x) => { fingers[x.s] = 1; });
      finger = 2;
    }
    const rest = fretted
      .filter((x) => !fingers[x.s])
      .sort((a, b) => a.f - b.f || a.s - b.s);
    for (const x of rest) fingers[x.s] = finger++;
    return { count: finger - 1, fingers, barre };
  }

  function evaluate(frets, chord) {
    const sounded = frets.map((f, s) => ({ f, s, midi: f < 0 ? 0 : TUNING[s] + f })).filter((x) => x.f >= 0);
    if (sounded.length < 4) return null;
    if (mod(sounded[0].midi) !== chord.root.pc) return null;
    const firstS = sounded[0].s;
    const lastS = sounded[sounded.length - 1].s;
    if (firstS > 2 || lastS < 4) return null;

    const pcs = sounded.map((x) => mod(x.midi));
    if (!chord.required.every((pc) => pcs.includes(pc))) return null;

    const fretted = sounded.filter((x) => x.f > 0).map((x) => x.f);
    const inner = lastS - firstS + 1 - sounded.length;
    if (inner > 1) return null;

    const min = fretted.length ? Math.min(...fretted) : 0;
    const max = fretted.length ? Math.max(...fretted) : 0;
    const span = max - min;
    if (span > 3) return null;

    const hand = fingering(frets);
    if (hand.count > 4) return null;

    const opens = sounded.length - fretted.length;
    const third = chord.tones.find((t) => /3$/.test(t.deg));
    const thirds = third ? pcs.filter((pc) => pc === third.pc).length : 0;
    const missing = chord.pcs.filter((pc) => !pcs.includes(pc)).length;

    let cost = 0;
    cost += (opens ? 0 : min) * .55;
    cost += span * .5;
    cost += hand.count * .35;
    cost += hand.barre ? 1.6 : 0;
    cost += (6 - sounded.length) * .55;
    cost += inner * 2.5;
    cost += firstS * .2;
    cost += Math.max(0, thirds - 1) * .4;
    cost += missing * .4;
    cost -= opens * .8;
    if (opens && max > 5) cost += 3;
    if (lastS < 5) cost += 1.5; // dejar muda la prima es incómodo
    // Cuerda al aire justo encima de un bajo pisado y con otra pisada detrás: mano forzada.
    if (frets[1] === 0 && frets[0] > 0 && frets[2] > 0) cost += 2;

    return {
      frets: frets.slice(),
      midis: sounded.map((x) => x.midi),
      fingers: hand.fingers,
      barre: hand.barre,
      score: cost,
      center: fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : 0,
    };
  }

  function guitarVoicings(chord) {
    const id = 'g' + chord.id;
    if (cache.has(id)) return cache.get(id);
    const allowed = new Set(chord.pcs);
    const found = new Map();

    for (let base = 1; base <= MAX_FRET - 3; base++) {
      const options = TUNING.map((open) => {
        const list = [-1];
        if (allowed.has(mod(open)) && base <= 5) list.push(0);
        for (let f = base; f <= base + 3; f++) if (allowed.has(mod(open + f))) list.push(f);
        return list;
      });
      const frets = [0, 0, 0, 0, 0, 0];
      const walk = (s) => {
        if (s === 6) {
          const key = frets.join(',');
          if (!found.has(key)) {
            const v = evaluate(frets, chord);
            if (v) found.set(key, v);
          }
          return;
        }
        for (const f of options[s]) { frets[s] = f; walk(s + 1); }
      };
      walk(0);
    }

    const sorted = [...found.values()].sort((a, b) => a.score - b.score);
    // Se conserva variedad: como mucho tres digitaciones por zona del mástil.
    const zones = new Map();
    const result = [];
    for (const v of sorted) {
      const zone = Math.floor(v.center / 3);
      const n = zones.get(zone) || 0;
      if (n >= 3) continue;
      zones.set(zone, n + 1);
      result.push(v);
      if (result.length >= 10) break;
    }
    cache.set(id, result);
    return result;
  }

  // Elige la digitación que menos desplaza la mano respecto a la anterior.
  function pickGuitar(chord, previous) {
    const list = guitarVoicings(chord);
    if (!previous || !list.length) return 0;
    let best = 0;
    let bestCost = Infinity;
    list.forEach((v, i) => {
      const jump = previous.center && v.center ? Math.abs(previous.center - v.center) : 0;
      const cost = v.score + jump * .9;
      if (cost < bestCost) { bestCost = cost; best = i; }
    });
    return best;
  }

  // Piano: todas las inversiones cerradas en el registro central.
  function pianoVoicings(chord) {
    const id = 'p' + chord.id;
    if (cache.has(id)) return cache.get(id);
    const n = chord.tones.length;
    const rootMidi = 48 + mod(chord.root.pc - 48 + 12) + (chord.root.pc < 4 ? 12 : 0);
    const stack = chord.tones.map((t) => rootMidi + t.semi);
    const result = [];
    for (let inv = 0; inv < n; inv++) {
      const midis = stack.map((m, i) => (i < inv ? m + 12 : m)).sort((a, b) => a - b);
      for (const shift of [0, -12]) {
        const v = midis.map((m) => m + shift);
        if (v[0] >= 48 && v[v.length - 1] <= 84) result.push({ midis: v, inversion: inv });
      }
    }
    cache.set(id, result);
    return result;
  }

  function pickPiano(chord, previous) {
    const list = pianoVoicings(chord);
    if (!previous || !list.length) return 0;
    let best = 0;
    let bestCost = Infinity;
    list.forEach((v, i) => {
      const a = v.midis;
      const b = previous.midis;
      let cost = 0;
      const n = Math.max(a.length, b.length);
      for (let k = 0; k < n; k++) {
        const x = a[Math.round(k * (a.length - 1) / (n - 1))];
        const y = b[Math.round(k * (b.length - 1) / (n - 1))];
        cost += Math.abs(x - y);
      }
      if (cost < bestCost) { bestCost = cost; best = i; }
    });
    return best;
  }

  globalThis.Voicings = { TUNING, guitarVoicings, pickGuitar, pianoVoicings, pickPiano };
})();
