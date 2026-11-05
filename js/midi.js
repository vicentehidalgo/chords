// Salida MIDI (Web MIDI API). Lleva la cuenta de las notas que suenan para que
// parar nunca deje una nota colgada en el instrumento.
(function () {
  'use strict';

  const NOTE_ON = 0x90;
  const NOTE_OFF = 0x80;
  const CC = 0xB0;
  const ALL_SOUND_OFF = 120;
  const ALL_NOTES_OFF = 123;
  // Mayor que el margen con que se programan las notas: un note-on ya enviado
  // al sistema puede sonar después de pulsar parar.
  const STOP_GUARD_MS = 250;
  const FLUSH_AHEAD_MS = 150;

  let access = null;
  let output = null;
  let onChange = () => {};
  const offs = new Map(); // "canal:nota" → instante del note-off pendiente

  const now = () => globalThis.performance.now();
  const supported = () => typeof globalThis.navigator?.requestMIDIAccess === 'function';

  const list = () => (access ? [...access.outputs.values()].filter((o) => o.state !== 'disconnected') : []);

  function select(id) {
    const next = list().find((o) => o.id === id) || null;
    if (output && output !== next) silence();
    output = next;
    return output;
  }

  async function connect(preferredId) {
    access = await globalThis.navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = () => {
      // Si se desconecta el instrumento, se olvida: no hay a quién enviarle nada.
      if (output && !list().includes(output)) {
        output = null;
        offs.clear();
      }
      onChange();
    };
    const all = list();
    select((all.find((o) => o.id === preferredId) || all[0] || {}).id);
    return all;
  }

  function send(bytes, at) {
    if (!output) return;
    if (at === undefined) output.send(bytes);
    else output.send(bytes, at);
  }

  // channel: 1-16. at: instante en la escala de performance.now().
  function noteOn(channel, midi, velocity, at) {
    const key = channel + ':' + midi;
    // Repetir una nota con su note-off pendiente: se cierra antes para no perder el ataque.
    if (offs.has(key)) {
      send([NOTE_OFF | (channel - 1), midi, 0], Math.min(offs.get(key), at - 1));
      offs.delete(key);
    }
    send([NOTE_ON | (channel - 1), midi, velocity], at);
  }

  // Los note-off se retienen hasta el último momento: una vez entregados al
  // sistema no se pueden cancelar y cortarían una nota posterior.
  function flush() {
    if (!output) return;
    const limit = now() + FLUSH_AHEAD_MS;
    for (const [key, at] of offs) {
      if (at <= limit) {
        const [channel, midi] = key.split(':').map(Number);
        send([NOTE_OFF | (channel - 1), midi, 0], at);
        offs.delete(key);
      }
    }
  }

  function note(channel, midi, durMs, velocity = 100, at = now()) {
    if (!output) return;
    noteOn(channel, midi, velocity, at);
    offs.set(channel + ':' + midi, at + durMs);
  }

  function chord(channel, midis, durMs, velocity = 80, at = now(), strumMs = 0) {
    midis.forEach((m, i) => note(channel, m, durMs - i * strumMs, velocity, at + i * strumMs));
  }

  // Apaga lo que hay sonando. El segundo envío alcanza a los note-on en camino.
  function silence() {
    if (!output) return;
    const channels = new Set();
    for (const key of offs.keys()) {
      const [channel, midi] = key.split(':').map(Number);
      channels.add(channel);
      const off = [NOTE_OFF | (channel - 1), midi, 0];
      send(off);
      send(off, now() + STOP_GUARD_MS);
    }
    offs.clear();
    channels.forEach((channel) => {
      send([CC | (channel - 1), ALL_NOTES_OFF, 0]);
      send([CC | (channel - 1), ALL_NOTES_OFF, 0], now() + STOP_GUARD_MS);
    });
  }

  function panic() {
    if (!output) return;
    offs.clear();
    for (let c = 0; c < 16; c++) {
      send([CC | c, ALL_SOUND_OFF, 0]);
      send([CC | c, ALL_NOTES_OFF, 0]);
    }
  }

  globalThis.Midi = {
    supported, connect, list, select, note, chord, flush, silence, panic,
    get output() { return output; },
    get connected() { return access !== null; },
    set onChange(fn) { onChange = fn; },
    // Para las pruebas: enchufa una salida falsa sin pasar por el navegador.
    attach(fake) { output = fake; },
  };
})();
