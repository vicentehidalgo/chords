// Pruebas del motor (sin navegador). Con JavaScriptCore de macOS:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/run.js
// Ejecutar desde la raíz del proyecto.
load('js/theory.js');
load('js/suggest.js');
load('js/voicings.js');
load('js/melody.js');
globalThis.performance = globalThis.performance || { now: () => clock };
var clock = 1000;
load('js/midi.js');
load('js/drums.js');
load('js/spanish.js');
load('js/voice.js');

const { makeKey, harmonicField, outsideChords, chordText, noteName, makeChord, note } = Theory;
let failed = 0;
let passed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else { failed++; print(`FALLA ${label}\n  esperado ${e}\n  obtenido ${a}`); }
}
const field = (pc, id, level = 0) => harmonicField(makeKey(pc, id), level).map((c) => chordText(c));
const romans = (pc, id, level = 0) => harmonicField(makeKey(pc, id), level).map((c) => c.roman);
const scaleNotes = (pc, id) => makeKey(pc, id).notes.map((n) => noteName(n));

// Ortografía
eq(scaleNotes(1, 'ionian'), ['D♭', 'E♭', 'F', 'G♭', 'A♭', 'B♭', 'C'], 'Reb mayor');
eq(scaleNotes(6, 'lydian'), ['G♭', 'A♭', 'B♭', 'C', 'D♭', 'E♭', 'F'], 'Solb lidio');
eq(scaleNotes(1, 'aeolian'), ['C♯', 'D♯', 'E', 'F♯', 'G♯', 'A', 'B'], 'Do# menor');
eq(scaleNotes(9, 'harmonic'), ['A', 'B', 'C', 'D', 'E', 'F', 'G♯'], 'La menor armónica');

// Campos armónicos de modos griegos
eq(field(0, 'ionian'), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'], 'Do mayor');
eq(romans(0, 'ionian'), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], 'romanos mayor');
eq(field(2, 'dorian'), ['Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C'], 'Re dórico');
eq(romans(2, 'dorian'), ['i', 'ii', '♭III', 'IV', 'v', 'vi°', '♭VII'], 'romanos dórico');
eq(romans(4, 'phrygian'), ['i', '♭II', '♭III', 'iv', 'v°', '♭VI', '♭vii'], 'romanos frigio');
eq(romans(5, 'lydian'), ['I', 'II', 'iii', '♯iv°', 'V', 'vi', 'vii'], 'romanos lidio');
eq(romans(7, 'mixolydian'), ['I', 'ii', 'iii°', 'IV', 'v', 'vi', '♭VII'], 'romanos mixolidio');
eq(romans(11, 'locrian'), ['i°', '♭II', '♭iii', 'iv', '♭V', '♭VI', '♭vii'], 'romanos locrio');
eq(field(0, 'ionian', 1), ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7♭5'], 'cuatríadas');
eq(field(9, 'harmonic'), ['Am', 'Bdim', 'Caug', 'Dm', 'E', 'F', 'G♯dim'], 'menor armónica sin enarmónicos falsos');
eq(field(9, 'harmonic', 1)[6], 'G♯dim7', 'vii°7 armónica');

// Todas las escalas y tónicas dan acordes y nombres válidos
for (const s of Theory.SCALES) {
  for (let pc = 0; pc < 12; pc++) {
    const key = makeKey(pc, s.id);
    for (const level of [0, 1, 2]) {
      const cs = [...harmonicField(key, level), ...outsideChords(key, level)];
      if (s.id !== 'octatonic' && !cs.length) eq(0, 1, `sin acordes ${s.id} ${pc}`);
      const ids = new Set(cs.map((c) => c.id));
      eq(ids.size >= new Set(harmonicField(key, level).map((c) => c.id)).size, true, 'ids');
      cs.forEach((c) => {
        if (/undefined|NaN/.test(chordText(c) + c.roman)) eq(0, 1, `nombre roto ${c.id}`);
      });
    }
    Suggest.presetsFor(key).forEach((p) => eq(p.chords.length > 1, true, p.name));
  }
}

// Las progresiones por defecto deben ser en su mayoría de la propia escala
for (const id of ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian']) {
  const key = makeKey(0, id);
  Suggest.presetsFor(key).forEach((p) => p.chords.forEach((c) => {
    if (!Theory.fitsScale(c, key)) eq(c.roman, 'de la escala', `${p.name} en ${id}`);
  }));
}

// Sugerencias
function top(pc, id, romanHistory, n = 3, level = 0, outside = false) {
  const key = makeKey(pc, id);
  const candidates = harmonicField(key, level).concat(outside ? outsideChords(key, level) : []);
  const history = romanHistory.map((r) => {
    if (r.startsWith('V7/')) return outsideChords(key, level).find((c) => c.roman === r);
    return Theory.chordFromRoman(r, key);
  });
  return Suggest.suggest({ key, candidates, history, notation: 'intl' }).slice(0, n).map((x) => x.chord.romanBase);
}
eq(top(0, 'ionian', ['V'], 1), ['I'], 'V → I');
eq(top(0, 'ionian', ['ii'], 1), ['V'], 'ii → V');
eq(top(0, 'ionian', ['V7'], 1, 1), ['I'], 'V7 → I');
eq(top(0, 'ionian', ['V7/ii'], 1, 0, true), ['ii'], 'V7/ii → ii');
eq(top(0, 'ionian', [], 1), ['I'], 'empieza en I');
eq(top(0, 'ionian', ['I', 'V', 'vi'], 1), ['IV'], 'completa pop canónico');
eq(top(2, 'dorian', ['i'], 3).includes('IV'), true, 'dórico: IV entre los primeros');
eq(top(4, 'phrygian', ['i'], 3).includes('♭II'), true, 'frigio: ♭II entre los primeros');
eq(top(4, 'phrygian', ['♭II'], 1), ['i'], 'frigio: ♭II → i');
eq(top(5, 'lydian', ['I'], 3).includes('II'), true, 'lidio: II entre los primeros');
eq(top(7, 'mixolydian', ['I'], 3).includes('♭VII'), true, 'mixolidio: ♭VII entre los primeros');

// Guitarra: los acordes abiertos clásicos deben salir primero
const gv = (pc, l, q) => {
  const key = makeKey(0, 'ionian');
  return Voicings.guitarVoicings(makeChord(note(l, pc), q, key));
};
const shape = (v) => v.frets.map((f) => (f < 0 ? 'x' : f)).join('');
eq(shape(gv(0, 0, 'maj')[0]), 'x32010', 'Do');
eq(shape(gv(7, 4, 'maj')[0]), '320003', 'Sol');
eq(shape(gv(2, 1, 'maj')[0]), 'xx0232', 'Re');
eq(shape(gv(9, 5, 'maj')[0]), 'x02220', 'La');
eq(shape(gv(4, 2, 'maj')[0]), '022100', 'Mi');
eq(shape(gv(9, 5, 'min')[0]), 'x02210', 'Lam');
eq(shape(gv(4, 2, 'min')[0]), '022000', 'Mim');
eq(shape(gv(2, 1, 'min')[0]), 'xx0231', 'Rem');
eq(gv(5, 3, 'maj').slice(0, 4).map(shape).includes('133211'), true, 'Fa con cejilla');
eq(shape(gv(7, 4, 'dom7')[0]), '320001', 'Sol7');
eq(shape(gv(0, 0, 'maj7')[0]), 'x32000', 'Domaj7');
eq(shape(gv(9, 5, 'm7')[0]), 'x02010', 'Lam7');

// Todo acorde de la escala tiene digitación y posición de piano
let missing = 0;
for (const q of Theory.QUALITIES) {
  for (let pc = 0; pc < 12; pc++) {
    const key = makeKey(pc, 'ionian');
    const c = makeChord(key.tonic, q.id, key);
    if (!Voicings.guitarVoicings(c).length) { missing++; print('sin digitación: ' + chordText(c)); }
    const pv = Voicings.pianoVoicings(c);
    if (!pv.length) { missing++; print('sin piano: ' + chordText(c)); }
  }
}
eq(missing, 0, 'cobertura de voicings');

// Melodía
{
  const key = makeKey(0, 'ionian');
  const C = Theory.chordFromRoman('I', key);
  const G7 = Theory.chordFromRoman('V7', key);
  eq(Melody.role(0, C, key), 'root', 'Do sobre Do: fundamental');
  eq(Melody.role(4, C, key), 'chord', 'Mi sobre Do: nota del acorde');
  eq(Melody.role(2, C, key), 'tension', 'Re sobre Do: tensión');
  eq(Melody.role(5, C, key), 'avoid', 'Fa sobre Do: choca con Mi');
  eq(Melody.role(1, C, key), 'out', 'Do# sobre Do: fuera');
  eq(Melody.role(0, G7, key), 'avoid', 'Do sobre Sol7: choca con Si');
  for (const id of ['ionian', 'dorian', 'phrygian', 'pentaminor', 'harmonic']) {
    const k = makeKey(9, id);
    const chords = harmonicField(k, 0).slice(0, 4);
    if (chords.length < 2) continue;
    for (let seed = 1; seed < 40; seed++) {
      const mel = Melody.generate(chords, k, Melody.seeded(seed));
      const rows = Melody.rows(k, chords);
      mel.forEach((bar, i) => {
        eq(bar.length, Melody.STEPS, 'pasos por compás');
        bar.forEach((off, step) => {
          if (off === null) return;
          if (!rows.includes(off)) eq(off, 'en rango', `fila ${id}`);
          const role = Melody.role(Theory.mod(k.pc + off), chords[i], k);
          if (step % 4 === 0 && !['root', 'chord'].includes(role)) eq(role, 'chord', `tiempo fuerte ${id}`);
        });
      });
    }
  }
}

// Swing
{
  eq(Melody.swingShift(1, 50, 300), 0, 'recto no desplaza');
  eq(Melody.swingShift(0, 67, 300), 0, 'la parte fuerte no se mueve');
  eq(Math.round(Melody.swingShift(1, 75, 300)), 150, 'swing 75: media corchea');
  eq(Math.round(Melody.spanMs(0, 1, 75, 300)), 450, 'corchea larga');
  eq(Math.round(Melody.spanMs(1, 2, 75, 300)), 150, 'corchea corta');
  eq(Math.round(Melody.spanMs(0, 8, 67, 300)), 2400, 'el compás no cambia de duración');
  eq(Math.round(Melody.spanMs(3, 8, 67, 300)), 1398, 'golpe a contratiempo hasta el final');
}

// Percusión
{
  const txt = (a) => a.map((x) => (x ? 'x' : '.')).join('');
  eq(txt(Drums.euclid(3, 8)), 'x..x..x.', 'tresillo euclídeo');
  eq(txt(Drums.euclid(4, 16)), 'x...x...x...x...', 'negras');
  eq(txt(Drums.euclid(0, 5)), '.....', 'cero golpes');
  eq(txt(Drums.euclid(5, 5)), 'xxxxx', 'todos los golpes');
  for (let n = 2; n <= Drums.MAX_STEPS; n++) {
    for (let k = 0; k <= n; k++) {
      if (Drums.euclid(k, n).reduce((a, b) => a + b, 0) !== k) eq(k, 'exacto', `euclid(${k},${n})`);
    }
  }
  eq(txt(Drums.rotate(Drums.euclid(3, 8), 1)), '.x..x..x', 'rotar');
  eq(Drums.necklaceName(Drums.euclid(3, 8)), 'Tresillo cubano', 'reconoce tresillo');
  eq(Drums.necklaceName(Drums.rotate(Drums.euclid(5, 16), 3)), 'Bossa nova', 'reconoce rotaciones');
  eq(Drums.necklaceName([1, 1, 0, 0, 0, 0, 1, 0]), null, 'no confunde un reparto irregular');

  Drums.PRESETS.forEach((p) => {
    const rings = Drums.presetRings(p);
    eq(rings.length <= Drums.MAX_RINGS, true, p.name + ': anillos');
    rings.forEach((r) => {
      eq(Boolean(Drums.INSTRUMENTS[r.inst]), true, p.name + ': instrumento');
      eq(r.steps.length >= 2 && r.steps.length <= Drums.MAX_STEPS, true, `${p.name}: pasos ${r.steps.length}`);
      eq(r.steps.some(Boolean), true, p.name + ': con golpes');
    });
  });
  for (let seed = 1; seed < 30; seed++) {
    const rand = Melody.seeded(seed * 97);
    const rings = Drums.invent(rand);
    eq(rings.every((r) => r.steps.some(Boolean) && r.steps.length <= Drums.MAX_STEPS), true, 'invent válido');
    Drums.mutate(rings, rand);
    eq(rings.every((r) => r.steps.length >= 2), true, 'mutar conserva pasos');
  }

  const ctx = { life: 0, rand: () => .5, melody: [0, 3], chordHits: [0, 3] };
  const r16 = (gate) => [{ inst: 'kick', steps: Array(16).fill(1), gate, muted: false }];
  const posOf = (h) => h.map((x) => x.step);
  eq(Drums.barHits(r16('free'), ctx).length, 16, 'libre toca todo');
  eq(posOf(Drums.barHits(r16('melody'), ctx)), [0, 6], 'con la melodía: sus ataques');
  eq(Drums.barHits(r16('gaps'), ctx).length, 14, 'en sus huecos: el resto');
  eq(posOf(Drums.barHits(r16('chords'), ctx)), [0, 6], 'con los acordes');
  eq(Drums.barHits([{ ...r16('free')[0], muted: true }], ctx), [], 'anillo mudo');
  const poly = Drums.barHits([{ inst: 'clave', steps: [1, 1, 1, 1, 1], gate: 'free', muted: false }], ctx);
  eq(poly.map((h) => h.pos), [0, .2, .4, .6, .8], 'cinco golpes reparten el compás');
  eq(poly[0].velocity > poly[1].velocity, true, 'acento en la primera');
  const steady = Drums.barHits(r16('free'), { ...ctx, life: 1, rand: () => .01 });
  eq(steady.filter((h) => h.pos * 4 % 1 === 0).length, 4, 'la vida nunca quita las partes fuertes');
  const ghosts = Drums.barHits([{ inst: 'hat', steps: Array(16).fill(0), gate: 'free', muted: false }], { ...ctx, life: 1, rand: () => .01 });
  eq(ghosts.length > 0 && ghosts.every((h) => h.velocity < 50), true, 'golpes fantasma suaves');

  eq(Drums.swungPos(.125, 50), .125, 'recto no altera');
  eq(Drums.swungPos(0, 67), 0, 'la parte no se mueve');
  eq(Math.abs(Drums.swungPos(.125, 75) - .1875) < 1e-9, true, 'corchea a contratiempo con swing');
  eq(Math.abs(Drums.swungPos(.25, 75) - .25) < 1e-9, true, 'negra intacta');
  for (let i = 1; i < 64; i++) {
    if (Drums.swungPos(i / 64, 75) <= Drums.swungPos((i - 1) / 64, 75)) eq(i, 'monótono', 'swing no reordena');
  }
  // Coincide con el swing de los acordes y la melodía.
  const barMs = 2400;
  eq(Math.round(Drums.swungPos(1 / 8, 67) * barMs - barMs / 8), Math.round(Melody.swingShift(1, 67, 300)), 'mismo swing que la melodía');
}

// MIDI: con una salida falsa y un reloj controlado
{
  globalThis.performance = { now: () => clock };
  let sent = [];
  Midi.attach({ send: (b, t) => sent.push([...b, t]) });
  const kinds = () => sent.map((m) => m[0]);

  Midi.chord(1, [60, 64, 67], 1000, 80, 1000);
  eq(kinds(), [0x90, 0x90, 0x90], 'acorde: tres note-on, canal 1');
  eq(sent[1], [0x90, 64, 80, 1000], 'note-on con marca de tiempo');
  Midi.flush();
  eq(sent.length, 3, 'el note-off se retiene hasta su momento');
  clock = 1900; Midi.flush();
  eq(sent.slice(3).map((m) => m.slice(0, 2).concat(m[3])), [[0x80, 60, 2000], [0x80, 64, 2000], [0x80, 67, 2000]], 'note-off a tiempo');

  sent = []; clock = 3000;
  Midi.note(2, 72, 500, 100, 3000);
  eq(sent[0], [0x91, 72, 100, 3000], 'melodía en canal 2');
  Midi.note(2, 72, 500, 100, 3200);
  eq(sent.slice(1), [[0x81, 72, 0, 3199], [0x91, 72, 100, 3200]], 'nota repetida cierra la anterior antes de atacar');

  sent = []; clock = 4000;
  Midi.note(1, 60, 500, 90, 4000);
  Midi.note(3, 62, 500, 90, 4050);
  sent = [];
  Midi.silence();
  eq(sent.filter((m) => m[0] === 0x80 && m[1] === 60).length, 2, 'parar apaga ahora y tras el margen');
  eq(sent.some((m) => m[0] === 0x82 && m[1] === 62), true, 'parar cubre todos los canales usados');
  eq(sent.some((m) => m[0] === 0xB0 && m[1] === 123), true, 'parar envía all notes off');
  sent = []; clock = 9000; Midi.flush();
  eq(sent, [], 'tras parar no quedan note-off pendientes');
  Midi.panic();
  eq(sent.length, 32, 'pánico en los 16 canales');
  Midi.attach(null);
}


// Letra en español → sílabas
{
  const sy = (t, o) => Spanish.syllables(t, o).map((s) => s.text);
  const ipa = (t, o) => Spanish.syllables(t, o).map((s) => s.onset.join('') + s.nucleus + s.coda.join(''));
  eq(sy('Cielito lindo'), ['Cie', 'li', 'to', 'lin', 'do'], 'sílabas: cielito lindo');
  eq(sy('construir'), ['cons', 'truir'], 'ataque tr y coda ns');
  eq(sy('Atlántico'), ['At', 'lán', 'ti', 'co'], 'tl se separa');
  eq(sy('maíz poeta'), ['ma', 'íz', 'po', 'e', 'ta'], 'hiatos: tilde y vocales fuertes');
  eq(sy('aire cuando'), ['ai', 're', 'cuan', 'do'], 'diptongos');
  eq(sy('pingüino guerra'), ['pin', 'güi', 'no', 'gue', 'rra'], 'gü y gu');
  eq(sy('ahora'), ['a', 'ho', 'ra'], 'h muda');
  eq(ipa('cielo'), ['θje', 'lo'], 'ce/ci con θ en España');
  eq(ipa('cielo', { seseo: true }), ['sje', 'lo'], 'seseo');
  eq(ipa('rosa pero honra'), ['ro', 'sa', 'pe', 'ɾo', 'on', 'ra'], 'r fuerte y suave');
  eq(ipa('rey hoy'), ['rej', 'oj'], 'y final es semivocal');
  eq(ipa('yo llamo'), ['ʝo', 'ʝa', 'mo'], 'y y ll ante vocal');
  eq(ipa('un beso'), ['um', 'be', 'so'], 'n ante b suena m; b tras nasal no se suaviza');
  eq(ipa('la boda'), ['la', 'βo', 'ða'], 'b y d entre vocales se suavizan');
  eq(ipa('un gato'), ['uŋ', 'ga', 'to'], 'n velar ante g');
  eq(ipa('quiero jugar'), ['kje', 'ɾo', 'xu', 'ɣaɾ'], 'qu, j y g suave');
  eq(ipa('el dedo'), ['el', 'de', 'ðo'], 'd tras l no se suaviza');
  eq(sy('de_amor'), ['de‿a', 'mor'], 'sinalefa con _');
  eq(ipa('de_amor'), ['dja', 'moɾ'], 'sinalefa: la e se vuelve semivocal');
  const mel = Spanish.syllables('sol - mar');
  eq(mel.map((s) => [s.text, s.nucleus, s.coda.join(''), !!s.melisma]), [['sol', 'o', '', false], ['–', 'o', 'l', true], ['mar', 'a', 'ɾ', false]], 'melisma: la coda pasa a la última nota');
  eq(Spanish.syllables('hola, mundo').map((s) => s.phraseEnd), [false, true, false, false], 'la coma marca respiración');
  eq(ipa('hola, boda'), ['o', 'la', 'bo', 'ða'], 'tras respirar la b es oclusiva');
  const c = Spanish.toChimera(Spanish.syllables('pan')[0]);
  eq(c, { text: 'pan', onset: [{ ipa: 'p' }], nucleus: { ipa: 'a' }, coda: [{ ipa: 'n' }], wordEnd: true, phraseEnd: false }, 'formato CHIMERA');
}

// Voz: notas, reparto de la letra y petición al motor
{
  const prog = [{ mel: [0, null, 2, null, null, null, null, null] }, { mel: [null, null, 4, null, null, null, null, 5] }];
  const notes = Voice.notesOf(prog.map((b) => b.mel));
  eq(notes.map((n) => [n.g, n.len]), [[0, 2], [2, 6], [10, 5], [15, 1]], 'notas: duran hasta la siguiente o el final del compás');
  notes.forEach((n) => { n.midi = 60 + n.off; });
  const sylls = Spanish.syllables('la lu na');
  const al = Voice.align(notes, sylls);
  eq([al.pairs.map((p) => p.syl && p.syl.text), al.extraNotes, al.extraSyllables.length], [['la', 'lu', 'na', null], 1, 0], 'reparto: sobra una nota');
  eq(Voice.align(notes.slice(0, 2), sylls).extraSyllables.map((s) => s.text), ['na'], 'reparto: sobra una sílaba');
  const req = Voice.request({ pairs: al.pairs, bpm: 120, swing: 50, body: 'male', vibrato: 30, breath: .1, bright: .2 });
  eq(req.notes.map((n) => [n.midi, n.beats, n.syl ? n.syl.text : null]), [[60, 1, 'la'], [62, 3, 'lu'], [0, 1, null], [64, 2.5, 'na'], [65, .5, null]], 'petición: silencios y pulsos');
  eq([req.body, req.t0, req.source.vibratoRate], [{ female: 0, child: 0 }, Voice.LEAD, 6], 'petición: cuerpo, margen y vibrato a 3 por pulso');
  const sw = Voice.request({ pairs: al.pairs, bpm: 120, swing: 67, body: 'female', vibrato: 30, breath: .1, bright: .2 });
  const beatsSum = sw.notes.reduce((a, n) => a + n.beats, 0);
  eq([sw.notes[3].beats.toFixed(2), beatsSum.toFixed(2)], ['2.67', '8.00'], 'petición: el swing mueve la corchea pero no alarga la canción');
  eq(Voice.autoOctave([67, 72, 76], 'male'), -2, 'octava automática: hombre');
  eq(Voice.autoOctave([60, 67], 'female'), 0, 'octava automática: mujer');
  eq(Voice.autoOctave([], 'child'), 0, 'octava sin notas');
  eq(Voice.notesOf([prog[0].mel], 2).map((n) => n.g), [16, 18], 'notas de una estrofa posterior: desplazadas');
  // Ritmo para una letra
  const r1 = Voice.rhythm(Spanish.syllables('a e i, o u a e i o u'), 3);
  eq(r1, [[0, 2, 4], [0, 2, 4, 6], [0, 2, 4]], 'ritmo: cada frase en sus compases');
  eq(Voice.rhythm(Spanish.syllables('la la la la la la la la la la'), 1).map((b) => b.length), [8], 'ritmo: como mucho 8 por compás');
  eq(Voice.rhythm(Spanish.syllables('la la la la la la la la la la'), 2).map((b) => b.length), [5, 5], 'ritmo: reparto parejo');
  eq(Voice.rhythm([], 3), [[], [], []], 'ritmo sin letra');
  const total = (r) => r.reduce((a, b) => a + b.length, 0);
  for (const n of [1, 3, 7, 12, 20, 33]) {
    const sy = Spanish.syllables(Array(n).fill('la').join(' '));
    for (const bars of [1, 2, 4, 8]) {
      const want = Math.min(n, bars * 8);
      if (total(Voice.rhythm(sy, bars)) !== want) eq(total(Voice.rhythm(sy, bars)), want, `ritmo: ${n} sílabas en ${bars} compases`);
    }
  }
  {
    const k = Theory.makeKey(0, 'ionian');
    const cs = Theory.harmonicField(k, 0).slice(0, 4);
    const rh = Voice.rhythm(Spanish.syllables('cie li to lin do, los o jos'), 4);
    const gen = Melody.generate(cs, k, Melody.seeded(3), rh);
    eq(gen.map((bar) => bar.map((x, s) => (x === null ? -1 : s)).filter((s) => s >= 0)), rh, 'generador: respeta el ritmo de la letra');
  }
  // Segunda voz y fuerza
  {
    const C = Theory.makeKey(0, 'ionian');
    const Am = Theory.makeKey(9, 'aeolian');
    eq([0, 2, 4, 5, 7, 9, 11].map((o) => Voice.harmonize(o, C, 'above3')), [4, 5, 7, 9, 11, 12, 14], 'terceras arriba en Do mayor');
    eq([0, 4, 7].map((o) => Voice.harmonize(o, C, 'below3')), [-3, 0, 4], 'terceras abajo');
    eq([0, 4, 7].map((o) => Voice.harmonize(o, C, 'below6')), [-8, -5, -1], 'sextas abajo');
    eq(Voice.harmonize(0, Am, 'above3'), 3, 'en La menor la tercera de la tónica es menor');
    eq(Voice.harmonize(1, C, 'above3'), 5, 'una nota cromática conserva su alteración');
    eq([Voice.pressureFor(55), Voice.pressureFor(55, 'f') > Voice.pressureFor(55), Voice.pressureFor(55, 'p') < Voice.pressureFor(55)], [8.95, true, true], 'fuerza y su intensidad por estrofa');
    eq([Voice.pressureFor(0, 'p'), Voice.pressureFor(100, 'f')], [3.5, 14], 'fuerza acotada');
    const pairs2 = al.pairs.map((p) => ({ ...p, harmonyMidi: p.syl ? p.midi + 4 : null }));
    const r2 = Voice.request({ pairs: pairs2, bpm: 120, swing: 50, body: 'female', vibrato: 30, breath: .1, bright: .2, force: 55,
      stanzas: [{ bars: 1, dyn: 'p' }, { bars: 1, dyn: 'f' }], harmony: { body: 'male' } });
    eq(r2.source.pressure, Voice.pressureFor(55, 'p'), 'la primera estrofa fija la fuerza inicial');
    eq(r2.events, [{ t: Voice.LEAD - 0.2 + 2, source: { pressure: Voice.pressureFor(55, 'f') } }], 'la segunda estrofa cambia la fuerza antes de su compás');
    eq([r2.harmony.body, r2.harmony.notes.map((n) => [n.midi, n.syl ? n.syl.text : null])],
      [{ female: 0, child: 0 }, [[64, 'la'], [66, 'lu'], [0, null], [68, 'na'], [0, null]]], 'segunda voz: mismas sílabas y tiempos, otras notas');
    const noHarm = Voice.request({ pairs: al.pairs, bpm: 120, swing: 50, body: 'female', vibrato: 30, breath: .1, bright: .2, harmony: { body: 'male' } });
    eq('harmony' in noHarm, false, 'sin notas de segunda voz no se pide');
  }
  eq([Voice.vibratoRate(90).per, Voice.vibratoRate(60).per], [4, 6], 'vibrato al compás');
  for (let bpm = 50; bpm <= 180; bpm += 2) {
    const r = Voice.vibratoRate(bpm).rate;
    if (r < 4.5 || r > 7.5) eq(r, 'entre 4,5 y 7,5', 'vibrato fuera de rango a ' + bpm);
  }
}

print(`${passed} correctas, ${failed} fallidas`);
if (failed) throw new Error('pruebas fallidas');
