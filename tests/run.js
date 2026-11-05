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

print(`${passed} correctas, ${failed} fallidas`);
if (failed) throw new Error('pruebas fallidas');
