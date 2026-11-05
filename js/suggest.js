// Motor de sugerencias: dado lo que ya suena, puntúa cada acorde candidato y
// explica por qué encaja. La puntuación mezcla cuatro criterios:
//   función armónica · movimiento del bajo · conducción de voces · color del modo
// y suma bonificaciones por resoluciones claras y progresiones conocidas.
(function () {
  'use strict';
  const { mod, noteName, chordFromRoman } = globalThis.Theory;

  // Progresiones habituales por escala (también alimentan el motor: si lo que
  // llevas coincide con su inicio, el acorde que la continúa sube en la lista).
  const PRESETS = {
    ionian: [
      ['Pop canónico', 'I V vi IV'],
      ['Pop desde el relativo', 'vi IV I V'],
      ['Doo-wop', 'I vi IV V'],
      ['Rock clásico', 'I IV V IV'],
      ['II–V–I de jazz', 'ii7 V7 Imaj7'],
      ['Turnaround', 'Imaj7 vi7 ii7 V7'],
      ['Canon', 'I V vi iii IV I IV V'],
      ['Royal Road', 'IVmaj7 V7 iii7 vi'],
    ],
    aeolian: [
      ['Épica menor', 'i bVI bIII bVII'],
      ['Balada menor', 'i iv bVII bIII'],
      ['Descenso eólico', 'i bVII bVI bVII'],
      ['Menor modal', 'i iv v i'],
      ['Ciclo menor', 'iv bVII bIII bVI'],
    ],
    harmonic: [
      ['Cadencia menor', 'i iv V7 i'],
      ['Cadencia andaluza', 'i bVII bVI V'],
      ['Menor con vi', 'i bVI iv V'],
      ['II–V–I menor', 'iiø7 V7 i'],
    ],
    melodic: [
      ['Menor luminosa', 'i IV7 V7 i'],
      ['Dominante menor', 'i ii V7 i'],
    ],
    dorian: [
      ['Vamp dórico', 'i7 IV7'],
      ['Dórico rock', 'i bVII IV i'],
      ['Subida dórica', 'i ii bIII IV'],
      ['Dórico soul', 'i7 ii7 bIII IV'],
    ],
    phrygian: [
      ['Vamp frigio', 'i bII'],
      ['Frigio ibérico', 'i bII bIII bII'],
      ['Frigio oscuro', 'i bvii bII i'],
    ],
    lydian: [
      ['Vamp lidio', 'I II'],
      ['Lidio flotante', 'I II vii I'],
      ['Lidio cinematográfico', 'I II iii II'],
    ],
    mixolydian: [
      ['Rock mixolidio', 'I bVII IV I'],
      ['Vamp mixolidio', 'I bVII'],
      ['Mixolidio folk', 'I IV bVII IV'],
      ['Mixolidio con v', 'I v bVII IV'],
    ],
    locrian: [
      ['Vamp locrio', 'i° bII'],
      ['Locrio inquieto', 'i° bII bvii i°'],
    ],
    phrygiandom: [
      ['Vamp flamenco', 'I bII I'],
      ['Flamenco', 'iv bII I'],
    ],
    lydiandom: [
      ['Vamp lidio dominante', 'I7 II7'],
    ],
    mixolydianb6: [
      ['Mixolidio ♭6', 'I iv bVI bVII'],
    ],
    harmonicmajor: [
      ['Mayor con iv', 'I iv I V'],
      ['Subdominante menor', 'I bVI iv V'],
    ],
  };

  const presetsFor = (key) => (PRESETS[key.scale.id] || []).map(([name, tokens]) => ({
    name,
    tokens,
    chords: tokens.split(' ').map((t) => chordFromRoman(t, key)),
  }));

  // Encadenamiento clásico entre grados, de 0 a 1. Fila: origen; columna: destino.
  const FUNCTION = [
    //  I    ii   iii  IV   V    vi   vii
    [.30, .60, .35, .85, .85, .70, .35], // I
    [.40, .30, .20, .35, .95, .30, .55], // ii
    [.30, .30, .30, .65, .40, .80, .20], // iii
    [.65, .60, .25, .30, .90, .30, .50], // IV
    [.95, .15, .20, .45, .30, .75, .25], // V
    [.35, .85, .30, .80, .65, .30, .20], // vi
    [.85, .15, .50, .20, .40, .45, .30], // vii sensible
  ];
  // El VII a un tono de la tónica (♭VII) se comporta de otra manera.
  const SUBTONIC_FROM = [.75, .25, .75, .50, .40, .65, .30];
  const SUBTONIC_TO = [.70, .25, .50, .65, .40, .70, .30];

  const ROOT_MOTION = {
    0: [.25, null],
    1: [.45, 'Bajo sube un semitono'],
    2: [.70, 'Bajo sube por grado conjunto'],
    3: [.50, 'Bajo sube una tercera'],
    4: [.50, 'Bajo sube una tercera'],
    5: [1.0, 'Bajo baja una quinta'],
    6: [.25, null],
    7: [.60, 'Bajo sube una quinta'],
    8: [.70, 'Bajo baja una tercera'],
    9: [.70, 'Bajo baja una tercera'],
    10: [.50, 'Bajo baja por grado conjunto'],
    11: [.45, 'Bajo baja un semitono'],
  };

  const WEIGHTS = {
    tonal: { fn: .42, root: .25, voice: .18, mode: .15 },
    modal: { fn: .24, root: .14, voice: .20, mode: .42 },
  };

  const dist = (a, b) => {
    const d = mod(a - b);
    return Math.min(d, 12 - d);
  };

  const hasLeadingTone = (c, key) => c.pcs.includes(mod(key.pc + 11));
  const isSubtonic = (c) => c.degree === 7 && c.interval === 10;

  // Tiene tritono entre 3ª y 7ª (o es un disminuido sobre la sensible).
  function dominantTones(c) {
    const third = c.tones.find((t) => t.deg === '3');
    const seventh = c.tones.find((t) => t.deg === 'b7');
    return third && seventh ? { third, seventh } : null;
  }

  function scoreFunction(a, b, key) {
    let v = FUNCTION[a.degree - 1][b.degree - 1];
    if (isSubtonic(a)) v = SUBTONIC_FROM[b.degree - 1];
    if (isSubtonic(b)) v = Math.max(v, SUBTONIC_TO[a.degree - 1]);
    if (a.degree === 5 && b.degree === 1 && !hasLeadingTone(a, key)) v *= .65;
    if (a.degree === 2 && a.interval === 1 && b.interval === 0) v = .8;
    return v;
  }

  function functionReason(a, b, key) {
    const leading = hasLeadingTone(a, key);
    if (b.interval === 0) {
      if (a.interval === 7 && leading) return 'Cadencia perfecta: dominante a tónica';
      if (a.interval === 11) return 'La sensible resuelve en la tónica';
      if (a.interval === 5) return 'Cadencia plagal';
      if (a.interval === 1) return 'Cadencia frigia: ♭II a tónica';
      if (a.interval === 10) return 'Cadencia modal: ♭VII a tónica';
    }
    if (a.interval === 7 && leading) {
      if (b.degree === 6) return 'Cadencia rota: evita la tónica';
      if (b.degree === 4) return 'Retroceso suave a la subdominante';
    }
    if (a.degree === 2 && b.interval === 7) return 'Predominante prepara la dominante';
    if (a.degree === 4 && b.interval === 7) return 'Subdominante prepara la dominante';
    if (a.interval === 0 && b.interval === 7) return 'Semicadencia: abre tensión';
    if (a.interval === 0 && b.degree === 4) return 'Sale de la tónica a la subdominante';
    if (a.degree === 6 && (b.degree === 2 || b.degree === 4)) return 'Avanza hacia la subdominante';
    if (a.fn === 'T' && b.fn === 'T' && a.interval !== b.interval) return 'Prolonga la tónica con otro color';
    return null;
  }

  function scoreVoices(a, b) {
    const common = a.tones.filter((t) => b.pcs.includes(t.pc));
    const moves = a.pcs.map((pc) => Math.min(...b.pcs.map((q) => dist(pc, q))));
    const mean = moves.reduce((s, x) => s + x, 0) / moves.length;
    return { common, mean, value: Math.max(0, Math.min(1, 1.1 - mean / 2.2)) };
  }

  function scoreMode(a, b, key) {
    const charA = a.pcs.some((pc) => key.charPcs.has(pc));
    const charB = b.pcs.some((pc) => key.charPcs.has(pc));
    if (charA && b.interval === 0) return 1;
    if (key.charPcs.has(b.root.pc)) return 1; // construido sobre la nota característica
    if (charB) return a.interval === 0 ? .8 : .65;
    return .35;
  }

  // Compara por grado sin distinguir 7ªs: ii7 cuenta como ii.
  const sameDegree = (x, y) => x.romanBase === y.romanBase;

  function presetContinuation(history, candidate, presets) {
    let best = null;
    for (const p of presets) {
      const seq = p.chords;
      for (let end = 1; end < seq.length; end++) {
        if (!sameDegree(seq[end], candidate)) continue;
        let n = 0;
        while (n < end && n < history.length &&
          sameDegree(seq[end - 1 - n], history[history.length - 1 - n])) n++;
        if (n >= 2 && (!best || n > best.n)) best = { n, preset: p };
      }
    }
    return best;
  }

  function scoreTransition(a, b, key, notation) {
    const w = key.scale.tonal ? WEIGHTS.tonal : WEIGHTS.modal;
    const reasons = [];
    const name = (n) => noteName(n, notation);

    const fn = scoreFunction(a, b, key);
    const fnText = functionReason(a, b, key);
    const [root, rootText] = ROOT_MOTION[mod(b.root.pc - a.root.pc)];
    const voice = scoreVoices(a, b);
    const mode = scoreMode(a, b, key);

    let score = 100 * (w.fn * fn + w.root * root + w.voice * voice.value + w.mode * mode);

    if (fnText) reasons.push({ text: fnText, kind: 'fn' });

    const dom = dominantTones(a);
    const delta = mod(b.root.pc - a.root.pc);
    if (a.origin.kind === 'secondary' && b.root.pc === a.origin.targetPc) {
      score += 22;
      reasons.unshift({ text: `Resuelve su dominante secundaria (${a.roman})`, kind: 'res' });
    } else if (a.origin.kind === 'tritone' && b.root.pc === a.origin.targetPc) {
      score += 22;
      reasons.unshift({ text: 'El sustituto de tritono resuelve bajando un semitono', kind: 'res' });
    } else if (dom && delta === 5) {
      score += 14;
      const up = b.tones.find((t) => t.pc === mod(dom.third.pc + 1));
      const down = b.tones.find((t) => dist(t.pc, dom.seventh.pc) === 1 && mod(dom.seventh.pc - t.pc) === 1) ||
        b.tones.find((t) => t.pc === mod(dom.seventh.pc - 2));
      if (up && down) {
        reasons.unshift({
          text: `Tritono resuelto: ${name(dom.third)}→${name(up)}, ${name(dom.seventh)}→${name(down)}`,
          kind: 'res',
        });
      }
    } else if (dom && delta === 11) {
      score += 6;
      reasons.push({ text: 'Tritono compartido: resolución cromática', kind: 'res' });
    }

    if (!key.scale.tonal) {
      const charA = a.pcs.some((pc) => key.charPcs.has(pc));
      const charB = b.pcs.find((pc) => key.charPcs.has(pc));
      if (charA && b.interval === 0) {
        reasons.push({ text: 'Vuelve a la tónica desde la nota característica', kind: 'mode' });
      } else if (charB !== undefined && b.origin.kind === 'scale') {
        const t = b.tones.find((x) => x.pc === charB);
        reasons.push({ text: `Lleva ${name(t)}, la nota que define el ${key.scale.name.toLowerCase()}`, kind: 'mode' });
      }
    }

    if (voice.common.length >= 2) {
      reasons.push({
        text: `Notas comunes: ${voice.common.map(name).join(', ')}`,
        kind: 'voice',
      });
    } else if (voice.mean <= 1.2) {
      reasons.push({ text: 'Las voces se mueven muy poco', kind: 'voice' });
    } else if (voice.common.length === 1) {
      reasons.push({ text: `Nota común: ${name(voice.common[0])}`, kind: 'voice' });
    }

    if (rootText && root >= .7) reasons.push({ text: rootText, kind: 'root' });
    return { score, reasons };
  }

  function scoreStart(c, key) {
    if (c.interval === 0) return { score: 96, reasons: [{ text: 'Empieza en la tónica', kind: 'fn' }] };
    const byFn = { T: 62, S: 56, D: 42, M: 50 }[c.fn];
    const text = { T: 'Comienzo con color de tónica', S: 'Comienzo en suspenso', D: 'Comienzo con tensión', M: 'Comienzo modal' }[c.fn];
    return { score: byFn, reasons: [{ text, kind: 'fn' }] };
  }

  const ORIGIN_LABEL = {
    secondary: 'Dominante secundaria',
    tritone: 'Sustituto de tritono',
  };

  function originLabel(c) {
    if (c.origin.kind === 'borrowed') return 'Prestado del ' + c.origin.from.replace(/ \(.*/, '').toLowerCase();
    return ORIGIN_LABEL[c.origin.kind] || null;
  }

  // history: acordes hasta el actual. next: acorde que sigue, si se inserta en medio.
  function suggest({ key, candidates, history, next, notation }) {
    const current = history[history.length - 1] || null;
    const before = history[history.length - 2] || null;
    const presets = presetsFor(key);

    const ranked = [];
    for (const c of candidates) {
      if (current && c.id === current.id) continue;
      let result = current ? scoreTransition(current, c, key, notation) : scoreStart(c, key);
      let { score, reasons } = result;

      if (c.origin.kind !== 'scale') score -= c.origin.kind === 'borrowed' ? 10 : 8;
      if (before && c.id === before.id) score -= 5;
      // Los modos viven de tríadas estables: dim y aug suenan a accidente, no a color.
      if (!key.scale.tonal && key.heptatonic && ['dim', 'aug', 'm7b5', 'dim7'].includes(c.q.id)) score -= 16;

      else if (key.scale.tonal && ['dim', 'aug'].includes(c.q.id) && c.interval !== 11) score -= 8;

      const follow = c.origin.kind === 'scale' ? presetContinuation(history, c, presets) : null;
      if (follow) {
        score += 6 * follow.n;
        reasons = [{ text: `Sigue la progresión «${follow.preset.name}»`, kind: 'res' }, ...reasons];
      }
      if (next && next.id !== c.id) {
        const link = scoreTransition(c, next, key, notation);
        score = .7 * score + .3 * link.score;
      }
      if (!reasons.length) reasons = [{ text: 'Cambio de color, sin resolución marcada', kind: 'root' }];
      ranked.push({ chord: c, score: Math.max(1, Math.min(99, Math.round(score))), reasons });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  globalThis.Suggest = { suggest, presetsFor, originLabel };
})();
