// Voz cantada: reparte la letra sobre las notas de la melodía y pide al motor
// CHIMERA (WebAssembly, en un Worker) que la cante. El motor renderiza la
// canción entera de una vez; la app reproduce el resultado sincronizado.
(function () {
  'use strict';
  const M = globalThis.Melody;

  const RATE = 32000;   // el motor simula a ≥ 60 kHz por dentro; 32 kHz basta para la voz
  const LEAD = 0.4;     // s antes del primer tiempo: las consonantes llegan antes del pulso
  const BODIES = {
    male: { name: 'Hombre', mix: { female: 0, child: 0 }, center: 52 },
    female: { name: 'Mujer', mix: { female: 1, child: 0 }, center: 64 },
    child: { name: 'Niño', mix: { female: 0, child: 1 }, center: 67 },
  };

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
  function request({ pairs, bpm, swing, body, vibrato, breath, bright }) {
    const beats = (a, b) => M.spanMs(a, b, swing, 0.5);
    const notes = [];
    let cursor = 0;
    for (const p of pairs) {
      if (p.g > cursor) notes.push({ midi: 0, beats: beats(cursor, p.g) });
      const n = { midi: p.midi, beats: beats(p.g, p.g + p.len) };
      if (p.syl) n.syl = globalThis.Spanish.toChimera(p.syl);
      notes.push(n);
      cursor = p.g + p.len;
    }
    return {
      sampleRate: RATE,
      body: BODIES[body].mix,
      bpm,
      t0: LEAD,
      vibrato,
      tail: 0.5,
      source: { breathiness: breath, brightness: bright, vibratoRate: vibratoRate(bpm).rate },
      notes,
    };
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
        if (job !== id) return; // llegó otra petición: esta ya no interesa
      }
      post({ id, samples: out }, [out.buffer]);
    };
  }

  let handle = null;
  let nextId = 0;
  const jobs = new Map();

  function receive(msg) {
    const job = jobs.get(msg.id);
    if (!job) return;
    if (msg.progress !== undefined) job.onProgress(msg.progress);
    else {
      jobs.delete(msg.id);
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve({ samples: msg.samples, sampleRate: RATE });
    }
  }

  function start() {
    const b64 = globalThis.VOZ_WASM;
    const raw = atob(b64);
    const wasm = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) wasm[i] = raw.charCodeAt(i);
    if (typeof Worker === 'function') {
      try {
        const src = `const handle = (${engine.toString()})((m, t) => postMessage(m, t || []));\nonmessage = (e) => handle(e.data);`;
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = (e) => receive(e.data);
        w.postMessage({ wasm: wasm.buffer }, [wasm.buffer]);
        return (d) => w.postMessage(d);
      } catch (e) { /* sin Worker: hilo principal */ }
    }
    const h = engine((m) => receive(m));
    h({ wasm });
    return h;
  }

  const supported = () => typeof WebAssembly === 'object' && typeof globalThis.VOZ_WASM === 'string';

  // Devuelve una promesa con las muestras. Una petición nueva deja sin efecto la anterior.
  function render(req, onProgress = () => {}) {
    if (!handle) handle = start();
    jobs.forEach((job) => job.reject(new Error('cancelada')));
    jobs.clear();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      jobs.set(id, { resolve, reject, onProgress });
      handle({ id, json: JSON.stringify(req) });
    });
  }

  globalThis.Voice = { RATE, LEAD, BODIES, notesOf, rhythm, autoOctave, vibratoRate, align, request, render, supported };
})();
