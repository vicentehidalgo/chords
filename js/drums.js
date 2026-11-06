// Percusión: anillos que dan una vuelta por compás. Cada anillo divide la vuelta
// en sus propios pasos, de modo que 5 contra 4 es una polirritmia de verdad.
(function () {
  'use strict';

  // midi: mapa de percusión General MIDI. family: color del anillo.
  const INSTRUMENTS = {
    kick: { name: 'Bombo', midi: 36, family: 'low' },
    tom: { name: 'Tom', midi: 45, family: 'low' },
    snare: { name: 'Caja', midi: 38, family: 'mid' },
    clap: { name: 'Palmas', midi: 39, family: 'mid' },
    rim: { name: 'Aro', midi: 37, family: 'mid' },
    hat: { name: 'Charles', midi: 42, family: 'metal' },
    openhat: { name: 'Charles abierto', midi: 46, family: 'metal' },
    shaker: { name: 'Maraca', midi: 70, family: 'metal' },
    cowbell: { name: 'Cencerro', midi: 56, family: 'wood' },
    clave: { name: 'Clave', midi: 75, family: 'wood' },
  };

  const GATES = {
    free: 'Libre',
    melody: 'Con la melodía',
    gaps: 'En sus huecos',
    chords: 'Con los acordes',
  };

  const MAX_RINGS = 6;
  const MAX_STEPS = 24;

  // Reparte k golpes lo más uniformemente posible entre n pasos.
  function euclid(k, n) {
    return Array.from({ length: n }, (_, i) => ((i * k) % n < k && k > 0 ? 1 : 0));
  }

  const rotate = (steps, by) => {
    const n = steps.length;
    return steps.map((_, i) => steps[((i - by) % n + n) % n]);
  };

  const fromText = (s) => [...s].map((c) => (c === 'x' ? 1 : 0));

  // Ritmos tradicionales que son repartos euclídeos (Toussaint, 2005).
  const NECKLACES = {
    '3:8': 'Tresillo cubano',
    '5:8': 'Cinquillo cubano',
    '5:16': 'Bossa nova',
    '7:16': 'Samba brasileña',
    '9:16': 'África central y Brasil',
    '7:12': 'Campana de África occidental',
    '5:12': 'Palmas venda, Sudáfrica',
    '4:9': 'Pigmeos aka',
    '2:5': 'Khafif-e-ramal persa',
    '3:7': 'Ruchenitza búlgara',
    '5:9': 'Agsag-samai árabe',
    '5:7': 'Nawakhat árabe',
    '3:4': 'Cumbia y calipso',
    '5:6': 'Samai yorubá',
    '4:11': 'Outside Now, Frank Zappa',
    '5:11': 'Cuadros de una exposición',
  };

  function necklaceName(steps) {
    const k = steps.reduce((a, b) => a + b, 0);
    const name = NECKLACES[k + ':' + steps.length];
    if (!name) return null;
    const target = euclid(k, steps.length).join('');
    for (let r = 0; r < steps.length; r++) {
      if (rotate(steps, r).join('') === target) return name;
    }
    return null;
  }

  const ring = (inst, text, gate = 'free') => ({ inst, steps: fromText(text), gate, muted: false });

  const PRESETS = [
    { name: 'Rock', rings: [['kick', 'x.......x.x.....'], ['snare', '....x.......x...'], ['hat', 'x.x.x.x.x.x.x.x.']] },
    { name: 'Funk', rings: [['kick', 'x..x..x...x..x..'], ['snare', '....x..x.x..x...'], ['hat', 'xxxxxxxxxxxxxxxx'], ['openhat', '..............x.']] },
    { name: 'Swing de jazz', rings: [['openhat', 'x..x.xx..x.x'], ['hat', '...x.....x..'], ['kick', 'x..x..x..x..'], ['rim', '.....x....x.']] },
    { name: 'Bossa nova', rings: [['kick', 'x..xx..xx..xx..x'], ['rim', 'x..x..x...x..x..'], ['hat', 'x.x.x.x.x.x.x.x.']] },
    { name: 'Son cubano', rings: [['clave', 'x..x..x...x.x...'], ['cowbell', 'x.x.x.x.'], ['kick', '...x..x....x..x.'], ['shaker', 'x.x.x.x.x.x.x.x.']] },
    { name: 'Dembow', rings: [['kick', 'x...x...x...x...'], ['snare', '...x..x....x..x.'], ['hat', 'x.x.x.x.x.x.x.x.']] },
    { name: 'Bembé en 12', rings: [['cowbell', 'x.x.xx.x.x.x'], ['shaker', 'x..x..x..x..'], ['kick', 'x...x...x...x...'], ['clap', '..x..x..x..x']] },
    { name: 'Bulería', rings: [['clap', '..x..x.x.x.x'], ['kick', 'x.....x.....'], ['rim', 'xxxxxxxxxxxx'], ['hat', 'x..x..x..x..']] },
    { name: '3 contra 4', rings: [['kick', 'x..'], ['snare', 'x...'], ['hat', 'xxxxxxxxxxxx']] },
    { name: '5 contra 4', rings: [['clave', 'xxxxx'], ['kick', 'x.x.'], ['snare', '.x.x'], ['hat', 'xxxxxxxxxxxxxxxxxxxx']] },
    { name: 'Geometría prima', rings: [['kick', 'x..x..x.'], ['clave', 'x.x.x.x'], ['rim', 'x.x.x.x.x.x'], ['hat', 'x.xx.x.xx.x.x']] },
  ];

  const presetRings = (p) => p.rings.map(([inst, text]) => ring(inst, text));

  // Compone un patrón nuevo: pulso reconocible abajo y polirritmia encima.
  function invent(rand) {
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const kick = euclid(pick([3, 4, 5]), 16);
    const snare = rand() < .6 ? fromText('....x.......x...') : rotate(euclid(3, 16), 4);
    const hat = rotate(euclid(pick([7, 9, 11, 13]), 16), Math.floor(rand() * 16));
    const n = pick([5, 7, 9, 11, 12]);
    const perc = rotate(euclid(Math.ceil(n / 2), n), Math.floor(rand() * n));
    const shape = (inst, steps, gate = 'free') => ({ inst, steps, gate, muted: false });
    return [
      shape('kick', kick),
      shape('snare', snare),
      shape(pick(['hat', 'shaker']), hat),
      shape(pick(['clave', 'cowbell', 'rim']), perc, pick(['free', 'gaps'])),
    ];
  }

  // Un cambio pequeño: mover un golpe o girar un anillo.
  function mutate(rings, rand) {
    if (!rings.length) return rings;
    const r = rings[Math.floor(rand() * rings.length)];
    const hits = r.steps.flatMap((v, i) => (v ? [i] : []));
    if (!hits.length || rand() < .3) {
      r.steps = rotate(r.steps, 1);
      return rings;
    }
    const from = hits[Math.floor(rand() * hits.length)];
    const to = ((from + (rand() < .5 ? 1 : -1)) % r.steps.length + r.steps.length) % r.steps.length;
    if (!r.steps[to]) { r.steps[from] = 0; r.steps[to] = 1; }
    return rings;
  }

  // Distancia en corcheas al ataque más cercano: tolera subdivisiones distintas.
  const near = (pos, onsets) => onsets.some((s) => Math.abs(pos * 8 - s) < .26);

  function passesGate(gate, pos, ctx) {
    if (gate === 'melody') return near(pos, ctx.melody);
    if (gate === 'gaps') return !near(pos, ctx.melody);
    if (gate === 'chords') return near(pos, ctx.chordHits);
    return true;
  }

  // Golpes de un compás. pos: 0 a 1 dentro del compás.
  // ctx: { life (0-1), rand, melody: pasos con nota, chordHits: pasos con acorde }
  function barHits(rings, ctx) {
    const out = [];
    rings.forEach((r, ringIndex) => {
      if (r.muted) return;
      const n = r.steps.length;
      r.steps.forEach((on, step) => {
        const pos = step / n;
        const beat = (pos * 4) % 1 === 0;
        const push = (velocity) => out.push({ pos, ringIndex, step, inst: r.inst, velocity });
        if (on) {
          if (!passesGate(r.gate, pos, ctx)) return;
          if (!beat && ctx.rand() < ctx.life * .22) return; // respira: omite un golpe débil
          const accent = pos === 0 ? 118 : beat ? 104 : 86;
          push(Math.round(accent - ctx.rand() * ctx.life * 18));
        } else if (r.gate === 'free' && n >= 8 && !beat && ctx.rand() < ctx.life * .1) {
          push(38); // golpe fantasma
        }
      });
    });
    return out.sort((a, b) => a.pos - b.pos);
  }

  // Aplica el swing a una posición del compás: la corchea central de cada negra
  // se retrasa y lo que hay alrededor se estira o comprime a la par.
  function swungPos(pos, swing) {
    const s = swing / 100;
    const q = pos * 4;
    const beat = Math.floor(q);
    const f = q - beat;
    const warped = f < .5 ? f * 2 * s : s + (f - .5) * 2 * (1 - s);
    return (beat + warped) / 4;
  }

  globalThis.Drums = {
    INSTRUMENTS, GATES, PRESETS, MAX_RINGS, MAX_STEPS,
    euclid, rotate, necklaceName, presetRings, invent, mutate, barHits, swungPos,
  };
})();
