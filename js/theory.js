// Teoría musical: escalas, acordes, ortografía enarmónica y grados romanos.
// Todo se define con fórmulas ("1 b3 5"), que guardan tanto los semitonos como
// la letra de cada nota: así Si♭ y La♯ nunca se confunden al escribirlas.
(function () {
  'use strict';

  const LETTERS = 'CDEFGAB';
  const SOLFEGE = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
  const NATURAL = [0, 2, 4, 5, 7, 9, 11];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  const mod = (n, m = 12) => ((n % m) + m) % m;

  function parseDegree(token) {
    const m = /^(b*|#*)(\d+)$/.exec(token);
    if (!m) throw new Error('Grado inválido: ' + token);
    const off = Number(m[2]) - 1;
    const acc = m[1].length * (m[1][0] === 'b' ? -1 : 1);
    return { token, off, semi: NATURAL[off % 7] + 12 * Math.floor(off / 7) + acc };
  }
  const parseFormula = (f) => f.trim().split(/\s+/).map(parseDegree);

  // Escalas. `chars` son las notas que dan al modo su color propio; `tonal` indica
  // que su armonía funciona con las reglas clásicas de tónica-dominante.
  const SCALES = [
    { id: 'ionian', name: 'Jónico (mayor)', group: 'Modos griegos', f: '1 2 3 4 5 6 7', chars: ['7'], tonal: true },
    { id: 'dorian', name: 'Dórico', group: 'Modos griegos', f: '1 2 b3 4 5 6 b7', chars: ['6'] },
    { id: 'phrygian', name: 'Frigio', group: 'Modos griegos', f: '1 b2 b3 4 5 b6 b7', chars: ['b2'] },
    { id: 'lydian', name: 'Lidio', group: 'Modos griegos', f: '1 2 3 #4 5 6 7', chars: ['#4'] },
    { id: 'mixolydian', name: 'Mixolidio', group: 'Modos griegos', f: '1 2 3 4 5 6 b7', chars: ['b7'] },
    { id: 'aeolian', name: 'Eólico (menor natural)', group: 'Modos griegos', f: '1 2 b3 4 5 b6 b7', chars: ['b6', 'b7'], tonal: true },
    { id: 'locrian', name: 'Locrio', group: 'Modos griegos', f: '1 b2 b3 4 b5 b6 b7', chars: ['b2', 'b5'] },

    { id: 'harmonic', name: 'Menor armónica', group: 'Menor armónica', f: '1 2 b3 4 5 b6 7', chars: ['7'], tonal: true },
    { id: 'locrian6', name: 'Locrio ♮6', group: 'Menor armónica', f: '1 b2 b3 4 b5 6 b7', chars: ['b5', '6'] },
    { id: 'ionian5', name: 'Jónico ♯5', group: 'Menor armónica', f: '1 2 3 4 #5 6 7', chars: ['#5'] },
    { id: 'dorian4', name: 'Dórico ♯4', group: 'Menor armónica', f: '1 2 b3 #4 5 6 b7', chars: ['#4', '6'] },
    { id: 'phrygiandom', name: 'Frigio dominante', group: 'Menor armónica', f: '1 b2 3 4 5 b6 b7', chars: ['b2', '3'] },
    { id: 'lydian2', name: 'Lidio ♯2', group: 'Menor armónica', f: '1 #2 3 #4 5 6 7', chars: ['#2', '#4'] },
    { id: 'superlocrian7', name: 'Superlocrio ♭♭7', group: 'Menor armónica', f: '1 b2 b3 b4 b5 b6 bb7', chars: ['b4', 'bb7'] },

    { id: 'melodic', name: 'Menor melódica', group: 'Menor melódica', f: '1 2 b3 4 5 6 7', chars: ['6', '7'], tonal: true },
    { id: 'dorianb2', name: 'Dórico ♭2', group: 'Menor melódica', f: '1 b2 b3 4 5 6 b7', chars: ['b2', '6'] },
    { id: 'lydianaug', name: 'Lidio aumentado', group: 'Menor melódica', f: '1 2 3 #4 #5 6 7', chars: ['#4', '#5'] },
    { id: 'lydiandom', name: 'Lidio dominante', group: 'Menor melódica', f: '1 2 3 #4 5 6 b7', chars: ['#4', 'b7'] },
    { id: 'mixolydianb6', name: 'Mixolidio ♭6', group: 'Menor melódica', f: '1 2 3 4 5 b6 b7', chars: ['b6', 'b7'] },
    { id: 'locrian2', name: 'Locrio ♮2', group: 'Menor melódica', f: '1 2 b3 4 b5 b6 b7', chars: ['2', 'b5'] },
    { id: 'altered', name: 'Alterada', group: 'Menor melódica', f: '1 b2 b3 b4 b5 b6 b7', chars: ['b4', 'b5'] },

    { id: 'harmonicmajor', name: 'Mayor armónica', group: 'Otras', f: '1 2 3 4 5 b6 7', chars: ['b6'], tonal: true },
    { id: 'hungarian', name: 'Húngara menor', group: 'Otras', f: '1 2 b3 #4 5 b6 7', chars: ['#4', '7'] },
    { id: 'doubleharmonic', name: 'Doble armónica', group: 'Otras', f: '1 b2 3 4 5 b6 7', chars: ['b2', '7'] },
    { id: 'pentamajor', name: 'Pentatónica mayor', group: 'Otras', f: '1 2 3 5 6', chars: ['6'] },
    { id: 'pentaminor', name: 'Pentatónica menor', group: 'Otras', f: '1 b3 4 5 b7', chars: ['b7'] },
    { id: 'blues', name: 'Blues', group: 'Otras', f: '1 b3 4 b5 5 b7', chars: ['b5'] },
    { id: 'wholetone', name: 'Tonos enteros', group: 'Otras', f: '1 2 3 #4 #5 b7', chars: ['#4', '#5'] },
    { id: 'octatonic', name: 'Disminuida (tono-semitono)', group: 'Otras', f: '1 2 b3 4 b5 b6 6 7', chars: ['b5', '6'] },
  ].map((s) => ({ ...s, degrees: parseFormula(s.f), charDegrees: s.chars.map(parseDegree) }));

  const scaleById = (id) => SCALES.find((s) => s.id === id) || SCALES[0];

  // Cualidades de acorde. level: 0 tríada, 1 cuatríada, 2 color.
  // `omit` son las notas que se pueden dejar fuera en un voicing de guitarra.
  const QUALITIES = [
    { id: 'maj', suffix: '', label: 'mayor', f: '1 3 5', level: 0 },
    { id: 'min', suffix: 'm', label: 'menor', f: '1 b3 5', level: 0, minor: true },
    { id: 'dim', suffix: 'dim', label: 'disminuido', f: '1 b3 b5', level: 0, minor: true, rn: '°' },
    { id: 'aug', suffix: 'aug', label: 'aumentado', f: '1 3 #5', level: 0, rn: '+' },

    { id: 'maj7', suffix: 'maj7', label: 'mayor con 7ª mayor', f: '1 3 5 7', level: 1, omit: ['5'], rn: 'maj7' },
    { id: 'dom7', suffix: '7', label: 'dominante', f: '1 3 5 b7', level: 1, omit: ['5'], rn: '7' },
    { id: 'm7', suffix: 'm7', label: 'menor con 7ª', f: '1 b3 5 b7', level: 1, omit: ['5'], minor: true, rn: '7' },
    { id: 'm7b5', suffix: 'm7♭5', label: 'semidisminuido', f: '1 b3 b5 b7', level: 1, minor: true, rn: 'ø7' },
    { id: 'dim7', suffix: 'dim7', label: 'disminuido con 7ª', f: '1 b3 b5 bb7', level: 1, minor: true, rn: '°7' },
    { id: 'mmaj7', suffix: 'm(maj7)', label: 'menor con 7ª mayor', f: '1 b3 5 7', level: 1, omit: ['5'], minor: true, rn: '(maj7)' },
    { id: 'augmaj7', suffix: 'maj7♯5', label: 'aumentado con 7ª mayor', f: '1 3 #5 7', level: 1, rn: '+maj7' },
    { id: 'aug7', suffix: '7♯5', label: 'dominante aumentado', f: '1 3 #5 b7', level: 1, rn: '+7' },

    { id: 'sus2', suffix: 'sus2', label: 'suspendido 2ª', f: '1 2 5', level: 2, sus: true, rn: 'sus2' },
    { id: 'sus4', suffix: 'sus4', label: 'suspendido 4ª', f: '1 4 5', level: 2, sus: true, rn: 'sus4' },
    { id: '7sus4', suffix: '7sus4', label: 'dominante suspendido', f: '1 4 5 b7', level: 2, sus: true, omit: ['5'], rn: '7sus4' },
    { id: '6', suffix: '6', label: 'mayor con 6ª', f: '1 3 5 6', level: 2, omit: ['5'], rn: '6' },
    { id: 'm6', suffix: 'm6', label: 'menor con 6ª', f: '1 b3 5 6', level: 2, omit: ['5'], minor: true, rn: '6' },
    { id: 'add9', suffix: 'add9', label: 'mayor con 9ª añadida', f: '1 3 5 9', level: 2, omit: ['5'], rn: 'add9' },
    { id: 'madd9', suffix: 'm(add9)', label: 'menor con 9ª añadida', f: '1 b3 5 9', level: 2, omit: ['5'], minor: true, rn: 'add9' },
    { id: 'maj9', suffix: 'maj9', label: 'mayor con 7ª y 9ª', f: '1 3 5 7 9', level: 2, omit: ['5'], rn: 'maj9' },
    { id: '9', suffix: '9', label: 'dominante con 9ª', f: '1 3 5 b7 9', level: 2, omit: ['5'], rn: '9' },
    { id: 'm9', suffix: 'm9', label: 'menor con 7ª y 9ª', f: '1 b3 5 b7 9', level: 2, omit: ['5'], minor: true, rn: '9' },
  ].map((q) => ({ ...q, tones: parseFormula(q.f) }));

  const qualityById = (id) => QUALITIES.find((q) => q.id === id);

  // Ortografía -------------------------------------------------------------

  const note = (l, pc) => ({ l: mod(l, 7), pc: mod(pc) });

  function accidental(n) {
    let a = mod(n.pc - NATURAL[n.l]);
    if (a > 6) a -= 12;
    return a;
  }

  const accText = (a) => (a > 0 ? '♯'.repeat(a) : '♭'.repeat(-a));

  function noteName(n, notation) {
    const base = notation === 'latin' ? SOLFEGE[n.l] : LETTERS[n.l];
    return base + accText(accidental(n));
  }

  // Dos formas de escribir cada tónica (Do♯ / Re♭): se elige la que da menos
  // alteraciones a lo largo de la escala.
  function tonicCandidates(pc) {
    const out = [];
    for (let l = 0; l < 7; l++) {
      const n = note(l, pc);
      if (Math.abs(accidental(n)) <= 1) out.push(n);
    }
    return out;
  }

  function spellingCost(tonic, scale) {
    let cost = 0;
    for (const d of scale.degrees) {
      const a = Math.abs(accidental(note(tonic.l + d.off, tonic.pc + d.semi)));
      cost += a + (a > 1 ? 4 : 0);
    }
    return cost;
  }

  function makeKey(pc, scaleId, forcedTonic) {
    const scale = scaleById(scaleId);
    let tonic = forcedTonic;
    if (!tonic) {
      tonic = tonicCandidates(pc)
        .map((n) => ({ n, c: spellingCost(n, scale) }))
        .sort((a, b) => a.c - b.c)[0].n;
    }
    const notes = scale.degrees.map((d) => ({
      ...note(tonic.l + d.off, tonic.pc + d.semi),
      deg: d.token,
    }));
    return {
      tonic, pc: tonic.pc, scale, notes,
      pcs: new Set(notes.map((n) => n.pc)),
      heptatonic: notes.length === 7,
      charPcs: new Set(scale.charDegrees.map((d) => mod(tonic.pc + d.semi))),
    };
  }

  // Acordes ----------------------------------------------------------------

  function romanFor(root, quality, key) {
    const off = mod(root.l - key.tonic.l, 7);
    let acc = mod(root.pc - key.pc) - NATURAL[off];
    if (acc > 6) acc -= 12;
    if (acc < -6) acc += 12;
    const n = quality.minor ? ROMAN[off].toLowerCase() : ROMAN[off];
    const base = accText(acc) + n;
    return { base, full: base + (quality.rn || '') };
  }

  function makeChord(root, qualityId, key, origin) {
    const q = qualityById(qualityId);
    const tones = q.tones.map((t) => ({
      ...note(root.l + t.off, root.pc + t.semi),
      deg: t.token,
      semi: t.semi,
    }));
    const pcs = tones.map((t) => t.pc);
    const omit = q.omit || [];
    const rn = romanFor(root, q, key);
    const chord = {
      id: root.pc + ':' + q.id,
      root: note(root.l, root.pc),
      q, tones, pcs,
      required: tones.filter((t) => !omit.includes(t.deg)).map((t) => t.pc),
      roman: rn.full, romanBase: rn.base,
      degree: mod(root.l - key.tonic.l, 7) + 1,
      interval: mod(root.pc - key.pc),
      origin: origin || { kind: 'scale' },
    };
    chord.fn = functionOf(chord, key);
    if (chord.origin.roman) chord.roman = chord.origin.roman;
    return chord;
  }

  // T tónica, S subdominante, D dominante, M color modal.
  function functionOf(c, key) {
    const leading = c.pcs.includes(mod(key.pc + 11));
    switch (c.degree) {
      case 1: return c.interval === 0 ? 'T' : 'M';
      case 2: case 4: return c.degree === 4 && c.interval === 6 ? 'M' : 'S';
      case 3: case 6: return 'T';
      case 5:
        if (c.interval !== 7) return 'M';
        return leading ? 'D' : 'M';
      default:
        return c.interval === 11 ? 'D' : 'M';
    }
  }

  function chordName(c, notation) {
    return { root: noteName(c.root, notation), suffix: c.q.suffix };
  }
  function chordText(c, notation) {
    const n = chordName(c, notation);
    return n.root + n.suffix;
  }

  function fitsScale(chord, key) {
    if (!key.heptatonic) return chord.pcs.every((pc) => key.pcs.has(pc));
    return chord.tones.every((t) => key.notes.some((n) => n.l === t.l && n.pc === t.pc));
  }

  function levelMatches(q, level, key) {
    if (level === 2) return true;
    if (q.level === level) return true;
    return !key.heptatonic && q.sus && level === 0;
  }

  // Acordes propios de la escala, de grave a agudo por grado.
  function harmonicField(key, level) {
    const out = [];
    for (const n of key.notes) {
      let found = QUALITIES.filter((q) => levelMatches(q, level, key))
        .map((q) => makeChord(n, q.id, key))
        .filter((c) => fitsScale(c, key));
      // Una pentatónica no siempre admite cuatríadas: se recurre a las tríadas.
      if (!found.length && level === 1) {
        found = QUALITIES.filter((q) => q.level === 0 || q.sus)
          .map((q) => makeChord(n, q.id, key))
          .filter((c) => fitsScale(c, key));
      }
      out.push(...found);
    }
    return out;
  }

  const BORROW_FROM = ['ionian', 'aeolian', 'dorian', 'mixolydian', 'phrygian', 'lydian', 'harmonic'];

  // Acordes fuera de escala: dominantes secundarias, sustitutos de tritono e
  // intercambio modal con los modos paralelos.
  function outsideChords(key, level) {
    const diatonic = harmonicField(key, level);
    const seen = new Set(diatonic.map((c) => c.id));
    const out = [];
    const add = (c) => { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } };

    const targets = harmonicField(key, 0).filter((c) => ['maj', 'min'].includes(c.q.id));
    for (const t of targets) {
      if (t.interval !== 0) {
        add(makeChord(note(t.root.l + 4, t.root.pc + 7), 'dom7', key,
          { kind: 'secondary', targetPc: t.root.pc, roman: 'V7/' + t.romanBase }));
      }
    }
    for (const t of targets) {
      if ([0, 7].includes(t.interval) || t.degree === 2) {
        add(makeChord(note(t.root.l + 1, t.root.pc + 1), 'dom7', key,
          { kind: 'tritone', targetPc: t.root.pc, roman: 'subV7/' + t.romanBase }));
      }
    }
    for (const id of BORROW_FROM) {
      if (id === key.scale.id) continue;
      const other = makeKey(key.pc, id, key.tonic);
      for (const c of harmonicField(other, Math.min(level, 1))) {
        add(makeChord(c.root, c.q.id, key, { kind: 'borrowed', from: other.scale.name }));
      }
    }
    return out;
  }

  // Convierte "bVII", "ii7", "iiø7", "Imaj7"... en un acorde de la tonalidad.
  function chordFromRoman(token, key) {
    const m = /^(b|#|♭|♯)?(III|II|IV|VII|VI|V|I|iii|ii|iv|vii|vi|v|i)(.*)$/.exec(token);
    if (!m) throw new Error('Grado romano inválido: ' + token);
    const off = ROMAN.indexOf(m[2].toUpperCase());
    const acc = !m[1] ? 0 : 'b♭'.includes(m[1]) ? -1 : 1;
    const lower = m[2] === m[2].toLowerCase();
    const suffix = m[3];
    const map = {
      '': lower ? 'min' : 'maj', '°': 'dim', '+': 'aug', '7': lower ? 'm7' : 'dom7',
      'maj7': 'maj7', 'ø7': 'm7b5', '°7': 'dim7', '6': lower ? 'm6' : '6',
    };
    const qid = map[suffix];
    if (!qid) throw new Error('Sufijo inválido: ' + token);
    const root = note(key.tonic.l + off, key.pc + NATURAL[off] + acc);
    return makeChord(root, qid, key);
  }

  globalThis.Theory = {
    SCALES, QUALITIES, SOLFEGE, LETTERS, NATURAL, mod, note, scaleById, qualityById,
    makeKey, makeChord, harmonicField, outsideChords, fitsScale, chordFromRoman,
    noteName, chordName, chordText, tonicCandidates,
  };
})();
