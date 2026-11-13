// Voz cantada: reparte la letra sobre las notas de la melodía y pide al motor
// CHIMERA (WebAssembly, en un Worker) que la cante. El motor renderiza la
// canción entera de una vez; la app reproduce el resultado sincronizado.
(function () {
  'use strict';
  const M = globalThis.Melody;
  const { mod } = globalThis.Theory;

  const RATE = 32000;   // el motor simula a ≥ 60 kHz por dentro; 32 kHz basta para la voz
  const LEAD = 0.4;     // s antes del primer tiempo: las consonantes llegan antes del pulso
  const BODIES = {
    male: { name: 'Hombre', mix: { female: 0, child: 0 }, center: 52 },
    female: { name: 'Mujer', mix: { female: 1, child: 0 }, center: 64 },
    child: { name: 'Niño', mix: { female: 0, child: 1 }, center: 67 },
  };

  // Fuerza: presión del aire en los pulmones (cmH2O). Más presión, más volumen y
  // una voz más empujada. Cada estrofa puede ir más suave o más fuerte.
  const DYNAMICS = { p: { name: 'Suave', delta: -2.5 }, mf: { name: 'Normal', delta: 0 }, f: { name: 'Fuerte', delta: 2.5 } };
  const pressureFor = (force, dyn = 'mf') => Math.min(14, Math.max(3.5, 4 + 9 * force / 100 + DYNAMICS[dyn || 'mf'].delta));

  // Segunda voz paralela dentro de la escala, a una distancia en grados.
  const HARMONY = {
    above3: { name: '3ª arriba', steps: 2 },
    below3: { name: '3ª abajo', steps: -2 },
    below6: { name: '6ª abajo', steps: -5 },
  };

  // off: semitonos desde la tónica. Una nota cromática se armoniza desde la nota
  // de la escala de debajo y conserva su alteración.
  function harmonize(off, key, mode) {
    const steps = HARMONY[mode].steps;
    const inScale = (o) => key.pcs.has(mod(key.pc + o));
    let base = off;
    while (!inScale(base)) base--;
    let o = base;
    for (let n = Math.abs(steps); n > 0;) {
      o += Math.sign(steps);
      if (inScale(o)) n--;
    }
    return o + (off - base);
  }

  // Notas de una melodía (un array de 8 pasos por compás), en orden. Cada una dura
  // hasta la siguiente o el final del compás. offset: compases desde el principio.
  function notesOf(bars, offset = 0) {
    const out = [];
    bars.forEach((mel, i) => {
      for (let s = 0; s < M.STEPS; s++) {
        const off = mel[s];
        if (off === null || off === undefined) continue;
        let len = 1;
        while (s + len < M.STEPS && (mel[s + len] === null || mel[s + len] === undefined)) len++;
        out.push({ i, s, g: (offset + i) * M.STEPS + s, len, off });
      }
    });
    return out;
  }

  // Octava que deja la melodía en la zona cómoda de cada voz.
  function autoOctave(midis, body) {
    if (!midis.length) return 0;
    const sorted = midis.slice().sort((a, b) => a - b);
    const mid = (sorted[0] + sorted[sorted.length - 1]) / 2;
    return Math.round((BODIES[body].center - mid) / 12);
  }

  // Vibrato al compás: el múltiplo del pulso más cercano a 6 Hz (entre 4,5 y 7,5).
  function vibratoRate(bpm) {
    const beat = bpm / 60;
    let best = { rate: 6, per: 0 };
    for (let k = 1; k <= 12; k++) {
      const rate = beat * k;
      if (rate >= 4.5 && rate <= 7.5 && (best.per === 0 || Math.abs(rate - 6) < Math.abs(best.rate - 6))) best = { rate, per: k };
    }
    return best;
  }

  // Ritmo para una letra: cuántas sílabas van en cada compás y en qué pasos.
  // Cada frase (hasta una respiración) ocupa compases enteros, si caben.
  const PATTERNS = [[], [0], [0, 4], [0, 2, 4], [0, 2, 4, 6], [0, 2, 3, 4, 6],
    [0, 1, 2, 4, 5, 6], [0, 1, 2, 3, 4, 6, 7], [0, 1, 2, 3, 4, 5, 6, 7]];

  function rhythm(sylls, bars) {
    const out = Array.from({ length: bars }, () => []);
    if (!bars || !sylls.length) return out;
    const phrases = [];
    let cur = 0;
    sylls.forEach((s, k) => { cur++; if (s.phraseEnd || k === sylls.length - 1) { phrases.push(cur); cur = 0; } });
    const counts = Array(bars).fill(0);
    const spread = (n, from, to) => {
      // n sílabas repartidas entre los compases [from, to), sin pasar de 8 por compás.
      const len = to - from;
      for (let b = 0; b < len; b++) counts[from + b] += Math.floor(n / len) + (b < n % len ? 1 : 0);
    };
    if (phrases.length <= bars) {
      const total = sylls.length;
      let at = 0;
      phrases.forEach((n, k) => {
        const left = phrases.length - k - 1;
        let size = k === phrases.length - 1 ? bars - at : Math.max(1, Math.round((n / total) * bars));
        size = Math.min(size, bars - at - left);
        spread(n, at, at + size);
        at += size;
      });
    } else spread(sylls.length, 0, bars);
    // Lo que no quepa en un compás pasa al siguiente.
    for (let b = 0; b < bars; b++) {
      if (counts[b] > M.STEPS) {
        if (b + 1 < bars) counts[b + 1] += counts[b] - M.STEPS;
        counts[b] = M.STEPS;
      }
    }
    return counts.map((n) => PATTERNS[n].slice());
  }

  // Qué sílaba canta cada nota. Sobran sílabas o notas: se informa, no se fuerza.
  function align(notes, sylls) {
    return {
      pairs: notes.map((n, k) => ({ ...n, syl: k < sylls.length ? sylls[k] : null })),
      extraSyllables: sylls.slice(notes.length),
      extraNotes: Math.max(0, notes.length - sylls.length),
    };
  }

  // La petición al motor: notas en pulsos (con el swing ya aplicado) y silencios.
  // stanzas: [{ bars, dyn, harmony }] en orden; harmony: { body, mode, midiOf } o null.
  // Cada par puede traer harmonyMidi (la nota de la segunda voz) o no cantarla.
  function request({ pairs, bpm, swing, body, vibrato, breath, bright, force = 55, stanzas = [], harmony = null }) {
    const beats = (a, b) => M.spanMs(a, b, swing, 0.5);
    const toNotes = (midiOf) => {
      const notes = [];
      let cursor = 0;
      for (const p of pairs) {
        if (p.g > cursor) notes.push({ midi: 0, beats: beats(cursor, p.g) });
        const midi = midiOf(p);
        const n = { midi: midi || 0, beats: beats(p.g, p.g + p.len) };
        // Las sílabas del español se guardan con el IPA en texto; las del inglés ya vienen del motor.
        if (p.syl && midi) n.syl = typeof p.syl.nucleus === 'string' ? globalThis.Spanish.toChimera(p.syl) : p.syl;
        notes.push(n);
        cursor = p.g + p.len;
      }
      return notes;
    };
    // La fuerza de cada estrofa entra un poco antes de su primer compás.
    const events = [];
    let bar = 0;
    stanzas.forEach((st, k) => {
      if (k > 0) events.push({ t: Math.max(0, LEAD - 0.2 + bar * 4 * 60 / bpm), source: { pressure: pressureFor(force, st.dyn) } });
      bar += st.bars;
    });
    const req = {
      sampleRate: RATE,
      body: BODIES[body].mix,
      bpm,
      t0: LEAD,
      vibrato,
      tail: 0.5,
      source: { breathiness: breath, brightness: bright, vibratoRate: vibratoRate(bpm).rate, pressure: pressureFor(force, stanzas[0] && stanzas[0].dyn) },
      notes: toNotes((p) => p.midi),
      events,
    };
    if (harmony && pairs.some((p) => p.syl && p.harmonyMidi)) {
      req.harmony = { body: BODIES[harmony.body].mix, notes: toNotes((p) => p.harmonyMidi) };
    }
    return req;
  }

  // Motor -------------------------------------------------------------------
  // El mismo código corre en el Worker o, si no hay Worker, en el hilo principal.
  function engine(post) {
    let x = null;
    let job = 0;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return async function handle(d) {
      if (d.wasm) {
        x = new WebAssembly.Instance(new WebAssembly.Module(d.wasm), {}).exports;
        return;
      }
      if (d.cancel !== undefined) {
        if (job === d.cancel) job = 0;
        return;
      }
      const id = d.id;
      job = id;
      const bytes = new TextEncoder().encode(d.json);
      const ip = x.voz_input(bytes.length);
      new Uint8Array(x.memory.buffer, ip, bytes.length).set(bytes);
      const total = x.voz_start();
      if (total < 0) {
        const p = x.voz_error_ptr();
        post({ id, error: new TextDecoder().decode(new Uint8Array(x.memory.buffer, p, x.voz_error_len()).slice()) });
        return;
      }
      // Una voz por trabajo: la segunda voz se encarga como un trabajo aparte.
      const out = new Float32Array(total);
      let done = 0;
      while (done < total) {
        const n = x.voz_render(8192);
        if (!n) break;
        const op = x.voz_output();
        out.set(new Float32Array(x.memory.buffer, op, n), done);
        done += n;
        post({ id, progress: done / total });
        await tick();
        if (job !== id) { post({ id, cancelled: true }); return; } // ya no interesa
      }
      post({ id, samples: out }, [out.buffer]);
    };
  }

  // Varios motores en paralelo, uno por núcleo libre (hasta 4). Cada trozo de la
  // canción (una estrofa de una voz) es un trabajo; se reparten según quedan libres.
  const slots = [];
  const queue = [];
  let nextId = 0;

  function wasmBytes() {
    const raw = atob(globalThis.VOZ_WASM);
    const wasm = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) wasm[i] = raw.charCodeAt(i);
    return wasm;
  }

  function makeSlot() {
    const slot = { job: null, send: null };
    const onMsg = (msg) => {
      const job = slot.job;
      if (!job || job.id !== msg.id) return;
      if (msg.progress !== undefined) { job.onProgress(msg.progress); return; }
      slot.job = null;
      if (msg.error) job.reject(new Error(msg.error));
      else if (msg.cancelled) job.reject(new Error('cancelada'));
      else job.resolve({ samples: msg.samples, sampleRate: RATE });
      pump();
    };
    if (typeof Worker === 'function') {
      try {
        const src = `const handle = (${engine.toString()})((m, t) => postMessage(m, t || []));\nonmessage = (e) => handle(e.data);`;
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = (e) => onMsg(e.data);
        const wasm = wasmBytes();
        w.postMessage({ wasm: wasm.buffer }, [wasm.buffer]);
        slot.send = (d) => w.postMessage(d);
        return slot;
      } catch (e) { /* sin Worker: hilo principal */ }
    }
    const h = engine(onMsg);
    h({ wasm: wasmBytes() });
    slot.send = h;
    return slot;
  }

  function ensureSlots() {
    if (slots.length) return;
    const cores = (globalThis.navigator && navigator.hardwareConcurrency) || 2;
    const n = typeof Worker === 'function' ? Math.max(1, Math.min(4, cores - 1)) : 1;
    for (let i = 0; i < n; i++) slots.push(makeSlot());
  }

  function pump() {
    for (const slot of slots) {
      if (slot.job || !queue.length) continue;
      const job = queue.shift();
      slot.job = job;
      slot.send({ id: job.id, json: job.json });
    }
  }

  // Encarga un trozo. Devuelve { promise, cancel }; cancelar lo saca de la cola o lo corta.
  function job(req, onProgress = () => {}) {
    if (!supported()) return { promise: Promise.reject(new Error('sin motor')), cancel() {} };
    ensureSlots();
    const id = ++nextId;
    let entry;
    const promise = new Promise((resolve, reject) => {
      entry = { id, json: JSON.stringify(req), resolve, reject, onProgress };
    });
    queue.push(entry);
    pump();
    return {
      promise,
      cancel() {
        const q = queue.indexOf(entry);
        if (q >= 0) { queue.splice(q, 1); entry.reject(new Error('cancelada')); return; }
        const slot = slots.find((x) => x.job === entry);
        if (slot) slot.send({ cancel: id });
      },
    };
  }

  const workers = () => { ensureSlots(); return slots.length; };

  // Inglés: el motor convierte la letra en sílabas con el diccionario CMU. Corre en
  // el hilo principal (la interfaz cuenta las sílabas al escribir); el diccionario
  // se descomprime una vez, al pasar al inglés.
  let main = null;
  let dict = null; // promesa de la carga

  function mainEngine() {
    if (!main) {
      const raw = atob(globalThis.VOZ_WASM);
      const wasm = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) wasm[i] = raw.charCodeAt(i);
      main = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports;
    }
    return main;
  }

  function writeInput(x, bytes) {
    const ip = x.voz_input(bytes.length);
    new Uint8Array(x.memory.buffer, ip, bytes.length).set(bytes);
  }

  function english(text) {
    if (!supported() || !String(text).trim()) return [];
    const x = mainEngine();
    writeInput(x, new TextEncoder().encode(text));
    const n = x.voz_english();
    const p = x.voz_result_ptr();
    return JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, p, n).slice()));
  }

  // Sin el diccionario se usan reglas de letra a sonido, peores pero inmediatas.
  function loadDict() {
    if (dict) return dict;
    dict = (async () => {
      // El diccionario (1,2 MB) solo se trae si hace falta.
      if (typeof globalThis.CMUDICT_GZ !== 'string') {
        await new Promise((resolve, reject) => {
          const tag = document.createElement('script');
          tag.src = 'js/cmudict.js';
          tag.onload = resolve;
          tag.onerror = () => reject(new Error('sin diccionario'));
          document.head.appendChild(tag);
        });
      }
      const raw = atob(globalThis.CMUDICT_GZ);
      const gz = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) gz[i] = raw.charCodeAt(i);
      const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      const x = mainEngine();
      writeInput(x, bytes);
      x.voz_dict_load();
    })();
    return dict;
  }

  const supported = () => typeof WebAssembly === 'object' && typeof globalThis.VOZ_WASM === 'string';

  globalThis.Voice = { RATE, LEAD, BODIES, DYNAMICS, HARMONY, pressureFor, harmonize, notesOf, rhythm, english, loadDict, autoOctave, vibratoRate, align, request, job, workers, supported };
})();
