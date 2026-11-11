// Interfaz: guarda el estado, dibuja las secciones y atiende los clics.
(function () {
  'use strict';
  const T = globalThis.Theory;
  const { suggest, presetsFor, originLabel } = globalThis.Suggest;
  const V = globalThis.Voicings;
  const D = globalThis.Diagrams;
  const M = globalThis.Melody;
  const { Sound, Midi, Drums, Voice, Spanish } = globalThis;
  const { mod } = T;
  const $ = (id) => document.getElementById(id);

  const STORE = 'enlace.v1';
  const DEFAULTS = {
    tonic: 0, scale: 'ionian', level: 0, instrument: 'guitar', notation: 'latin',
    outside: true, smooth: true, bpm: 88, loop: true, playChords: true, playMelody: true,
    tab: 'chords', swing: 50, comp: 'whole', midiOn: false, midiOut: null,
    sendChords: true, sendMelody: true, sendDrums: true,
    midiChordCh: 1, midiMelodyCh: 2, midiDrumCh: 10, localSound: true,
    rings: [], life: 0, playDrums: true,
    stanza: 0, voiceBody: 'female', accent: 'es', octave: 'auto',
    vibrato: 35, breath: 15, bright: 25, voiceVol: 80, playVoice: true,
    prog: [],
  };
  const state = { ...DEFAULTS };
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORE) || '{}'));
  } catch (e) { /* sin almacenamiento: se usan los valores por defecto */ }
  // Versiones anteriores guardaban una sola opción de envío MIDI.
  if (state.midiSend) {
    state.sendChords = state.midiSend !== 'melody';
    state.sendMelody = state.midiSend !== 'chords';
    delete state.midiSend;
  }

  // La letra pasó a estar por estrofas, cada una con su melodía para la voz.
  // Antes la voz cantaba la melodía instrumental: se copia para no perder nada.
  if (!Array.isArray(state.stanzas) || !state.stanzas.length) {
    state.stanzas = [{ lyrics: state.lyrics || '' }];
    if (state.lyrics) state.prog.forEach((it) => { if (!it.vmel) it.vmel = [it.mel.slice()]; });
  }
  delete state.lyrics;

  // Estado que no se guarda.
  const ui = {
    sel: state.prog.length - 1, preview: null, previewG: 0, previewP: 0,
    more: false, undo: [], seed: Date.now() % 100000, cursor: null, playing: null, midiError: null,
    voice: { key: null, status: 'idle', progress: 0 }, voiceTimer: 0,
  };

  let key;
  let catalog;
  let chords;
  let voicings;

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignorar */ }
    // Cualquier cambio puede afectar a lo que canta la voz: se vuelve a cantar si hace falta.
    refreshVoice();
  }

  function snapshot() {
    ui.undo.push(JSON.stringify({ prog: state.prog, sel: ui.sel, rings: state.rings, stanzas: state.stanzas, stanza: state.stanza }));
    if (ui.undo.length > 60) ui.undo.shift();
  }

  // Los acordes se guardan por grado, de modo que cambiar de tónica los transporta.
  function hydrate(item) {
    const root = T.note(key.tonic.l + item.off, key.pc + item.semi);
    const probe = T.makeChord(root, item.q, key);
    if (catalog.has(probe.id)) return catalog.get(probe.id);
    return T.fitsScale(probe, key) ? probe : T.makeChord(root, item.q, key, { kind: 'outside' });
  }

  function itemFrom(chord) {
    return {
      off: mod(chord.root.l - key.tonic.l, 7),
      semi: mod(chord.root.pc - key.pc),
      q: chord.q.id,
      mel: Array(M.STEPS).fill(null),
      g: null, p: null,
    };
  }

  function recompute() {
    key = T.makeKey(state.tonic, state.scale);
    catalog = new Map();
    T.harmonicField(key, state.level).forEach((c) => catalog.set(c.id, c));
    // Los acordes de la escala de otros niveles también cuentan como propios.
    [0, 1, 2].forEach((lv) => T.harmonicField(key, lv).forEach((c) => { if (!catalog.has(c.id)) catalog.set(c.id, c); }));
    T.outsideChords(key, state.level).forEach((c) => { if (!catalog.has(c.id)) catalog.set(c.id, c); });
    chords = state.prog.map(hydrate);
    voicings = computeVoicings();
  }

  function computeVoicings() {
    let g = null;
    let p = null;
    return chords.map((c, i) => {
      const it = state.prog[i];
      const gl = V.guitarVoicings(c);
      const pl = V.pianoVoicings(c);
      const gi = clampIdx(it.g !== null ? it.g : state.smooth ? V.pickGuitar(c, g) : 0, gl);
      const pi = clampIdx(it.p !== null ? it.p : state.smooth ? V.pickPiano(c, p) : 0, pl);
      g = gl[gi] || g;
      p = pl[pi] || p;
      return { g: gl[gi], p: pl[pi], gi, pi };
    });
  }
  const clampIdx = (i, list) => Math.max(0, Math.min(i, list.length - 1));

  // Utilidades de texto ------------------------------------------------------

  const noteLabel = (n) => T.noteName(n, state.notation);

  function nameHTML(c) {
    const n = T.chordName(c, state.notation);
    const acc = (s) => s.replace(/[♯♭]+/g, '<span class="acc">$&</span>');
    return `<span class="cname">${acc(n.root)}<small>${acc(n.suffix)}</small></span>`;
  }

  function pcLabel(pc) {
    const inScale = key.notes.find((n) => n.pc === pc);
    if (inScale) return noteLabel(inScale);
    const flatKey = key.notes.some((n) => n.l !== undefined && noteLabel(n).includes('♭'));
    const cands = T.tonicCandidates(pc);
    const pick = cands.find((n) => T.noteName(n, 'intl').includes(flatKey ? '♭' : '♯')) || cands[0];
    return noteLabel(pick);
  }

  const FN_LABEL = { T: 'Tónica', S: 'Subdominante', D: 'Dominante', M: 'Color modal' };

  function chordLabel(c) {
    return `${T.chordText(c, state.notation)}, ${c.q.label}`;
  }

  // Diagramas de un acorde según el instrumento activo ----------------------

  function pianoFor(v, c, labels) {
    if (!v) return '';
    const marks = new Map();
    v.midis.forEach((m) => {
      const pc = mod(m);
      const tone = c.tones.find((t) => t.pc === pc);
      marks.set(m, {
        cls: pc === c.root.pc ? 'is-root' : 'is-tone',
        label: labels && tone ? noteLabel(tone).replace(/(Do|Re|Mi|Fa|Sol|La|Si)/, (x) => x.slice(0, 2)) : '',
      });
    });
    const [start, end] = D.pianoRange(v.midis);
    return D.piano(start, end, marks, { label: 'Teclado: ' + chordLabel(c) });
  }

  function diagramsFor(c, g, p, big) {
    const out = [];
    if (state.instrument !== 'piano') out.push(`<div class="dg g">${D.guitar(g, c.root.pc, { fingers: big, label: 'Guitarra: ' + chordLabel(c) })}</div>`);
    if (state.instrument !== 'guitar') out.push(`<div class="dg p">${pianoFor(p, c, big)}</div>`);
    return out.join('');
  }

  // Controles ------------------------------------------------------------------

  function seg(act, options, value) {
    return `<div class="seg" role="group">${options.map(([v, label]) =>
      `<button data-act="${act}" data-v="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join('')}</div>`;
  }

  function renderControls() {
    const tonics = [...Array(12).keys()].map((pc) => {
      const cands = T.tonicCandidates(pc);
      const natural = cands.filter((n) => !/[♯♭]/.test(T.noteName(n, 'intl')));
      const names = (natural.length ? natural : cands).map((n) => T.noteName(n, state.notation));
      return `<option value="${pc}" ${pc === state.tonic ? 'selected' : ''}>${names.join(' / ')}</option>`;
    }).join('');
    const groups = [...new Set(T.SCALES.map((s) => s.group))];
    const scales = groups.map((g) => `<optgroup label="${g}">${T.SCALES.filter((s) => s.group === g)
      .map((s) => `<option value="${s.id}" ${s.id === state.scale ? 'selected' : ''}>${s.name}</option>`).join('')}</optgroup>`).join('');

    $('controls').innerHTML = `
      <select id="c-tonic" aria-label="Tónica">${tonics}</select>
      <select id="c-scale" class="wide" aria-label="Escala o modo">${scales}</select>
      ${seg('level', [[0, 'Tríadas'], [1, 'Con 7ª'], [2, 'Todos']], state.level)}
      ${seg('instrument', [['guitar', 'Guitarra'], ['piano', 'Piano'], ['both', 'Ambos']], state.instrument)}`;
    $('options').innerHTML = `
      <div class="field"><span>Notas</span>${seg('notation', [['latin', 'Do Re Mi'], ['intl', 'C D E']], state.notation)}</div>
      <label class="check"><input type="checkbox" id="c-outside" ${state.outside ? 'checked' : ''}> Sugerir fuera de escala</label>
      <label class="check"><input type="checkbox" id="c-smooth" ${state.smooth ? 'checked' : ''}> Enlazar posiciones</label>`;
    $('c-tonic').onchange = (e) => { stop(); state.tonic = Number(e.target.value); ui.preview = null; update(); };
    $('c-scale').onchange = (e) => { stop(); state.scale = e.target.value; ui.preview = null; update(); };
    $('c-outside').onchange = (e) => { state.outside = e.target.checked; update(); };
    $('c-smooth').onchange = (e) => { state.smooth = e.target.checked; update(); };
  }

  // Progresión -----------------------------------------------------------------

  function renderStrip() {
    const cards = chords.map((c, i) => {
      const v = voicings[i];
      const outside = c.origin.kind !== 'scale';
      return `<article class="pc ${i === ui.sel ? 'is-sel' : ''} fn-${c.fn} ${outside ? 'is-out' : ''}" data-i="${i}">
        <button class="pc-main" data-act="select" data-i="${i}" aria-label="Seleccionar ${chordLabel(c)}">
          <span class="roman">${c.roman}</span>${nameHTML(c)}
          <span class="pc-dg">${diagramsFor(c, v.g, v.p, false)}</span>
        </button>
        <button class="x" data-act="remove" data-i="${i}" aria-label="Quitar ${T.chordText(c, state.notation)}">×</button>
      </article>`;
    }).join('');

    const empty = `<div class="empty">
        <p><strong>Empieza por un acorde.</strong> Elige uno abajo o carga una progresión de ${key.scale.name.toLowerCase()}:</p>
        <div class="chips">${presetButtons().slice(0, 4).join('') || '<span class="muted">Elige la tónica en «Siguiente acorde».</span>'}</div>
      </div>`;

    $('strip').innerHTML = `<div class="pcs">${chords.length ? cards : empty}</div>`;
    renderTransport();
  }

  function renderTransport() {
    $('transport').innerHTML = `
      <button class="primary" data-act="play" ${canPlay() ? '' : 'disabled'}>${ui.playing ? '■ Parar' : '▶ Reproducir'}</button>
      <label class="bpm">${state.bpm} ppm <input type="range" id="c-bpm" min="50" max="180" step="2" value="${state.bpm}" aria-label="Tempo"></label>
      <label class="bpm">Swing <input type="range" id="c-swing" min="50" max="75" step="1" value="${state.swing}" aria-label="Swing"> <span id="swing-value">${swingLabel()}</span></label>
      <select id="c-comp" aria-label="Ritmo de los acordes">${Object.entries(M.COMP).map(([id, c]) =>
        `<option value="${id}" ${id === state.comp ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
      <button data-act="toggle-loop" aria-pressed="${state.loop}">Bucle</button>
      <button data-act="undo" ${ui.undo.length ? '' : 'disabled'}>Deshacer</button>
      <button data-act="clear" ${chords.length ? '' : 'disabled'}>Vaciar</button>`;
    $('c-bpm').oninput = (e) => {
      state.bpm = Number(e.target.value);
      e.target.parentElement.firstChild.textContent = state.bpm + ' ppm ';
      save();
      if (state.tab === 'voice') renderVoice();
    };
    $('c-swing').oninput = (e) => {
      state.swing = Number(e.target.value);
      $('swing-value').textContent = swingLabel();
      updateSwingHint();
      save();
      if (state.tab === 'voice') renderVoice();
    };
    $('c-comp').onchange = (e) => { state.comp = e.target.value; updateSwingHint(); save(); };
    updateSwingHint();
  }

  const swingLabel = () => (state.swing === 50 ? 'recto' : state.swing + '%');

  // Con golpes solo en partes fuertes el swing no altera los acordes: se avisa.
  function updateSwingHint() {
    const onBeats = M.COMP[state.comp].hits.every((s) => s % 2 === 0);
    $('c-comp').title = state.swing > 50 && onBeats
      ? 'Este ritmo no tiene contratiempos: el swing solo se oirá en la melodía'
      : 'Ritmo de los acordes';
    $('c-comp').classList.toggle('needs-offbeat', state.swing > 50 && onBeats);
  }

  // Sugerencias ----------------------------------------------------------------

  function dedupe(list, perRoot) {
    const counts = new Map();
    return list.filter((s) => {
      const n = counts.get(s.chord.root.pc) || 0;
      counts.set(s.chord.root.pc, n + 1);
      return n < perRoot;
    });
  }

  function suggestionCard(s, currentV) {
    const c = s.chord;
    const g = V.guitarVoicings(c);
    const p = V.pianoVoicings(c);
    const gv = g[state.smooth ? V.pickGuitar(c, currentV && currentV.g) : 0];
    const pv = p[state.smooth ? V.pickPiano(c, currentV && currentV.p) : 0];
    const origin = originLabel(c);
    return `<article class="sg fn-${c.fn}">
      <button class="sg-main" data-act="add" data-id="${c.id}" aria-label="Añadir ${chordLabel(c)}">
        <span class="sg-head">
          <span class="roman">${c.roman}</span>${nameHTML(c)}
          <span class="meter" title="Encaje ${s.score} de 100"><i style="width:${s.score}%"></i></span>
        </span>
        ${origin ? `<span class="origin">${origin}</span>` : ''}
        <span class="sg-body">
          <span class="why">${s.reasons.slice(0, 2).map((r) => `<span class="r-${r.kind}">${r.text}</span>`).join('')}</span>
          <span class="sg-dg">${diagramsFor(c, gv, pv, false)}</span>
        </span>
      </button>
      <button class="hear" data-act="preview" data-id="${c.id}" aria-label="Escuchar y ver ${T.chordText(c, state.notation)}">▶</button>
    </article>`;
  }

  function renderNext() {
    const sel = ui.sel;
    const history = chords.slice(Math.max(0, sel - 2), sel + 1);
    const nextChord = chords[sel + 1] || null;
    const inside = [...catalog.values()].filter((c) => c.origin.kind === 'scale' && levelAllows(c));
    const outside = state.outside ? [...catalog.values()].filter((c) => c.origin.kind !== 'scale') : [];

    const args = { key, history, next: nextChord, notation: state.notation };
    const a = dedupe(suggest({ ...args, candidates: inside }), state.level === 2 ? 2 : 1);
    const b = dedupe(suggest({ ...args, candidates: outside }), 1);
    const currentV = voicings[sel];

    const nIn = ui.more ? a.length : Math.min(a.length, 6);
    const nOut = ui.more ? 8 : 2;
    const current = chords[sel];
    const title = current
      ? `Después de ${nameHTML(current)}`
      : 'Para empezar';
    const insertNote = nextChord ? `<span class="muted"> · se inserta antes de ${T.chordText(nextChord, state.notation)}</span>` : '';

    $('next').innerHTML = `
      <div class="panel-head"><h2>${title}${insertNote}</h2>
        <div class="legend">${Object.entries(FN_LABEL).map(([k, v]) => `<span class="fn-${k}"><i></i>${v}</span>`).join('')}</div>
      </div>
      <div class="sgs">${a.slice(0, nIn).map((s) => suggestionCard(s, currentV)).join('')}</div>
      ${b.length ? `<h3>Fuera de la escala</h3><div class="sgs">${b.slice(0, nOut).map((s) => suggestionCard(s, currentV)).join('')}</div>` : ''}
      <button class="link" data-act="more">${ui.more ? 'Ver menos' : 'Ver más opciones'}</button>`;
  }

  function levelAllows(c) {
    if (state.level === 2) return true;
    if (!key.heptatonic) return true;
    return c.q.level === state.level;
  }

  // Detalle y notas para la melodía ------------------------------------------

  function focusChord() {
    if (ui.preview) {
      const c = ui.preview;
      const gl = V.guitarVoicings(c);
      const pl = V.pianoVoicings(c);
      return { c, g: gl[clampIdx(ui.previewG, gl)], p: pl[clampIdx(ui.previewP, pl)], gi: ui.previewG, pi: ui.previewP, gl, pl, preview: true };
    }
    if (ui.sel < 0 || !chords[ui.sel]) return null;
    const c = chords[ui.sel];
    const v = voicings[ui.sel];
    return { c, g: v.g, p: v.p, gi: v.gi, pi: v.pi, gl: V.guitarVoicings(c), pl: V.pianoVoicings(c), preview: false };
  }

  function roleGroups(c) {
    const pcs = [...new Set([...key.notes.map((n) => n.pc), ...c.pcs])];
    const groups = { safe: [], tension: [], avoid: [], out: [] };
    for (const pc of pcs) {
      const r = M.role(pc, c, key);
      const name = c.tones.find((t) => t.pc === pc);
      const label = name ? noteLabel(name) : pcLabel(pc);
      groups[r === 'root' || r === 'chord' ? 'safe' : r].push({ pc, label, r });
    }
    return groups;
  }

  function melodyMap(c) {
    const marks = new Map();
    const groups = roleGroups(c);
    const short = (s) => s.slice(0, s.length > 2 && /[♯♭]$/.test(s) ? 3 : 2);
    const cls = { root: 'is-root', chord: 'is-tone', tension: 'is-tension', avoid: 'is-avoid' };
    [...groups.safe, ...groups.tension, ...groups.avoid].forEach((n) => marks.set(n.pc, { cls: cls[n.r], label: state.notation === 'latin' ? short(n.label) : n.label }));
    const parts = [];
    if (state.instrument !== 'piano') {
      parts.push(`<div class="neck">${D.fretboard(marks, { frets: 12, label: 'Notas sobre el mástil' })}</div>`);
    }
    if (state.instrument !== 'guitar') {
      const midi = new Map();
      for (let m = 48; m <= 83; m++) if (marks.has(mod(m))) midi.set(m, marks.get(mod(m)));
      parts.push(`<div class="keys">${D.piano(48, 83, midi, { label: 'Notas sobre el teclado' })}</div>`);
    }
    return parts.join('');
  }

  function renderDetail() {
    const f = focusChord();
    if (!f) {
      $('detail').innerHTML = `<div class="panel-head"><h2>Escala</h2></div>
        <p class="muted">Notas de ${noteLabel(key.tonic)} ${key.scale.name.toLowerCase()}:</p>
        <p class="scale-notes">${key.notes.map((n) => `<span><b>${noteLabel(n)}</b><i>${n.deg.replace('b', '♭').replace('#', '♯')}</i></span>`).join('')}</p>`;
      return;
    }
    const { c } = f;
    const origin = originLabel(c);
    const nav = (act, i, len) => (len > 1 ? `<div class="vnav">
        <button data-act="${act}" data-d="-1" aria-label="Posición anterior">‹</button><span>${i + 1} / ${len}</span>
        <button data-act="${act}" data-d="1" aria-label="Posición siguiente">›</button></div>` : '');

    const big = [];
    if (state.instrument !== 'piano') {
      big.push(`<div class="big g">${D.guitar(f.g, c.root.pc, { label: 'Guitarra: ' + chordLabel(c) })}${nav('voice-g', f.gi, f.gl.length)}</div>`);
    }
    if (state.instrument !== 'guitar') {
      big.push(`<div class="big p">${pianoFor(f.p, c, true)}${nav('voice-p', f.pi, f.pl.length)}</div>`);
    }

    $('detail').innerHTML = `
      <div class="panel-head">
        <h2 class="detail-title">${nameHTML(c)} <span class="roman">${c.roman}</span></h2>
        <div class="row">
          <button data-act="hear-focus">▶ Escuchar</button>
          ${f.preview ? `<button class="primary" data-act="add" data-id="${c.id}">Añadir</button><button data-act="close-preview">Cerrar</button>` : ''}
        </div>
      </div>
      <p class="meta"><span class="tag fn-${c.fn}">${FN_LABEL[c.fn]}</span> ${c.q.label}${origin ? ' · ' + origin : ''}</p>
      <div class="detail-body">
        <p class="tones">${c.tones.map((t) => `<span><b>${noteLabel(t)}</b><i>${t.deg.replace('b', '♭').replace('#', '♯')}</i></span>`).join('')}</p>
        <div class="bigs">${big.join('')}</div>
      </div>`;
  }

  function renderMelodyMap() {
    const c = chords[ui.sel];
    if (!c) { $('melody-map').innerHTML = ''; return; }
    const groups = roleGroups(c);
    const chips = (list) => list.map((n) => `<b>${n.label}</b>`).join(' ') || '<span class="muted">ninguna</span>';
    $('melody-map').innerHTML = `<div class="map">
      <div class="map-side">
        <h2>Sobre ${nameHTML(c)}</h2>
        <dl class="roles">
          <div class="role-safe"><dt>Seguras</dt><dd>${chips(groups.safe)}</dd></div>
          <div class="role-tension"><dt>Dan tensión</dt><dd>${chips(groups.tension)}</dd></div>
          <div class="role-avoid"><dt>De paso</dt><dd>${chips(groups.avoid)}</dd></div>
        </dl>
      </div>
      <div class="map-instruments">${melodyMap(c)}</div>
    </div>`;
  }

  // Editor de melodía ----------------------------------------------------------

  function legendHTML() {
    return `<div class="mel-legend">
          <span class="r-chord"><i></i>Del acorde: reposo</span>
          <span class="r-tension"><i></i>De la escala: movimiento</span>
          <span class="r-avoid"><i></i>Choca: úsala de paso</span>
          <span class="r-out"><i></i>Fuera de escala</span>
        </div>`;
  }

  // Rejilla de notas. track 'm': melodía instrumental; 'v': la voz en la estrofa
  // actual, con una fila encima para las sílabas (lyrics: notas con su sílaba).
  function gridHTML(track, lyrics = null) {
    const list = M.rows(key, chords);
    const steps = chords.length * M.STEPS;
    const hint = melodyHints(list, track);
    const melOf = track === 'v' ? ((bars) => (i) => bars[i])(vmelOf(state.stanza)) : (i) => state.prog[i].mel;

    const head = chords.map((c, i) =>
      `<button class="mel-chord fn-${c.fn} ${i === ui.sel ? 'is-sel' : ''}" data-act="select" data-i="${i}" style="grid-column:span ${M.STEPS}" aria-label="Ver notas sobre ${chordLabel(c)}">${nameHTML(c)}</button>`).join('');

    let lyricRow = '';
    if (lyrics) {
      const at = new Map(lyrics.map((p) => [p.i * M.STEPS + p.s, p]));
      lyricRow = '<div class="mel-label lyr-label">Letra</div>';
      for (let g = 0; g < steps; ) {
        const p = at.get(g);
        const bar = g % M.STEPS === 0 ? ' bar' : '';
        if (p) {
          lyricRow += `<div class="lyr-cell${bar}${p.syl ? '' : ' is-empty'}" data-vn="${state.stanza}:${p.i}:${p.s}" style="grid-column:span ${p.len}">${p.syl ? p.syl.text : '·'}</div>`;
          g += p.len;
        } else {
          lyricRow += `<div class="lyr-cell${bar} is-gap"></div>`;
          g += 1;
        }
      }
    }

    const rowsHTML = list.map((off) => {
      const pc = mod(key.pc + off);
      const isScale = key.pcs.has(pc);
      const cells = [];
      chords.forEach((c, i) => {
        const r = M.role(pc, c, key);
        const mel = melOf(i).map((x) => (x === null ? null : M.snap(x, list)));
        let held = false;
        for (let s = 0; s < M.STEPS; s++) {
          const on = mel[s] === off;
          if (mel[s] !== null) held = on;
          const cls = ['cell', 'r-' + r];
          if (on) cls.push('on');
          else if (held) cls.push('held');
          if (s % 2 === 0) cls.push('beat');
          if (s === 0) cls.push('bar');
          if (hint && hint.i === i && hint.s === s && hint.offs.includes(off)) cls.push('hint');
          cells.push(`<div class="${cls.join(' ')}" data-cell="${track}:${i}:${s}:${off}"></div>`);
        }
      });
      const label = pcLabel(pc);
      return `<div class="mel-label ${pc === key.pc ? 'is-tonic' : ''} ${isScale ? '' : 'is-chroma'}" data-note="${off}">${label}</div>${cells.join('')}`;
    }).join('');

    return `<div class="mel-grid ${lyrics ? 'has-lyrics' : ''}" data-track="${track}" style="--cols:${steps};--rows:${list.length}">
          <div class="mel-corner"></div>${head}${lyricRow}${rowsHTML}
          <div class="playhead" hidden></div>
        </div>`;
  }

  function renderMelody() {
    const el = $('melody');
    const scroller = el.querySelector('.mel-scroll');
    const left = scroller ? scroller.scrollLeft : 0;

    if (!chords.length) {
      el.innerHTML = `<p class="muted">Crea una progresión en la pestaña Progresión y aquí podrás escribir una melodía sobre ella.</p>`;
      return;
    }

    el.innerHTML = `
      <div class="panel-head">
        ${legendHTML()}
        <div class="row">
          <button class="primary" data-act="mel-generate">Proponer melodía</button>
          <button data-act="mel-clear">Borrar melodía</button>
        </div>
      </div>
      <p class="muted help">Haz clic para poner una nota; suena hasta la siguiente. Otro clic la quita. Los aros marcan buenas notas para continuar. La voz tiene su propia melodía, en la pestaña Letra.</p>
      <div class="mel-scroll">${gridHTML('m')}</div>`;
    el.querySelector('.mel-scroll').scrollLeft = left;
  }

  function melodyHints(list, track) {
    if (!ui.cursor || ui.cursor.track !== track) return null;
    let { i, s } = ui.cursor;
    if (!state.prog[i]) return null;
    const cur = track === 'v' ? vmelOf(state.stanza)[i][s] : state.prog[i].mel[s];
    if (cur === null || cur === undefined) return null;
    const prev = M.snap(cur, list);
    s += 1;
    if (s >= M.STEPS) { s = 0; i += 1; }
    if (i >= chords.length) return null;
    return { i, s, offs: M.hints(prev, chords[i], key, list, s % 4 === 0) };
  }

  function toggleCell(track, i, s, off) {
    snapshot();
    const mel = track === 'v' ? vmelW(i, state.stanza) : state.prog[i].mel;
    if (mel[s] === off) {
      mel[s] = null;
      ui.cursor = null;
    } else {
      mel[s] = off;
      ui.cursor = { track, i, s };
      emitNote(M.midiOf(off, key));
    }
    save();
    if (track === 'v') { renderLetraGrid(); return; }
    if (ui.sel !== i) {
      // El mapa de notas sigue al acorde sobre el que estás escribiendo.
      ui.sel = i;
      ui.preview = null;
      renderStrip();
      renderNext();
      renderDetail();
      renderMelodyMap();
    }
    renderMelody();
  }

  // Otras secciones ------------------------------------------------------------

  function presetButtons() {
    return presetsFor(key).map((p, i) =>
      `<button class="preset" data-act="preset" data-i="${i}"><b>${p.name}</b><span>${p.chords.map((c) => c.roman).join(' – ')}</span></button>`);
  }

  function renderField() {
    const list = [...catalog.values()].filter((c) => c.origin.kind === 'scale' && levelAllows(c));
    $('field').innerHTML = `
      <div class="panel-head"><h2>Acordes de la escala</h2>
        <p class="scale-inline">${key.notes.map((n) => noteLabel(n)).join(' ')}</p></div>
      <div class="fieldchips">${list.map((c) =>
        `<button class="fc fn-${c.fn}" data-act="add" data-id="${c.id}" aria-label="Añadir ${chordLabel(c)}"><span class="roman">${c.roman}</span>${nameHTML(c)}</button>`).join('')}</div>`;
  }

  function renderPresets() {
    const list = presetButtons();
    $('presets').innerHTML = `<div class="panel-head"><h2>Progresiones conocidas</h2></div>
      ${list.length ? `<div class="presets">${list.join('')}</div>`
        : `<p class="muted">No hay progresiones guardadas para esta escala. Construye la tuya con las sugerencias.</p>`}`;
  }

  // Percusión -------------------------------------------------------------------

  const hasDrums = () => state.rings.some((r) => !r.muted && r.steps.some(Boolean));
  const canPlay = () => chords.length > 0 || hasDrums();

  function changedRings() {
    save();
    renderWheel();
    renderRings();
    renderTransport();
  }

  function renderWheel() {
    const families = state.rings.map((r) => Drums.INSTRUMENTS[r.inst].family);
    $('wheel').innerHTML = D.wheel(state.rings, families);
  }

  function ringRow(r, i) {
    const k = r.steps.reduce((a, b) => a + b, 0);
    const n = r.steps.length;
    const options = (entries, value) => entries.map(([id, label]) =>
      `<option value="${id}" ${id === value ? 'selected' : ''}>${label}</option>`).join('');
    const name = Drums.necklaceName(r.steps);
    return `<div class="ring-row fam-${Drums.INSTRUMENTS[r.inst].family} ${r.muted ? 'is-muted' : ''}">
      <i class="swatch"></i>
      <select class="ring-inst" data-ring="${i}" data-f="inst" aria-label="Instrumento">${options(Object.entries(Drums.INSTRUMENTS).map(([id, x]) => [id, x.name]), r.inst)}</select>
      <label class="ring-num ring-n">Pasos <input type="range" min="2" max="${Drums.MAX_STEPS}" value="${n}" data-ring="${i}" data-f="n"><b id="ring-n-${i}">${n}</b></label>
      <label class="ring-num ring-k">Golpes <input type="range" min="0" max="${n}" value="${k}" data-ring="${i}" data-f="k" id="ring-kr-${i}"><b id="ring-k-${i}">${k}</b></label>
      <span class="row ring-acts">
        <button data-act="ring-rotate" data-i="${i}" data-d="-1" aria-label="Girar a la izquierda">↺</button>
        <button data-act="ring-rotate" data-i="${i}" data-d="1" aria-label="Girar a la derecha">↻</button>
        <button data-act="ring-mute" data-i="${i}" aria-pressed="${r.muted}">Mudo</button>
        <button data-act="ring-remove" data-i="${i}" aria-label="Quitar anillo">×</button>
        <span class="necklace" id="ring-name-${i}">${name || ''}</span>
      </span>
      <select class="ring-gate" data-ring="${i}" data-f="gate" aria-label="Cuándo toca" title="Cuándo toca este anillo">${options(Object.entries(Drums.GATES), r.gate)}</select>
    </div>`;
  }

  function renderRings() {
    const full = state.rings.length >= Drums.MAX_RINGS;
    $('rings').innerHTML = `
      <div class="panel-head">
        <div class="row">
          <button class="primary" data-act="drum-invent">Inventar ritmo</button>
          <button data-act="drum-mutate" ${state.rings.length ? '' : 'disabled'}>Mutar</button>
          <button data-act="ring-add" ${full ? 'disabled' : ''}>Añadir anillo</button>
        </div>
        <div class="row">
          <label class="bpm">Vida <input type="range" id="c-life" min="0" max="100" step="5" value="${state.life}" aria-label="Variación entre compases"> <span id="life-value">${state.life}%</span></label>
          <button data-act="drum-clear" ${state.rings.length ? '' : 'disabled'}>Vaciar</button>
        </div>
      </div>
      <div class="ring-list">${state.rings.length ? state.rings.map(ringRow).join('')
        : `<p class="muted">Cada anillo es un instrumento y da una vuelta por compás. Si tienen distinto número de pasos, se forma una polirritmia. Elige un ritmo para empezar.</p>`}</div>
      <div class="drum-presets">${Drums.PRESETS.map((p, i) =>
        `<button data-act="drum-preset" data-i="${i}">${p.name}</button>`).join('')}</div>`;
    $('c-life').oninput = (e) => {
      state.life = Number(e.target.value);
      $('life-value').textContent = state.life + '%';
      save();
    };
  }

  // Los deslizadores redibujan solo la rueda: rehacer la fila cortaría el arrastre.
  function ringInput(el) {
    const i = Number(el.dataset.ring);
    const r = state.rings[i];
    const f = el.dataset.f;
    if (f === 'inst' || f === 'gate') {
      r[f] = el.value;
      changedRings();
      return;
    }
    const value = Number(el.value);
    const k = f === 'k' ? value : Math.min(r.steps.reduce((a, b) => a + b, 0), value);
    const n = f === 'n' ? value : r.steps.length;
    r.steps = Drums.euclid(k, n);
    $(`ring-n-${i}`).textContent = n;
    $(`ring-k-${i}`).textContent = k;
    $(`ring-kr-${i}`).max = n;
    $(`ring-name-${i}`).textContent = Drums.necklaceName(r.steps) || '';
    save();
    renderWheel();
    renderTransport();
  }

  function drumHits(p) {
    const stepMs = 30000 / state.bpm;
    const barMs = stepMs * M.STEPS;
    const mel = state.prog[p.i] ? state.prog[p.i].mel : [];
    const barAt = p.next;
    return Drums.barHits(state.rings, {
      life: state.life / 100,
      rand: Math.random,
      melody: mel.flatMap((off, s) => (off === null ? [] : [s])),
      chordHits: chords.length ? M.COMP[state.comp].hits : [],
    }).map((h) => ({ ...h, at: barAt + Drums.swungPos(h.pos, state.swing) * barMs }));
  }

  function fireDrum(hit) {
    const { at } = hit;
    if (state.playDrums && !browserMuted()) Sound.drum(hit.inst, hit.velocity, (at - performance.now()) / 1000);
    if (state.sendDrums) Midi.note(state.midiDrumCh, Drums.INSTRUMENTS[hit.inst].midi, 80, hit.velocity, at);
    if (state.tab !== 'drums') return;
    setTimeout(() => {
      const dot = document.querySelector(`[data-dot="${hit.ringIndex}:${hit.step}"]`);
      if (!dot) return;
      dot.classList.add('flash');
      setTimeout(() => dot.classList.remove('flash'), 110);
    }, Math.max(0, at - performance.now()));
  }

  // Aguja de la rueda: sigue el compás en curso.
  function animateHand() {
    const p = ui.playing;
    const hand = document.querySelector('.w-hand');
    if (hand) {
      hand.hidden = !p;
      if (p && p.barSeen) {
        const barMs = (30000 / state.bpm) * M.STEPS;
        const angle = (((performance.now() - p.barSeen) / barMs) % 1) * 360;
        hand.setAttribute('transform', `rotate(${angle} 220 220)`);
      }
    }
    if (p) requestAnimationFrame(animateHand);
  }

  // Salida de sonido: navegador, instrumento MIDI o ambos -----------------------

  const browserMuted = () => Boolean(Midi.output) && !state.localSound;
  const sendsChords = () => state.sendChords;
  const sendsMelody = () => state.sendMelody;

  function emitChord(midis, dur = 1.6, gain = .2, at = performance.now(), hear = true) {
    const inst = state.instrument === 'piano' ? 'piano' : 'guitar';
    if (hear && !browserMuted()) Sound.chord(midis, inst, dur, gain, (at - performance.now()) / 1000);
    if (sendsChords()) Midi.chord(state.midiChordCh, midis, dur * 1000, 80, at, inst === 'guitar' ? 22 : 0);
  }

  function emitNote(midi, dur = .4, gain = .32, at = performance.now(), hear = true) {
    if (hear && !browserMuted()) Sound.note(midi, dur, gain, (at - performance.now()) / 1000);
    if (sendsMelody()) Midi.note(state.midiMelodyCh, midi, dur * 1000, 100, at);
  }

  function channelSelect(id, label, value) {
    const opts = [...Array(16).keys()].map((c) =>
      `<option value="${c + 1}" ${c + 1 === value ? 'selected' : ''}>${c + 1}</option>`).join('');
    return `<label class="field"><span>${label}</span><select id="${id}">${opts}</select></label>`;
  }

  function renderMidi() {
    renderMutes();
    const el = $('midi');
    $('midi-status').textContent = Midi.output ? '●' : '';
    if (!Midi.supported()) {
      el.innerHTML = `<p class="muted">Este navegador no permite MIDI. Abre la web en Chrome o Edge.</p>`;
      return;
    }
    if (!Midi.connected) {
      el.innerHTML = `
        <button data-act="midi-connect">Conectar instrumento</button>
        <p class="muted">Enchúfalo por USB antes de conectar. El navegador te pedirá permiso.</p>
        ${ui.midiError ? `<p class="midi-error">${ui.midiError}</p>` : ''}`;
      return;
    }
    const outs = Midi.list();
    const current = Midi.output;
    if (!outs.length) {
      el.innerHTML = `<p class="muted">No se detecta ningún instrumento. Conéctalo por USB y aparecerá aquí.</p>`;
      return;
    }
    el.innerHTML = `
      <label class="field wide"><span>Instrumento</span><select id="m-out">${outs.map((o) =>
        `<option value="${escapeAttr(o.id)}" ${current && o.id === current.id ? 'selected' : ''}>${escapeText(o.name)}</option>`).join('')}</select></label>
      <div class="field"><span>Enviar</span><div class="seg" role="group">
        ${[['sendChords', 'Progresión'], ['sendMelody', 'Melodía'], ['sendDrums', 'Percusión']].map(([k, label]) =>
          `<button data-act="midi-send" data-v="${k}" aria-pressed="${state[k]}">${label}</button>`).join('')}
      </div></div>
      ${sendsChords() ? channelSelect('m-chord-ch', 'Canal progresión', state.midiChordCh) : ''}
      ${sendsMelody() ? channelSelect('m-melody-ch', 'Canal melodía', state.midiMelodyCh) : ''}
      ${state.sendDrums ? channelSelect('m-drum-ch', 'Canal percusión', state.midiDrumCh) : ''}
      <label class="check"><input type="checkbox" id="m-local" ${state.localSound ? 'checked' : ''}> Sonar también en el navegador</label>
      <button data-act="midi-panic">Silenciar instrumento</button>`;
    $('m-out').onchange = (e) => { Midi.select(e.target.value); state.midiOut = e.target.value; save(); };
    $('m-local').onchange = (e) => { state.localSound = e.target.checked; save(); renderMutes(); };
    const ch = (id, prop) => {
      if ($(id)) $(id).onchange = (e) => { Midi.silence(); state[prop] = Number(e.target.value); save(); };
    };
    ch('m-chord-ch', 'midiChordCh');
    ch('m-melody-ch', 'midiMelodyCh');
    ch('m-drum-ch', 'midiDrumCh');
  }

  const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');

  async function connectMidi() {
    try {
      await Midi.connect(state.midiOut);
      state.midiOn = true;
      ui.midiError = null;
    } catch (e) {
      state.midiOn = false;
      ui.midiError = e.name === 'NotAllowedError' || e.name === 'SecurityError'
        ? 'El navegador ha denegado el acceso. Permite MIDI en el icono junto a la dirección y vuelve a intentarlo.'
        : 'No se pudo acceder a MIDI: ' + e.message;
    }
    save();
    renderMidi();
  }

  // Al enchufar o desenchufar: recupera el instrumento elegido o el primero que haya.
  Midi.onChange = () => {
    if (!Midi.output) {
      const outs = Midi.list();
      const found = outs.find((o) => o.id === state.midiOut) || outs[0];
      if (found) Midi.select(found.id);
    }
    renderMidi();
  };

  // Voz ------------------------------------------------------------------------

  const midiLabel = (m) => pcLabel(mod(m)) + (Math.floor(m / 12) - 1);
  const EMPTY_BAR = Object.freeze(Array(M.STEPS).fill(null));
  const MAX_STANZAS = 8;

  // La voz tiene su propia melodía, una por estrofa, guardada en cada compás
  // (it.vmel[k]) para que siga a los acordes si se quitan o se mueven.
  const vmelOf = (k) => state.prog.slice(0, chords.length).map((it) => (it.vmel && it.vmel[k]) || EMPTY_BAR);
  function vmelW(i, k) {
    const it = state.prog[i];
    if (!it.vmel) it.vmel = [];
    while (it.vmel.length <= k) it.vmel.push(Array(M.STEPS).fill(null));
    return it.vmel[k];
  }
  const syllsOf = (k) => Spanish.syllables((state.stanzas[k] || {}).lyrics || '', { seseo: state.accent === 'latam' });
  const stanzaCount = () => state.stanzas.length;

  // Qué canta la voz: cada estrofa sobre una vuelta de la progresión, con su letra.
  function voicePlan() {
    const list = chords.length ? M.rows(key, chords) : [];
    const parts = state.stanzas.map((st, k) => {
      const notes = Voice.notesOf(vmelOf(k), k * chords.length);
      notes.forEach((n) => { n.off = M.snap(n.off, list); n.midi = M.midiOf(n.off, key); });
      return { k, notes, sylls: syllsOf(k) };
    });
    const all = parts.flatMap((p) => p.notes);
    const oct = state.octave === 'auto' ? Voice.autoOctave(all.map((n) => n.midi), state.voiceBody) : Number(state.octave);
    all.forEach((n) => { n.midi += 12 * oct; });
    const stanzas = parts.map((p) => ({ k: p.k, sylls: p.sylls, ...Voice.align(p.notes, p.sylls) }));
    return { oct, stanzas, pairs: stanzas.flatMap((st) => st.pairs) };
  }

  function voiceRequest(plan) {
    if (!plan.pairs.some((p) => p.syl)) return null;
    return Voice.request({
      pairs: plan.pairs, bpm: state.bpm, swing: state.swing, body: state.voiceBody,
      vibrato: state.vibrato, breath: state.breath / 100, bright: state.bright / 100,
    });
  }

  function refreshVoice() {
    clearTimeout(ui.voiceTimer);
    ui.voiceTimer = setTimeout(singVoice, 450);
  }

  // Pide al motor que cante lo actual, si no lo tiene ya.
  function singVoice() {
    if (!Voice.supported() || !key) return;
    const req = voiceRequest(voicePlan());
    const k = req ? JSON.stringify(req) : null;
    if (k === ui.voice.key) return;
    const job = { key: k, status: req ? 'rendering' : 'idle', progress: 0 };
    ui.voice = job;
    renderVoiceStatus();
    if (!req) return;
    Voice.render(req, (p) => {
      if (ui.voice !== job) return;
      job.progress = p;
      renderVoiceStatus();
    }).then((r) => {
      if (ui.voice !== job) return;
      let peak = 0;
      for (const x of r.samples) peak = Math.max(peak, Math.abs(x));
      if (peak > 0) { const g = .9 / peak; for (let i = 0; i < r.samples.length; i++) r.samples[i] *= g; }
      Object.assign(job, { status: 'ready', samples: r.samples, rate: r.sampleRate });
      renderVoiceStatus();
    }).catch((e) => {
      if (ui.voice !== job) return;
      Object.assign(job, { status: 'error', error: e.message });
      renderVoiceStatus();
    });
  }

  // La toma lista, solo si corresponde a la canción tal como está ahora.
  function voiceTake() {
    const v = ui.voice;
    if (v.status !== 'ready' || !key) return null;
    const req = voiceRequest(voicePlan());
    return req && JSON.stringify(req) === v.key ? v : null;
  }

  const voiceLevel = () => (state.playVoice ? .55 * state.voiceVol / 100 : 0);

  function startVoice(p, atMs) {
    const take = voiceTake();
    if (!take) return;
    const node = Sound.buffer(take.samples, take.rate, (atMs - Voice.LEAD * 1000 - performance.now()) / 1000, voiceLevel());
    if (node) p.voices.push(node);
  }

  function voiceGain() {
    if (ui.playing) ui.playing.voices.forEach((v) => v.gain(voiceLevel()));
  }

  function markVoiceNote(k, i, s) {
    document.querySelectorAll('.va-note.is-now, .lyr-cell.is-now').forEach((el) => el.classList.remove('is-now'));
    document.querySelectorAll(`.va-note[data-vn="${k}:${i}:${s}"], .lyr-cell[data-vn="${k}:${i}:${s}"]`)
      .forEach((el) => el.classList.add('is-now'));
  }

  function renderVoiceStatus() {
    const v = ui.voice;
    const text = !Voice.supported() ? 'Este navegador no puede ejecutar el motor de voz' : {
      idle: 'Escribe la letra para oírla',
      rendering: `Cantando… ${Math.round(v.progress * 100)}%`,
      ready: 'Voz lista',
      error: 'No se pudo cantar: ' + v.error,
    }[v.status];
    document.querySelectorAll('.voice-status').forEach((el) => {
      el.textContent = text;
      el.className = 'voice-status is-' + (Voice.supported() ? v.status : 'error');
      el.style.setProperty('--p', v.status === 'rendering' ? v.progress : v.status === 'ready' ? 1 : 0);
    });
  }

  // Pestaña Letra: estrofas, su texto y la melodía que canta la voz.
  function renderLetra() {
    const head = $('letra-head');
    if (!chords.length) {
      head.innerHTML = '<p class="muted">Crea una progresión en la pestaña Progresión y aquí podrás escribir la letra y la melodía que canta la voz.</p>';
      $('letra-grid').innerHTML = '';
      return;
    }
    state.stanza = Math.min(Math.max(0, state.stanza), stanzaCount() - 1);
    const chips = state.stanzas.map((st, k) =>
      `<button class="stanza-chip" data-act="stanza" data-v="${k}" data-k="${k}" aria-pressed="${k === state.stanza}">Estrofa ${k + 1}</button>`).join('');
    head.innerHTML = `
      <div class="panel-head">
        <div class="row">
          <div class="seg" role="group" aria-label="Estrofas">${chips}</div>
          <button data-act="stanza-add" ${stanzaCount() >= MAX_STANZAS ? 'disabled' : ''} title="Empieza con la melodía de la estrofa actual">+ Estrofa</button>
          ${stanzaCount() > 1 ? `<button data-act="stanza-remove" title="Quitar la estrofa ${state.stanza + 1}">Quitar</button>` : ''}
        </div>
        <span class="voice-status" role="status"></span>
      </div>
      <textarea id="c-lyrics" rows="2" spellcheck="true" lang="es" aria-label="Letra de la estrofa ${state.stanza + 1}" placeholder="Letra de la estrofa ${state.stanza + 1}. Por ejemplo: Cielito lindo, los ojos negros"></textarea>
      <p class="muted help">Cada estrofa suena en una vuelta de la progresión. Una sílaba por nota: «-» alarga la anterior, «_» une dos palabras (de_amor) y la puntuación marca dónde respirar.</p>`;
    const ta = $('c-lyrics');
    ta.value = state.stanzas[state.stanza].lyrics;
    ta.oninput = () => { state.stanzas[state.stanza].lyrics = ta.value; save(); renderLetraGrid(); };
    renderLetraGrid();
    renderVoiceStatus();
  }

  function renderLetraGrid() {
    const el = $('letra-grid');
    if (!chords.length) return;
    const scroller = el.querySelector('.mel-scroll');
    const left = scroller ? scroller.scrollLeft : 0;
    const k = state.stanza;
    const sylls = syllsOf(k);
    const al = Voice.align(Voice.notesOf(vmelOf(k)), sylls);
    let warn = '';
    if (al.extraSyllables.length) warn = `<p class="va-warn">Sobran ${al.extraSyllables.length} sílabas sin nota: «${al.extraSyllables.map((x) => x.text).join(' ')}». Añade notas o pulsa «Ajustar a la letra».</p>`;
    else if (al.extraNotes && sylls.length) warn = `<p class="va-warn is-soft">${al.extraNotes} notas sin letra: la voz calla en ellas.</p>`;
    el.innerHTML = `
      <div class="panel-head">
        ${legendHTML()}
        <div class="row">
          <button class="primary" data-act="vmel-generate" title="Una nota por sílaba, con las frases en compases enteros">${sylls.length ? 'Ajustar a la letra' : 'Proponer melodía'}</button>
          <button data-act="vmel-copy" title="Copia aquí la melodía de la pestaña Melodía">Copiar de Melodía</button>
          <button data-act="vmel-clear">Borrar</button>
        </div>
      </div>
      <div class="mel-scroll">${gridHTML('v', al.pairs)}</div>${warn}`;
    el.querySelector('.mel-scroll').scrollLeft = left;
  }

  function alignBars(pairs, k) {
    const byBar = chords.map(() => []);
    pairs.forEach((p) => { if (byBar[p.i]) byBar[p.i].push(p); }); // p.i: compás dentro de la estrofa
    return chords.map((c, i) => `<div class="va-bar fn-${c.fn}">
        <span class="va-chord">${nameHTML(c)}</span>
        <div class="va-notes">${byBar[i].map((p) => `<span class="va-note ${p.syl ? '' : 'is-empty'}" data-vn="${k}:${i}:${p.s}">
          <b>${p.syl ? p.syl.text : '·'}</b><small>${midiLabel(p.midi)}</small></span>`).join('') || '<span class="va-rest">silencio</span>'}</div>
      </div>`).join('');
  }

  // Pestaña Voz, a la izquierda: la canción entera tal como la cantará.
  function renderSong() {
    const el = $('song');
    let body;
    if (!chords.length) body = '<p class="muted">Crea primero una progresión.</p>';
    else {
      const plan = voicePlan();
      body = plan.stanzas.map((st) => {
        let warn = '';
        if (st.extraSyllables.length) warn = `<p class="va-warn">Sobran ${st.extraSyllables.length} sílabas sin nota.</p>`;
        const empty = !st.pairs.length ? '<p class="muted">Sin melodía todavía.</p>' : `<div class="va-bars">${alignBars(st.pairs, st.k)}</div>`;
        return `<div class="song-stanza"><h3>Estrofa ${st.k + 1}</h3>${empty}${warn}</div>`;
      }).join('');
    }
    el.innerHTML = `
      <div class="panel-head">
        <h2>Canción</h2>
        <span class="voice-status" role="status"></span>
      </div>
      <p class="muted help">La letra y su melodía se escriben en la pestaña <button class="link inline" data-act="tab" data-v="letra">Letra</button>. Aquí se ve lo que cantará la voz, estrofa a estrofa.</p>
      <div class="voice-align">${body}</div>`;
    renderVoiceStatus();
  }

  function renderVoice() {
    const el = $('voice');
    const plan = voicePlan();
    const midis = plan.pairs.filter((p) => p.syl).map((p) => p.midi);
    const range = midis.length ? `Canta de ${midiLabel(Math.min(...midis))} a ${midiLabel(Math.max(...midis))}` : '';
    const vib = Voice.vibratoRate(state.bpm);
    const slider = (id, label, min, max, value, unit) => `<label class="vslider"><span>${label}</span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}" aria-label="${label}"><output>${value}${unit}</output></label>`;
    el.innerHTML = `
      <div class="panel-head"><h2>Voz</h2></div>
      <div class="vfields">
        <div class="field"><span>Cuerpo</span>${seg('voice-body', Object.entries(Voice.BODIES).map(([id, b]) => [id, b.name]), state.voiceBody)}</div>
        <div class="field"><span>Acento</span>${seg('accent', [['es', 'España'], ['latam', 'Latinoamérica']], state.accent)}</div>
        <div class="field"><span>Octava</span>${seg('octave', [['auto', 'Auto'], ['-1', '−1'], ['0', '0'], ['1', '+1']], state.octave)}
          <span class="muted">${range}${state.octave === 'auto' && midis.length ? ` (${plan.oct > 0 ? '+' : ''}${plan.oct} oct.)` : ''}</span></div>
        ${slider('v-vibrato', 'Vibrato', 0, 80, state.vibrato, ' cents')}
        ${slider('v-breath', 'Aire', 0, 60, state.breath, '%')}
        ${slider('v-bright', 'Brillo', 0, 60, state.bright, '%')}
        ${slider('v-vol', 'Volumen', 0, 100, state.voiceVol, '%')}
      </div>
      <div class="vauto">
        <h3>Sigue a la canción</h3>
        <ul>
          <li><b>Tonalidad</b> ${noteLabel(key.tonic)} ${key.scale.name.toLowerCase()}: canta las notas de la pestaña Letra.</li>
          <li><b>Estrofas</b>: ${stanzaCount()}, cada una en una vuelta de la progresión.</li>
          <li><b>Tempo</b> ${state.bpm} ppm: cada sílaba dura su nota y las consonantes entran antes del pulso.</li>
          <li><b>Swing</b> ${swingLabel()}: retrasa las corcheas a contratiempo igual que el resto.</li>
          <li><b>Vibrato</b> a ${vib.rate.toFixed(1).replace('.', ',')} Hz, ${vib.per} ondas por pulso, solo en las notas largas.</li>
          <li><b>Respira</b> en los silencios y en la puntuación.</li>
        </ul>
        <p class="muted">La voz suena en el navegador; no se envía por MIDI. La genera CHIMERA, un modelo físico de garganta y boca.</p>
      </div>`;
    const bind = (id, prop, unit, live) => {
      const input = $(id);
      input.oninput = () => {
        state[prop] = Number(input.value);
        input.nextElementSibling.textContent = input.value + unit;
        if (live) live(); else save();
      };
    };
    bind('v-vibrato', 'vibrato', ' cents');
    bind('v-breath', 'breath', '%');
    bind('v-bright', 'bright', '%');
    // El volumen no obliga a volver a cantar: se aplica al vuelo.
    bind('v-vol', 'voiceVol', '%', () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignorar */ } voiceGain(); });
  }

  // Coordinación ---------------------------------------------------------------

  function render() {
    renderControls();
    renderStrip();
    renderMidi();
    renderNext();
    renderDetail();
    renderMelody();
    renderMelodyMap();
    renderField();
    renderPresets();
    renderWheel();
    renderRings();
    renderLetra();
    renderSong();
    renderVoice();
    applyTab();
  }

  const TABS = ['chords', 'melody', 'drums', 'letra', 'voice'];

  const MUTES = {
    chords: { prop: 'playChords', name: 'progresión' },
    melody: { prop: 'playMelody', name: 'melodía' },
    drums: { prop: 'playDrums', name: 'percusión' },
    voice: { prop: 'playVoice', name: 'voz' },
  };
  const SPEAKER = '<path fill="currentColor" stroke="none" d="M2 6h3l4-3.5v11L5 10H2z"/>';
  const ICON_ON = `<svg viewBox="0 0 16 16" aria-hidden="true">${SPEAKER}<path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6.3 6.3 0 0 1 0 9"/></svg>`;
  const ICON_OFF = `<svg viewBox="0 0 16 16" aria-hidden="true">${SPEAKER}<path d="m11 6 4 4m0-4-4 4"/></svg>`;

  function renderMutes() {
    TABS.forEach((t) => {
      const btn = $('mute-' + t);
      if (!btn) return;
      const { prop, name } = MUTES[t];
      const off = !state[prop];
      btn.innerHTML = off ? ICON_OFF : ICON_ON;
      // La voz no va por MIDI: suena en el navegador aunque el resto no.
      const blocked = t !== 'voice' && browserMuted();
      btn.disabled = blocked;
      btn.setAttribute('aria-pressed', String(off));
      btn.setAttribute('aria-label', 'Silenciar ' + name);
      btn.title = blocked ? 'El sonido del navegador está apagado en el menú MIDI' : 'Silenciar ' + name;
    });
  }

  function applyTab() {
    TABS.forEach((t) => {
      $('tab-' + t).hidden = state.tab !== t;
      $('tab-btn-' + t).setAttribute('aria-selected', String(state.tab === t));
    });
  }

  function setTab(tab) {
    state.tab = tab;
    // La voz depende de todo lo demás: al entrar se pone al día.
    if (tab === 'voice') { renderSong(); renderVoice(); }
    if (tab === 'letra') renderLetra();
    save();
    applyTab();
  }

  function update() {
    save();
    recompute();
    if (ui.sel >= chords.length) ui.sel = chords.length - 1;
    render();
  }

  const catalogChord = (id) => catalog.get(id);

  function playFocus() {
    const f = focusChord();
    if (!f) return;
    const v = state.instrument === 'piano' ? f.p : f.g;
    if (v) emitChord(v.midis);
  }

  function shiftVoicing(kind, d) {
    const f = focusChord();
    if (!f) return;
    const list = kind === 'g' ? f.gl : f.pl;
    const cur = kind === 'g' ? f.gi : f.pi;
    const nextI = mod(cur + d, list.length);
    if (f.preview) {
      if (kind === 'g') ui.previewG = nextI; else ui.previewP = nextI;
    } else {
      state.prog[ui.sel][kind] = nextI;
    }
    update();
    playFocus();
  }

  const ACTIONS = {
    tab(el) { setTab(el.dataset.v); },
    level(el) { state.level = Number(el.dataset.v); update(); },
    instrument(el) { state.instrument = el.dataset.v; update(); },
    notation(el) { state.notation = el.dataset.v; update(); },
    select(el) { ui.sel = Number(el.dataset.i); ui.preview = null; update(); playFocus(); },
    add(el) {
      const c = catalogChord(el.dataset.id);
      if (!c) return;
      snapshot();
      state.prog.splice(ui.sel + 1, 0, itemFrom(c));
      ui.sel += 1;
      ui.preview = null;
      update();
      playFocus();
    },
    preview(el) {
      ui.preview = catalogChord(el.dataset.id) || null;
      ui.previewG = 0; ui.previewP = 0;
      if (ui.preview && state.smooth) {
        const cur = voicings[ui.sel];
        ui.previewG = V.pickGuitar(ui.preview, cur && cur.g);
        ui.previewP = V.pickPiano(ui.preview, cur && cur.p);
      }
      renderDetail();
      playFocus();
    },
    'close-preview'() { ui.preview = null; renderDetail(); },
    'hear-focus'() { playFocus(); },
    remove(el) {
      snapshot();
      const i = Number(el.dataset.i);
      state.prog.splice(i, 1);
      if (ui.sel >= i) ui.sel -= 1;
      if (ui.sel < 0 && state.prog.length) ui.sel = 0;
      ui.cursor = null;
      update();
    },
    clear() { stop(); snapshot(); state.prog = []; ui.sel = -1; ui.cursor = null; update(); },
    undo() {
      const last = ui.undo.pop();
      if (!last) return;
      stop();
      const snap = JSON.parse(last);
      state.prog = snap.prog;
      ui.sel = snap.sel;
      state.rings = snap.rings;
      if (snap.stanzas) { state.stanzas = snap.stanzas; state.stanza = snap.stanza || 0; }
      ui.cursor = null;
      update();
    },
    more() { ui.more = !ui.more; renderNext(); },
    preset(el) {
      stop();
      const p = presetsFor(key)[Number(el.dataset.i)];
      snapshot();
      state.prog = p.chords.map((c) => itemFrom(c));
      ui.sel = state.prog.length - 1;
      ui.preview = null;
      ui.cursor = null;
      update();
    },
    'voice-g'(el) { shiftVoicing('g', Number(el.dataset.d)); },
    'voice-p'(el) { shiftVoicing('p', Number(el.dataset.d)); },
    play() { if (ui.playing) stop(); else play(); },
    'midi-connect'() { connectMidi(); },
    'midi-send'(el) { Midi.silence(); state[el.dataset.v] = !state[el.dataset.v]; save(); renderMidi(); },
    'drum-preset'(el) {
      snapshot();
      state.rings = Drums.presetRings(Drums.PRESETS[Number(el.dataset.i)]);
      changedRings();
    },
    'drum-invent'() {
      snapshot();
      ui.seed += 1;
      state.rings = Drums.invent(M.seeded(ui.seed * 6151));
      changedRings();
    },
    'drum-mutate'() {
      snapshot();
      ui.seed += 1;
      Drums.mutate(state.rings, M.seeded(ui.seed * 3571));
      changedRings();
    },
    'drum-clear'() { snapshot(); state.rings = []; changedRings(); },
    'ring-add'() {
      snapshot();
      state.rings.push({ inst: 'rim', steps: Drums.euclid(3, 8), gate: 'free', muted: false });
      changedRings();
    },
    'ring-remove'(el) { snapshot(); state.rings.splice(Number(el.dataset.i), 1); changedRings(); },
    'ring-mute'(el) { const r = state.rings[Number(el.dataset.i)]; r.muted = !r.muted; changedRings(); },
    'ring-rotate'(el) {
      const r = state.rings[Number(el.dataset.i)];
      r.steps = Drums.rotate(r.steps, Number(el.dataset.d));
      changedRings();
    },
    'toggle-drums'() { state.playDrums = !state.playDrums; save(); renderMutes(); },
    'midi-panic'() { Midi.panic(); },
    'toggle-loop'() { state.loop = !state.loop; save(); renderStrip(); },
    'toggle-chords'() { state.playChords = !state.playChords; save(); renderMutes(); },
    'toggle-melody'() { state.playMelody = !state.playMelody; save(); renderMutes(); },
    stanza(el) { state.stanza = Number(el.dataset.v); ui.cursor = null; save(); renderLetra(); },
    'stanza-add'() {
      snapshot();
      const from = state.stanza;
      state.stanzas.push({ lyrics: '' });
      const k = state.stanzas.length - 1;
      // Una estrofa nueva suele repetir la melodía con otra letra: se copia.
      state.prog.forEach((it, i) => { vmelW(i, k).splice(0, M.STEPS, ...((it.vmel && it.vmel[from]) || EMPTY_BAR)); });
      state.stanza = k;
      save();
      renderLetra();
      $('c-lyrics').focus();
    },
    'stanza-remove'() {
      if (stanzaCount() < 2) return;
      snapshot();
      const k = state.stanza;
      state.stanzas.splice(k, 1);
      state.prog.forEach((it) => { if (it.vmel) it.vmel.splice(k, 1); });
      state.stanza = Math.max(0, k - 1);
      save();
      renderLetra();
    },
    'vmel-generate'() {
      snapshot();
      ui.seed += 1;
      const k = state.stanza;
      const sylls = syllsOf(k);
      const rhythm = sylls.length ? Voice.rhythm(sylls, chords.length) : null;
      M.generate(chords, key, M.seeded(ui.seed * 7919), rhythm).forEach((bar, i) => { vmelW(i, k).splice(0, M.STEPS, ...bar); });
      ui.cursor = null;
      save();
      renderLetraGrid();
    },
    'vmel-copy'() {
      snapshot();
      state.prog.forEach((it, i) => { vmelW(i, state.stanza).splice(0, M.STEPS, ...it.mel); });
      ui.cursor = null;
      save();
      renderLetraGrid();
    },
    'vmel-clear'() {
      snapshot();
      state.prog.forEach((it, i) => { vmelW(i, state.stanza).fill(null); });
      ui.cursor = null;
      save();
      renderLetraGrid();
    },
    'toggle-voice'() { state.playVoice = !state.playVoice; save(); renderMutes(); voiceGain(); },
    'voice-body'(el) { state.voiceBody = el.dataset.v; save(); renderVoice(); renderSong(); },
    accent(el) { state.accent = el.dataset.v; save(); renderVoice(); renderSong(); },
    octave(el) { state.octave = el.dataset.v; save(); renderVoice(); renderSong(); },
    'mel-generate'() {
      snapshot();
      ui.seed += 1;
      M.generate(chords, key, M.seeded(ui.seed * 7919)).forEach((bar, i) => { state.prog[i].mel = bar; });
      ui.cursor = null;
      save();
      renderMelody();
      renderStrip();
      renderSong();
      renderVoice();
    },
    'mel-clear'() {
      snapshot();
      state.prog.forEach((it) => { it.mel = Array(M.STEPS).fill(null); });
      ui.cursor = null;
      save();
      renderMelody();
      renderStrip();
      renderSong();
      renderVoice();
    },
  };

  // Reproducción ---------------------------------------------------------------

  function melodyAt(list, i, s) {
    if (!state.prog[i]) return null;
    const off = state.prog[i].mel[s];
    if (off === null || off === undefined) return null;
    // Dura hasta la siguiente nota o el final del compás.
    let len = 1;
    for (let k = s + 1; k < M.STEPS && state.prog[i].mel[k] === null; k++) len++;
    return { off: M.snap(off, list), len };
  }

  // La rejilla de la voz solo muestra el cursor si la estrofa que suena es la que se ve.
  function movePlayhead(i, s, pass) {
    document.querySelectorAll('.mel-grid').forEach((grid) => {
      const head = grid.querySelector('.playhead');
      if (!head) return;
      if (grid.dataset.track === 'v' && pass !== state.stanza) { head.hidden = true; return; }
      const label = grid.querySelector('.mel-corner').offsetWidth;
      const cell = (grid.scrollWidth - label) / (chords.length * M.STEPS);
      head.hidden = false;
      head.style.left = label + (i * M.STEPS + s) * cell + 'px';
    });
  }

  function highlight(i, pass) {
    document.querySelectorAll('.is-playing').forEach((n) => n.classList.remove('is-playing'));
    document.querySelectorAll(`.pc[data-i="${i}"], .mel-chord[data-i="${i}"], .stanza-chip[data-k="${pass}"]`)
      .forEach((n) => n.classList.add('is-playing'));
  }

  // Los pasos se programan con un poco de antelación: así el MIDI lleva marcas de
  // tiempo exactas y no depende de lo ocupada que esté la página.
  const LOOKAHEAD_MS = 120;

  function scheduleStep(p, at) {
    const stepMs = 30000 / state.bpm;
    const { i, s } = p;
    const { hits } = M.COMP[state.comp];
    const hit = hits.indexOf(s);
    if (s === 0) p.queue.push(...drumHits(p));
    if (hit >= 0 && chords[i]) {
      const v = voicings[i][state.instrument === 'piano' ? 'p' : 'g'];
      const to = hit + 1 < hits.length ? hits[hit + 1] : M.STEPS;
      const dur = M.spanMs(s, to, state.swing, stepMs) * .95 / 1000;
      if (v) emitChord(v.midis, dur, .15, at, state.playChords);
    }
    const pass = p.pass;
    // La voz se programa una vez por vuelta completa (todas las estrofas).
    if (s === 0 && i === Math.max(1, chords.length) - 1 && pass >= stanzaCount() - 1 && state.loop) p.voiceAt = at + M.STEPS * stepMs;
    const n = melodyAt(p.list, i, s);
    if (n) {
      const dur = M.spanMs(s, s + n.len, state.swing, stepMs) * .92 / 1000;
      emitNote(M.midiOf(n.off, key), dur, .32, at, state.playMelody);
    }
    setTimeout(() => {
      if (ui.playing !== p) return;
      if (s === 0) { highlight(i, pass); p.barSeen = performance.now(); }
      movePlayhead(i, s, pass);
      markVoiceNote(pass, i, s);
    }, Math.max(0, at - performance.now()));
  }

  function schedule() {
    const p = ui.playing;
    if (!p) return;
    if (!canPlay()) { stop(); return; }
    const now = performance.now();
    while (p.queue.length && p.queue[0].at < now + LOOKAHEAD_MS) fireDrum(p.queue.shift());
    // La voz arranca antes del compás: sus consonantes van antes del pulso.
    if (p.voiceAt && p.voiceAt - Voice.LEAD * 1000 < now + LOOKAHEAD_MS) {
      startVoice(p, p.voiceAt);
      p.voiceAt = 0;
    }
    if (p.endAt) {
      if (now >= p.endAt) stop(true);
      return;
    }
    // El margen se mide con el swing ya aplicado: una corchea retrasada no debe
    // programarse tan lejos que parar no pueda alcanzarla.
    const stepMs = 30000 / state.bpm;
    while (p.next + M.swingShift(p.s, state.swing, stepMs) < now + LOOKAHEAD_MS) {
      const bars = Math.max(1, chords.length);
      if (p.i >= bars) p.i = 0; // se quitó un acorde mientras sonaba
      scheduleStep(p, p.next + M.swingShift(p.s, state.swing, stepMs));
      p.next += stepMs;
      p.s += 1;
      if (p.s >= M.STEPS) {
        p.s = 0;
        p.i += 1;
        if (p.i >= bars) {
          p.i = 0;
          p.pass += 1;
          if (p.pass >= stanzaCount()) {
            if (!state.loop) { p.endAt = p.next; return; }
            p.pass = 0;
          }
        }
      }
    }
  }

  function play() {
    if (!canPlay()) return;
    // Con voz lista se deja margen para que entren sus primeras consonantes.
    const lead = voiceTake() ? Voice.LEAD * 1000 : 0;
    const next = performance.now() + 40 + lead;
    ui.playing = { i: 0, s: 0, next, list: M.rows(key, chords), endAt: 0, queue: [], barSeen: 0, voices: [], voiceAt: next, pass: 0 };
    renderTransport();
    animateHand();
  }

  // natural: la canción terminó sola; la voz acaba su última sílaba.
  function stop(natural = false) {
    if (!ui.playing) return;
    if (!natural) ui.playing.voices.forEach((v) => v.stop());
    ui.playing = null;
    markVoiceNote(-1, -1, -1);
    Midi.silence();
    document.querySelectorAll('.playhead').forEach((h) => { h.hidden = true; });
    highlight(-1);
    renderTransport();
  }

  // Un temporizador en un worker sigue a su ritmo con la ventana en segundo plano,
  // que es lo normal si estás mirando el instrumento o tu programa de música.
  function startTicker(fn) {
    try {
      const code = 'setInterval(() => postMessage(0), 25);';
      const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      worker.onmessage = fn;
      worker.onerror = () => { worker.terminate(); setInterval(fn, 25); };
    } catch (e) {
      setInterval(fn, 25);
    }
  }

  // Eventos --------------------------------------------------------------------

  document.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (cell) {
      const [track, i, s, off] = cell.dataset.cell.split(':');
      toggleCell(track, Number(i), Number(s), Number(off));
      return;
    }
    const label = e.target.closest('[data-note]');
    if (label) { emitNote(M.midiOf(Number(label.dataset.note), key)); return; }
    const dot = e.target.closest('[data-dot]');
    if (dot) {
      const [ring, step] = dot.dataset.dot.split(':').map(Number);
      snapshot();
      const { steps } = state.rings[ring];
      steps[step] = steps[step] ? 0 : 1;
      changedRings();
      return;
    }
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled) ACTIONS[el.dataset.act](el);
  });

  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.menu[open]').forEach((m) => {
      if (!m.contains(e.target)) m.open = false;
    });
  });

  document.addEventListener('input', (e) => {
    if (e.target.dataset.ring !== undefined && e.target.type === 'range') ringInput(e.target);
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.ring !== undefined && e.target.tagName === 'SELECT') ringInput(e.target);
  });

  document.addEventListener('keydown', (e) => {
    // Tab cambia de pestaña. Mayús+Tab conserva la navegación por teclado del navegador.
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (document.activeElement) document.activeElement.blur();
      setTab(TABS[(TABS.indexOf(state.tab) + 1) % TABS.length]);
      return;
    }
    if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach((m) => { m.open = false; });
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); ACTIONS.undo(); return; }
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); ACTIONS.play(); }
  });

  startTicker(() => { schedule(); Midi.flush(); });
  recompute();
  render();
  refreshVoice();
  if (state.midiOn && Midi.supported()) connectMidi();
})();
