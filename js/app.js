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
  const { tx, tr } = globalThis.I18n;
  const $ = (id) => document.getElementById(id);

  const STORE = 'enlace.v1';
  const DEFAULTS = {
    tonic: 0, scale: 'ionian', level: 0, instrument: 'guitar', notation: 'latin', lang: null,
    outside: true, smooth: true, bpm: 88, loop: true, playChords: true, playMelody: true,
    tab: 'chords', comp: 'whole', midiOn: false, midiOut: null,
    sendChords: true, sendMelody: true, sendDrums: true,
    midiChordCh: 1, midiMelodyCh: 2, midiDrumCh: 10, localSound: true,
    rings: [], life: 0, playDrums: true,
    stanza: 0, voiceBody: 'female', accent: 'es', octave: 'auto',
    vibrato: 35, breath: 15, bright: 25, voiceVol: 80, playVoice: true, force: 55,
    harmony: 'off', harmonyBody: 'male', harmonyVol: 70, reverb: 25, echo: 0, echoTime: 'dotted',
    prog: [], name: '', melVerses: 1, mstanza: 0, region: null,
  };
  // Lo que es de la canción y viaja en el archivo del proyecto. El resto (idioma,
  // pestaña, instrumento a la vista, MIDI…) es del equipo y se queda en el navegador.
  const SONG_KEYS = ['name', 'tonic', 'scale', 'level', 'bpm', 'loop', 'comp', 'prog', 'rings', 'life',
    'playChords', 'playMelody', 'playDrums', 'playVoice', 'stanzas', 'stanza', 'melVerses', 'mstanza',
    'swingChords', 'swingMelody', 'swingDrums', 'swingVoice',
    'voiceBody', 'accent', 'octave', 'vibrato', 'breath', 'bright', 'voiceVol', 'force',
    'harmony', 'harmonyBody', 'harmonyVol', 'reverb', 'echo', 'echoTime'];
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

  const MAX_VERSES = 8;

  // Pone al día una canción guardada con una versión anterior (en el navegador o en un archivo).
  function migrate(o) {
    // La letra pasó a estar por estrofas, cada una con su melodía para la voz.
    // Antes la voz cantaba la melodía instrumental: se copia para no perder nada.
    if (!Array.isArray(o.stanzas) || !o.stanzas.length) {
      o.stanzas = [{ lyrics: o.lyrics || '' }];
      if (o.lyrics) (o.prog || []).forEach((it) => { if (!it.vmel) it.vmel = [(it.mel || (it.mels && it.mels[0]) || []).slice()]; });
    }
    delete o.lyrics;
    // La melodía instrumental pasó a ser una por estrofa, como la de la voz.
    (o.prog || []).forEach((it) => {
      if (!Array.isArray(it.mels)) it.mels = Array.isArray(it.mel) ? [it.mel] : [];
      delete it.mel;
    });
    // Las estrofas de la melodía se cuentan aparte de las de la letra.
    // (Cubre también las melodías guardadas por estrofa antes de que hubiera recuento.)
    const stored = Number.isInteger(o.melVerses) && o.melVerses > 0 ? o.melVerses : 1;
    o.melVerses = Math.min(MAX_VERSES, Math.max(stored, ...(o.prog || []).map((it) => it.mels.length)));
    // El swing pasó a ser de cada parte; las versiones anteriores tenían uno común.
    ['swingChords', 'swingMelody', 'swingDrums', 'swingVoice'].forEach((k) => {
      if (typeof o[k] !== 'number') o[k] = typeof o.swing === 'number' ? o.swing : 50;
    });
    delete o.swing;
    return o;
  }
  migrate(state);

  // Idioma: el guardado o, la primera vez, el del navegador.
  if (state.lang !== 'es' && state.lang !== 'en') {
    state.lang = /^es\b/i.test((globalThis.navigator && navigator.language) || 'es') ? 'es' : 'en';
  }
  globalThis.I18n.set(state.lang);

  // Estado que no se guarda.
  const ui = {
    sel: state.prog.length - 1, preview: null, previewG: 0, previewP: 0,
    more: false, undo: [], seed: Date.now() % 100000, cursor: null, playing: null, midiError: null,
    voice: { key: null, status: 'idle', progress: 0 }, voiceTimer: 0, fileMsg: null, startBar: 0, copyPick: false,
  };

  let key;
  let catalog;
  let chords;
  let voicings;

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignorar */ }
    // Cualquier cambio puede afectar a lo que canta la voz: se vuelve a cantar si hace falta.
    refreshVoice();
    renderTimeline();
  }

  function snapshot() {
    ui.undo.push(JSON.stringify({ prog: state.prog, sel: ui.sel, rings: state.rings, stanzas: state.stanzas, stanza: state.stanza, melVerses: state.melVerses, mstanza: state.mstanza }));
    if (ui.undo.length > 60) ui.undo.shift();
  }

  // Los acordes se guardan por grado, de modo que cambiar de tónica los transporta.
  function hydrate(item) {
    const root = T.note(key.tonic.l + item.off, key.pc + item.semi);
    const probe = T.makeChord(root, item.q, key);
    if (catalog.has(probe.id)) return catalog.get(probe.id);
    return T.fitsScale(probe, key) ? probe : T.makeChord(root, item.q, key, { kind: 'outside' });
  }

  // Melodías por estrofa, guardadas en cada compás (it.mels[k] la instrumental,
  // it.vmel[k] la de la voz) para que sigan a los acordes si se quitan o se mueven.
  const EMPTY_BAR = Object.freeze(Array(M.STEPS).fill(null));
  const MAX_STANZAS = MAX_VERSES;
  const barsOf = (field, k) => state.prog.slice(0, chords.length).map((it) => (it[field] && it[field][k]) || EMPTY_BAR);
  function barW(field, i, k) {
    const it = state.prog[i];
    if (!it[field]) it[field] = [];
    while (it[field].length <= k) it[field].push(Array(M.STEPS).fill(null));
    return it[field][k];
  }
  const melOf = (k) => barsOf('mels', k);
  const melAt = (i, k) => (state.prog[i] && state.prog[i].mels && state.prog[i].mels[k]) || EMPTY_BAR;

  function itemFrom(chord) {
    return {
      off: mod(chord.root.l - key.tonic.l, 7),
      semi: mod(chord.root.pc - key.pc),
      q: chord.q.id,
      mels: [],
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
      // Sin posición elegida (o con una inválida, p. ej. de un archivo editado a mano) se busca una.
      const gi = clampIdx(Number.isInteger(it.g) ? it.g : state.smooth ? V.pickGuitar(c, g) : 0, gl);
      const pi = clampIdx(Number.isInteger(it.p) ? it.p : state.smooth ? V.pickPiano(c, p) : 0, pl);
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

  const fnLabel = (f) => ({ T: tx('Tónica', 'Tonic'), S: tx('Subdominante', 'Subdominant'), D: tx('Dominante', 'Dominant'), M: tx('Color modal', 'Modal colour') })[f];

  function chordLabel(c) {
    return `${T.chordText(c, state.notation)}, ${tr(c.q.label)}`;
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
    return D.piano(start, end, marks, { label: tx('Teclado: ', 'Keyboard: ') + chordLabel(c) });
  }

  function diagramsFor(c, g, p, big) {
    const out = [];
    if (state.instrument !== 'piano') out.push(`<div class="dg g">${D.guitar(g, c.root.pc, { fingers: big, label: tx('Guitarra: ', 'Guitar: ') + chordLabel(c) })}</div>`);
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
    const scales = groups.map((g) => `<optgroup label="${tr(g)}">${T.SCALES.filter((s) => s.group === g)
      .map((s) => `<option value="${s.id}" ${s.id === state.scale ? 'selected' : ''}>${tr(s.name)}</option>`).join('')}</optgroup>`).join('');

    $('controls').innerHTML = `
      <select id="c-tonic" aria-label="${tx('Tónica', 'Tonic')}">${tonics}</select>
      <select id="c-scale" class="wide" aria-label="${tx('Escala o modo', 'Scale or mode')}">${scales}</select>
      ${seg('level', [[0, tx('Tríadas', 'Triads')], [1, tx('Con 7ª', 'Sevenths')], [2, tx('Todos', 'All')]], state.level)}
      ${seg('instrument', [['guitar', tx('Guitarra', 'Guitar')], ['piano', 'Piano'], ['both', tx('Ambos', 'Both')]], state.instrument)}`;
    $('options').innerHTML = `
      <div class="field"><span>${tx('Notas', 'Note names')}</span>${seg('notation', [['latin', 'Do Re Mi'], ['intl', 'C D E']], state.notation)}</div>
      <label class="check"><input type="checkbox" id="c-outside" ${state.outside ? 'checked' : ''}> ${tx('Sugerir fuera de escala', 'Suggest chords outside the scale')}</label>
      <label class="check"><input type="checkbox" id="c-smooth" ${state.smooth ? 'checked' : ''}> ${tx('Enlazar posiciones', 'Link voicings smoothly')}</label>`;
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
        <button class="pc-main" data-act="select" data-i="${i}" aria-label="${tx('Seleccionar', 'Select')} ${chordLabel(c)}">
          <span class="roman">${c.roman}</span>${nameHTML(c)}
          <span class="pc-dg">${diagramsFor(c, v.g, v.p, false)}</span>
        </button>
        <button class="x" data-act="remove" data-i="${i}" aria-label="${tx('Quitar', 'Remove')} ${T.chordText(c, state.notation)}">×</button>
      </article>`;
    }).join('');

    const empty = `<div class="empty">
        <p>${tx(`<strong>Empieza por un acorde.</strong> Elige uno abajo o carga una progresión de ${I18n.scaleInText(key.scale.name)}:`, `<strong>Start with a chord.</strong> Pick one below or load a ${I18n.scaleInText(key.scale.name)} progression:`)}</p>
        <div class="chips">${presetButtons().slice(0, 4).join('') || `<span class="muted">${tx('Elige la tónica en «Siguiente acorde».', 'Pick the tonic under “Next chord”.')}</span>`}</div>
      </div>`;

    $('strip').innerHTML = `<div class="pcs">${chords.length ? cards : empty}</div>`;
    renderTransport();
  }

  function renderTransport() {
    $('transport').innerHTML = `
      <button class="primary" data-act="play" ${canPlay() ? '' : 'disabled'}>${ui.playing ? tx('■ Parar', '■ Stop') : tx('▶ Reproducir', '▶ Play')}</button>
      <label class="bpm">${state.bpm} ${tx('ppm', 'bpm')} <input type="range" id="c-bpm" min="50" max="180" step="2" value="${state.bpm}" aria-label="Tempo"></label>
      <label class="bpm swing" title="${tx('Swing de la pestaña actual; cada parte tiene el suyo', 'Swing of the current tab; each part has its own')}">Swing <small class="swing-scope">${swingScope()}</small>
        <input type="range" id="c-swing" min="50" max="75" step="1" value="${state[swingKey()]}" aria-label="Swing ${swingScope()}"> <span id="swing-value">${swingLabel(state[swingKey()])}</span></label>
      <select id="c-comp" aria-label="${tx('Ritmo de los acordes', 'Chord rhythm')}">${Object.entries(M.COMP).map(([id, c]) =>
        `<option value="${id}" ${id === state.comp ? 'selected' : ''}>${tr(c.name)}</option>`).join('')}</select>
      <button data-act="toggle-loop" aria-pressed="${state.loop}" title="${tx('Repite la canción entera. Un bucle elegido en la línea de tiempo se repite siempre.', 'Repeats the whole song. A loop picked on the timeline always repeats.')}">${tx('Bucle', 'Loop')}</button>
      <button data-act="undo" ${ui.undo.length ? '' : 'disabled'}>${tx('Deshacer', 'Undo')}</button>
      <button data-act="clear" ${chords.length ? '' : 'disabled'}>${tx('Vaciar', 'Clear')}</button>`;
    $('c-bpm').oninput = (e) => {
      state.bpm = Number(e.target.value);
      e.target.parentElement.firstChild.textContent = state.bpm + tx(' ppm ', ' bpm ');
      save();
      applyFx();
      if (state.tab === 'voice') renderVoice();
    };
    $('c-swing').oninput = (e) => {
      state[swingKey()] = Number(e.target.value);
      $('swing-value').textContent = swingLabel(state[swingKey()]);
      updateSwingHint();
      save();
      if (state.tab === 'voice') renderVoice();
    };
    $('c-comp').onchange = (e) => { state.comp = e.target.value; updateSwingHint(); save(); };
    updateSwingHint();
  }

  const swingLabel = (v) => (v === 50 ? tx('recto', 'straight') : v + '%');

  // Cada parte tiene su swing. El deslizador de la barra controla el de la pestaña
  // que se ve (Letra y Voz comparten el de la voz).
  const SWING_KEYS = { chords: 'swingChords', melody: 'swingMelody', drums: 'swingDrums', letra: 'swingVoice', voice: 'swingVoice' };
  const swingKey = () => SWING_KEYS[state.tab] || 'swingChords';
  const swingScope = () => ({
    chords: tx('acordes', 'chords'), melody: tx('melodía', 'melody'), drums: tx('percusión', 'drums'),
    letra: tx('voz', 'voice'), voice: tx('voz', 'voice'),
  })[state.tab] || '';

  // Con golpes solo en partes fuertes el swing no altera los acordes: se avisa.
  function updateSwingHint() {
    const onBeats = M.COMP[state.comp].hits.every((s) => s % 2 === 0);
    $('c-comp').title = state.swingChords > 50 && onBeats
      ? tx('Este ritmo no tiene contratiempos: el swing de los acordes no se oirá', 'This rhythm has no off-beats: the chord swing will not be heard')
      : tx('Ritmo de los acordes', 'Chord rhythm');
    $('c-comp').classList.toggle('needs-offbeat', state.swingChords > 50 && onBeats);
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
      <button class="sg-main" data-act="add" data-id="${c.id}" aria-label="${tx('Añadir', 'Add')} ${chordLabel(c)}">
        <span class="sg-head">
          <span class="roman">${c.roman}</span>${nameHTML(c)}
          <span class="meter" title="${tx(`Encaje ${s.score} de 100`, `Fit ${s.score} out of 100`)}"><i style="width:${s.score}%"></i></span>
        </span>
        ${origin ? `<span class="origin">${tr(origin)}</span>` : ''}
        <span class="sg-body">
          <span class="why">${s.reasons.slice(0, 2).map((r) => `<span class="r-${r.kind}">${tr(r.text)}</span>`).join('')}</span>
          <span class="sg-dg">${diagramsFor(c, gv, pv, false)}</span>
        </span>
      </button>
      <button class="hear" data-act="preview" data-id="${c.id}" aria-label="${tx('Escuchar y ver', 'Hear and view')} ${T.chordText(c, state.notation)}">▶</button>
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
      ? `${tx('Después de', 'After')} ${nameHTML(current)}`
      : tx('Para empezar', 'To begin');
    const insertNote = nextChord ? `<span class="muted"> · ${tx('se inserta antes de', 'inserted before')} ${T.chordText(nextChord, state.notation)}</span>` : '';

    $('next').innerHTML = `
      <div class="panel-head"><h2>${title}${insertNote}</h2>
        <div class="legend">${['T', 'S', 'D', 'M'].map((k) => `<span class="fn-${k}"><i></i>${fnLabel(k)}</span>`).join('')}</div>
      </div>
      <div class="sgs">${a.slice(0, nIn).map((s) => suggestionCard(s, currentV)).join('')}</div>
      ${b.length ? `<h3>${tx('Fuera de la escala', 'Outside the scale')}</h3><div class="sgs">${b.slice(0, nOut).map((s) => suggestionCard(s, currentV)).join('')}</div>` : ''}
      <button class="link" data-act="more">${ui.more ? tx('Ver menos', 'Show fewer') : tx('Ver más opciones', 'Show more options')}</button>`;
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


  function renderDetail() {
    const f = focusChord();
    if (!f) {
      $('detail').innerHTML = `<div class="panel-head"><h2>${tx('Escala', 'Scale')}</h2></div>
        <p class="muted">${tx(`Notas de ${noteLabel(key.tonic)} ${I18n.scaleInText(key.scale.name)}:`, `Notes of ${noteLabel(key.tonic)} ${I18n.scaleInText(key.scale.name)}:`)}</p>
        <p class="scale-notes">${key.notes.map((n) => `<span><b>${noteLabel(n)}</b><i>${n.deg.replace('b', '♭').replace('#', '♯')}</i></span>`).join('')}</p>`;
      return;
    }
    const { c } = f;
    const origin = originLabel(c);
    const nav = (act, i, len) => (len > 1 ? `<div class="vnav">
        <button data-act="${act}" data-d="-1" aria-label="${tx('Posición anterior', 'Previous voicing')}">‹</button><span>${i + 1} / ${len}</span>
        <button data-act="${act}" data-d="1" aria-label="${tx('Posición siguiente', 'Next voicing')}">›</button></div>` : '');

    const big = [];
    if (state.instrument !== 'piano') {
      big.push(`<div class="big g">${D.guitar(f.g, c.root.pc, { label: tx('Guitarra: ', 'Guitar: ') + chordLabel(c) })}${nav('voice-g', f.gi, f.gl.length)}</div>`);
    }
    if (state.instrument !== 'guitar') {
      big.push(`<div class="big p">${pianoFor(f.p, c, true)}${nav('voice-p', f.pi, f.pl.length)}</div>`);
    }

    $('detail').innerHTML = `
      <div class="panel-head">
        <h2 class="detail-title">${nameHTML(c)} <span class="roman">${c.roman}</span></h2>
        <div class="row">
          <button data-act="hear-focus">${tx('▶ Escuchar', '▶ Listen')}</button>
          ${f.preview ? `<button class="primary" data-act="add" data-id="${c.id}">${tx('Añadir', 'Add')}</button><button data-act="close-preview">${tx('Cerrar', 'Close')}</button>` : ''}
        </div>
      </div>
      <p class="meta"><span class="tag fn-${c.fn}">${fnLabel(c.fn)}</span> ${tr(c.q.label)}${origin ? ' · ' + tr(origin) : ''}</p>
      <div class="detail-body">
        <p class="tones">${c.tones.map((t) => `<span><b>${noteLabel(t)}</b><i>${t.deg.replace('b', '♭').replace('#', '♯')}</i></span>`).join('')}</p>
        <div class="bigs">${big.join('')}</div>
      </div>`;
  }
  // Editor de melodía ----------------------------------------------------------

  function legendHTML() {
    return `<div class="mel-legend">
          <span class="r-chord"><i></i>${tx('Del acorde: reposo', 'Chord tone: rest')}</span>
          <span class="r-tension"><i></i>${tx('De la escala: movimiento', 'Scale tone: movement')}</span>
          <span class="r-avoid"><i></i>${tx('Choca: úsala de paso', 'Clashes: use in passing')}</span>
          <span class="r-out"><i></i>${tx('Fuera de escala', 'Outside the scale')}</span>
        </div>`;
  }

  // Rejilla de notas. track 'm': melodía instrumental; 'v': la voz en la estrofa
  // actual, con una fila encima para las sílabas (lyrics: notas con su sílaba).
  function gridHTML(track, lyrics = null) {
    const list = M.rows(key, chords);
    const steps = chords.length * M.STEPS;
    const hint = melodyHints(list, track);
    const bars = track === 'v' ? vmelOf(state.stanza) : melOf(state.mstanza);
    const barMel = (i) => bars[i];
    // En la voz, la segunda voz se dibuja como notas fantasma.
    const showHarm = track === 'v' && state.harmony !== 'off' && state.stanzas[state.stanza].harmony !== false;

    const head = chords.map((c, i) =>
      `<button class="mel-chord fn-${c.fn} ${i === ui.sel ? 'is-sel' : ''}" data-act="select" data-i="${i}" style="grid-column:span ${M.STEPS}" aria-label="${tx('Ver notas sobre', 'See notes over')} ${chordLabel(c)}">${nameHTML(c)}</button>`).join('');

    let lyricRow = '';
    if (lyrics) {
      const at = new Map(lyrics.map((p) => [p.i * M.STEPS + p.s, p]));
      lyricRow = `<div class="mel-label lyr-label">${tx('Letra', 'Lyrics')}</div>`;
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
        const mel = barMel(i).map((x) => (x === null ? null : M.snap(x, list)));
        const hm = showHarm ? mel.map((x) => (x === null ? null : Voice.harmonize(x, key, state.harmony))) : null;
        let held = false;
        let hHeld = false;
        for (let s = 0; s < M.STEPS; s++) {
          const on = mel[s] === off;
          if (mel[s] !== null) held = on;
          const cls = ['cell', 'r-' + r];
          if (on) cls.push('on');
          else if (held) cls.push('held');
          if (hm) {
            const hOn = hm[s] === off;
            if (hm[s] !== null) hHeld = hOn;
            if (hOn) cls.push('harm');
            else if (hHeld) cls.push('harm', 'harm-held');
          }
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
      el.innerHTML = `<p class="muted">${tx('Crea una progresión en la pestaña Progresión y aquí podrás escribir una melodía sobre ella.', 'Build a progression in the Progression tab and you can write a melody over it here.')}</p>`;
      return;
    }

    state.mstanza = Math.min(Math.max(0, state.mstanza), state.melVerses - 1);
    el.innerHTML = `
      <div class="panel-head">
        ${stanzaBar('m')}
        <div class="row">
          <button class="primary" data-act="mel-generate">${tx('Proponer melodía', 'Suggest a melody')}</button>
          <button data-act="mel-clear">${tx('Borrar melodía', 'Clear melody')}</button>
        </div>
      </div>
      <div class="panel-head mel-sub">${legendHTML()}</div>
      <p class="muted help">${tx('Haz clic para poner una nota; suena hasta la siguiente. Otro clic la quita. Los aros marcan buenas notas para continuar. Cada estrofa suena en una vuelta de la progresión. La voz tiene su propia melodía y sus propias estrofas, en la pestaña Letra; si una parte tiene menos estrofas que la otra, vuelve a empezar.', 'Click to place a note; it lasts until the next one. Click again to remove it. Rings mark good notes to continue. Each verse plays over one pass of the progression. The voice has its own melody and its own verses, in the Lyrics tab; if one part has fewer verses than the other, it starts over.')}</p>
      <div class="mel-scroll">${gridHTML('m')}</div>`;
    el.querySelector('.mel-scroll').scrollLeft = left;
  }

  function melodyHints(list, track) {
    if (!ui.cursor || ui.cursor.track !== track) return null;
    let { i, s } = ui.cursor;
    if (!state.prog[i]) return null;
    const cur = (track === 'v' ? vmelOf(state.stanza) : melOf(state.mstanza))[i][s];
    if (cur === null || cur === undefined) return null;
    const prev = M.snap(cur, list);
    s += 1;
    if (s >= M.STEPS) { s = 0; i += 1; }
    if (i >= chords.length) return null;
    return { i, s, offs: M.hints(prev, chords[i], key, list, s % 4 === 0) };
  }

  function toggleCell(track, i, s, off) {
    snapshot();
    const mel = track === 'v' ? vmelW(i, state.stanza) : barW('mels', i, state.mstanza);
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
      // La progresión sigue al acorde sobre el que estás escribiendo.
      ui.sel = i;
      ui.preview = null;
      renderStrip();
      renderNext();
      renderDetail();
    }
    renderMelody();
  }

  // Otras secciones ------------------------------------------------------------

  function presetButtons() {
    return presetsFor(key).map((p, i) =>
      `<button class="preset" data-act="preset" data-i="${i}"><b>${tr(p.name)}</b><span>${p.chords.map((c) => c.roman).join(' – ')}</span></button>`);
  }

  function renderField() {
    const list = [...catalog.values()].filter((c) => c.origin.kind === 'scale' && levelAllows(c));
    $('field').innerHTML = `
      <div class="panel-head"><h2>${tx('Acordes de la escala', 'Chords in the scale')}</h2>
        <p class="scale-inline">${key.notes.map((n) => noteLabel(n)).join(' ')}</p></div>
      <div class="fieldchips">${list.map((c) =>
        `<button class="fc fn-${c.fn}" data-act="add" data-id="${c.id}" aria-label="${tx('Añadir', 'Add')} ${chordLabel(c)}"><span class="roman">${c.roman}</span>${nameHTML(c)}</button>`).join('')}</div>`;
  }

  function renderPresets() {
    const list = presetButtons();
    $('presets').innerHTML = `<div class="panel-head"><h2>${tx('Progresiones conocidas', 'Well-known progressions')}</h2></div>
      ${list.length ? `<div class="presets">${list.join('')}</div>`
        : `<p class="muted">${tx('No hay progresiones guardadas para esta escala. Construye la tuya con las sugerencias.', 'No saved progressions for this scale. Build your own from the suggestions.')}</p>`}`;
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
    const name = tr(Drums.necklaceName(r.steps));
    return `<div class="ring-row fam-${Drums.INSTRUMENTS[r.inst].family} ${r.muted ? 'is-muted' : ''}">
      <i class="swatch"></i>
      <select class="ring-inst" data-ring="${i}" data-f="inst" aria-label="${tx('Instrumento', 'Instrument')}">${options(Object.entries(Drums.INSTRUMENTS).map(([id, x]) => [id, tr(x.name)]), r.inst)}</select>
      <label class="ring-num ring-n">${tx('Pasos', 'Steps')} <input type="range" min="2" max="${Drums.MAX_STEPS}" value="${n}" data-ring="${i}" data-f="n"><b id="ring-n-${i}">${n}</b></label>
      <label class="ring-num ring-k">${tx('Golpes', 'Hits')} <input type="range" min="0" max="${n}" value="${k}" data-ring="${i}" data-f="k" id="ring-kr-${i}"><b id="ring-k-${i}">${k}</b></label>
      <span class="row ring-acts">
        <button data-act="ring-rotate" data-i="${i}" data-d="-1" aria-label="${tx('Girar a la izquierda', 'Rotate left')}">↺</button>
        <button data-act="ring-rotate" data-i="${i}" data-d="1" aria-label="${tx('Girar a la derecha', 'Rotate right')}">↻</button>
        <button data-act="ring-mute" data-i="${i}" aria-pressed="${r.muted}">${tx('Mudo', 'Mute')}</button>
        <button data-act="ring-remove" data-i="${i}" aria-label="${tx('Quitar anillo', 'Remove ring')}">×</button>
        <span class="necklace" id="ring-name-${i}">${name || ''}</span>
      </span>
      <select class="ring-gate" data-ring="${i}" data-f="gate" aria-label="${tx('Cuándo toca', 'When it plays')}" title="${tx('Cuándo toca este anillo', 'When this ring plays')}">${options(Object.entries(Drums.GATES).map(([id, g]) => [id, tr(g)]), r.gate)}</select>
    </div>`;
  }

  function renderRings() {
    const full = state.rings.length >= Drums.MAX_RINGS;
    $('rings').innerHTML = `
      <div class="panel-head">
        <div class="row">
          <button class="primary" data-act="drum-invent">${tx('Inventar ritmo', 'Invent a rhythm')}</button>
          <button data-act="drum-mutate" ${state.rings.length ? '' : 'disabled'}>${tx('Mutar', 'Mutate')}</button>
          <button data-act="ring-add" ${full ? 'disabled' : ''}>${tx('Añadir anillo', 'Add ring')}</button>
        </div>
        <div class="row">
          <label class="bpm">${tx('Vida', 'Life')} <input type="range" id="c-life" min="0" max="100" step="5" value="${state.life}" aria-label="${tx('Variación entre compases', 'Variation between bars')}"> <span id="life-value">${state.life}%</span></label>
          <button data-act="drum-clear" ${state.rings.length ? '' : 'disabled'}>${tx('Vaciar', 'Clear')}</button>
        </div>
      </div>
      <div class="ring-list">${state.rings.length ? state.rings.map(ringRow).join('')
        : `<p class="muted">${tx('Cada anillo es un instrumento y da una vuelta por compás. Si tienen distinto número de pasos, se forma una polirritmia. Elige un ritmo para empezar.', 'Each ring is an instrument and goes round once per bar. When rings have different step counts, they form a polyrhythm. Pick a rhythm to start.')}</p>`}</div>
      <div class="drum-presets">${Drums.PRESETS.map((p, i) =>
        `<button data-act="drum-preset" data-i="${i}">${tr(p.name)}</button>`).join('')}</div>`;
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
    $(`ring-name-${i}`).textContent = tr(Drums.necklaceName(r.steps)) || '';
    save();
    renderWheel();
    renderTransport();
  }

  function drumHits(p, i, mk) {
    const stepMs = 30000 / state.bpm;
    const barMs = stepMs * M.STEPS;
    const mel = melAt(i, mk);
    const barAt = p.next;
    return Drums.barHits(state.rings, {
      life: state.life / 100,
      rand: Math.random,
      melody: mel.flatMap((off, s) => (off === null ? [] : [s])),
      chordHits: chords.length ? M.COMP[state.comp].hits : [],
    }).map((h) => ({ ...h, at: barAt + Drums.swungPos(h.pos, state.swingDrums) * barMs }));
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
    const head = $('tl-head');
    if (head && p && p.barSeen) {
      const barMs = (30000 / state.bpm) * M.STEPS;
      const frac = Math.min(1, (performance.now() - p.barSeen) / barMs);
      const pos = (p.shownG + frac) / songBars();
      head.style.left = Math.min(100, pos * 100) + '%';
      const t = $('tl-time');
      if (t) t.firstChild.textContent = clock((p.shownG + frac) * barMs / 1000);
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
      el.innerHTML = `<p class="muted">${tx('Este navegador no permite MIDI. Abre la web en Chrome o Edge.', 'This browser does not support MIDI. Open the page in Chrome or Edge.')}</p>`;
      return;
    }
    if (!Midi.connected) {
      el.innerHTML = `
        <button data-act="midi-connect">${tx('Conectar instrumento', 'Connect instrument')}</button>
        <p class="muted">${tx('Enchúfalo por USB antes de conectar. El navegador te pedirá permiso.', 'Plug it in over USB before connecting. The browser will ask for permission.')}</p>
        ${ui.midiError ? `<p class="midi-error">${ui.midiError}</p>` : ''}`;
      return;
    }
    const outs = Midi.list();
    const current = Midi.output;
    if (!outs.length) {
      el.innerHTML = `<p class="muted">${tx('No se detecta ningún instrumento. Conéctalo por USB y aparecerá aquí.', 'No instrument detected. Connect it over USB and it will appear here.')}</p>`;
      return;
    }
    el.innerHTML = `
      <label class="field wide"><span>${tx('Instrumento', 'Instrument')}</span><select id="m-out">${outs.map((o) =>
        `<option value="${escapeAttr(o.id)}" ${current && o.id === current.id ? 'selected' : ''}>${escapeText(o.name)}</option>`).join('')}</select></label>
      <div class="field"><span>${tx('Enviar', 'Send')}</span><div class="seg" role="group">
        ${[['sendChords', tx('Progresión', 'Progression')], ['sendMelody', tx('Melodía', 'Melody')], ['sendDrums', tx('Percusión', 'Drums')]].map(([k, label]) =>
          `<button data-act="midi-send" data-v="${k}" aria-pressed="${state[k]}">${label}</button>`).join('')}
      </div></div>
      ${sendsChords() ? channelSelect('m-chord-ch', tx('Canal progresión', 'Progression channel'), state.midiChordCh) : ''}
      ${sendsMelody() ? channelSelect('m-melody-ch', tx('Canal melodía', 'Melody channel'), state.midiMelodyCh) : ''}
      ${state.sendDrums ? channelSelect('m-drum-ch', tx('Canal percusión', 'Drum channel'), state.midiDrumCh) : ''}
      <label class="check"><input type="checkbox" id="m-local" ${state.localSound ? 'checked' : ''}> ${tx('Sonar también en el navegador', 'Also play in the browser')}</label>
      <button data-act="midi-panic">${tx('Silenciar instrumento', 'Silence instrument')}</button>`;
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
        ? tx('El navegador ha denegado el acceso. Permite MIDI en el icono junto a la dirección y vuelve a intentarlo.', 'The browser denied access. Allow MIDI from the icon next to the address bar and try again.')
        : tx('No se pudo acceder a MIDI: ', 'Could not access MIDI: ') + e.message;
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


  // La voz tiene su propia melodía, una por estrofa, guardada en cada compás
  // (it.vmel[k]) para que siga a los acordes si se quitan o se mueven.
  const vmelOf = (k) => barsOf('vmel', k);
  const vmelW = (i, k) => barW('vmel', i, k);
  // Cada idioma canta con sus fonemas: español con reglas propias, inglés con el diccionario CMU.
  function syllsOf(k) {
    const text = (state.stanzas[k] || {}).lyrics || '';
    return state.lang === 'en' ? Voice.english(text) : Spanish.syllables(text, { seseo: state.accent === 'latam' });
  }
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
    // Segunda voz: la misma línea movida dentro de la escala. Sigue la octava de la
    // principal para que «3ª arriba» quede arriba aunque la cante otro cuerpo.
    if (state.harmony !== 'off') {
      parts.forEach((p) => {
        const on = state.stanzas[p.k].harmony !== false;
        p.notes.forEach((n) => { n.harmonyMidi = on ? M.midiOf(Voice.harmonize(n.off, key, state.harmony), key) + 12 * oct : null; });
      });
    }
    all.forEach((n) => { n.midi += 12 * oct; });
    const stanzas = parts.map((p) => ({ k: p.k, sylls: p.sylls, ...Voice.align(p.notes, p.sylls) }));
    return { oct, stanzas, pairs: stanzas.flatMap((st) => st.pairs) };
  }

  function voiceRequest(plan) {
    if (!plan.pairs.some((p) => p.syl)) return null;
    return Voice.request({
      pairs: plan.pairs, bpm: state.bpm, swing: state.swingVoice, body: state.voiceBody,
      vibrato: state.vibrato, breath: state.breath / 100, bright: state.bright / 100, force: state.force,
      stanzas: state.stanzas.map((st) => ({ bars: chords.length, dyn: st.dyn })),
      harmony: state.harmony !== 'off' ? { body: state.harmonyBody } : null,
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
      // Ganancia fija, no normalizada: así la fuerza se oye. El motor no pasa de 0,75.
      [r.samples, r.harmony].forEach((buf) => { if (buf) for (let i = 0; i < buf.length; i++) buf[i] *= 1.2; });
      Object.assign(job, { status: 'ready', samples: r.samples, harmony: r.harmony, rate: r.sampleRate });
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

  const voiceLevel = (kind = 'lead') => (state.playVoice ? .55 * state.voiceVol / 100 * (kind === 'lead' ? 1 : state.harmonyVol / 100) : 0);

  // La toma de la voz cubre todas sus estrofas. vb: compás de la toma por el que
  // se entra; en el 0 se arranca antes para que las consonantes lleguen a tiempo.
  // jump: la reproducción salta (bucle o posición elegida) y la toma anterior se corta.
  function startVoice(p, { at, vb, jump }) {
    if (jump) {
      p.voices.forEach((v) => v.node.stop(at));
      p.voices = [];
    }
    const take = voiceTake();
    if (!take) return;
    const barSec = 4 * 60 / state.bpm;
    const delay = (at - performance.now()) / 1000 - (vb === 0 ? Voice.LEAD : 0);
    const offset = vb === 0 ? 0 : Voice.LEAD + vb * barSec;
    const lead = Sound.buffer(take.samples, take.rate, delay, voiceLevel('lead'), take.harmony ? -.12 : 0, offset);
    if (lead) p.voices.push({ kind: 'lead', node: lead });
    if (take.harmony) {
      const h = Sound.buffer(take.harmony, take.rate, delay, voiceLevel('harmony'), .3, offset);
      if (h) p.voices.push({ kind: 'harmony', node: h });
    }
  }

  function voiceGain() {
    if (ui.playing) ui.playing.voices.forEach((v) => v.node.gain(voiceLevel(v.kind)));
  }

  // El eco cae a tempo: a la corchea, a la corchea con puntillo o a la negra.
  const ECHO_TIMES = { eighth: { name: ['Corchea', 'Eighth'], long: ['a la corchea', 'every eighth note'], beats: .5 }, dotted: { name: ['Puntillo', 'Dotted'], long: ['a la corchea con puntillo', 'every dotted eighth'], beats: .75 }, quarter: { name: ['Negra', 'Quarter'], long: ['a la negra', 'every quarter note'], beats: 1 } };
  const echoSeconds = () => 60 / state.bpm * ECHO_TIMES[state.echoTime].beats;
  function applyFx() {
    Sound.voiceFx({ reverb: state.reverb / 100, echo: state.echo / 100, echoTime: echoSeconds() });
  }

  function markVoiceNote(k, i, s) {
    document.querySelectorAll('.va-note.is-now, .lyr-cell.is-now').forEach((el) => el.classList.remove('is-now'));
    document.querySelectorAll(`.va-note[data-vn="${k}:${i}:${s}"], .lyr-cell[data-vn="${k}:${i}:${s}"]`)
      .forEach((el) => el.classList.add('is-now'));
  }

  function renderVoiceStatus() {
    const v = ui.voice;
    const text = !Voice.supported() ? tx('Este navegador no puede ejecutar el motor de voz', 'This browser cannot run the voice engine') : {
      idle: tx('Escribe la letra para oírla', 'Write lyrics to hear them'),
      rendering: `${tx('Cantando…', 'Singing…')} ${Math.round(v.progress * 100)}%`,
      ready: tx('Voz lista', 'Voice ready'),
      error: tx('No se pudo cantar: ', 'Could not sing: ') + v.error,
    }[v.status];
    document.querySelectorAll('.voice-status').forEach((el) => {
      el.textContent = text;
      el.className = 'voice-status is-' + (Voice.supported() ? v.status : 'error');
      el.style.setProperty('--p', v.status === 'rendering' ? v.progress : v.status === 'ready' ? 1 : 0);
    });
  }

  // Selector de estrofas, común a Melodía y Letra: la estrofa elegida es la misma en las dos.
  // Mueve la estrofa `from` a la posición `to` de una parte, con todo lo suyo.
  function moveStanza(part, from, to) {
    const count = part === 'm' ? state.melVerses : stanzaCount();
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return;
    snapshot();
    const move = (arr) => { arr.splice(to, 0, arr.splice(from, 1)[0]); };
    const field = part === 'm' ? 'mels' : 'vmel';
    // Cada compás guarda sus melodías por estrofa: se completan antes de moverlas.
    state.prog.forEach((it, i) => { barW(field, i, count - 1); move(it[field]); });
    if (part === 'v') move(state.stanzas);
    // La estrofa elegida sigue siendo la misma, esté donde esté ahora.
    const key = part === 'm' ? 'mstanza' : 'stanza';
    const sel = state[key];
    if (sel === from) state[key] = to;
    else if (from < sel && to >= sel) state[key] = sel - 1;
    else if (from > sel && to <= sel) state[key] = sel + 1;
    ui.cursor = null;
    save();
    if (part === 'm') renderMelody(); else { renderLetra(); renderSong(); }
  }

  // part 'm': estrofas de la melodía; 'v': de la letra. Cada parte tiene las suyas.
  function stanzaBar(part) {
    const count = part === 'm' ? state.melVerses : stanzaCount();
    const cur = part === 'm' ? state.mstanza : state.stanza;
    const chips = Array.from({ length: count }, (x, k) =>
      `<button class="stanza-chip" data-act="stanza" data-part="${part}" data-v="${k}" data-k="${k}" aria-pressed="${k === cur}"${count > 1 ? ` title="${tx('Arrastra para cambiar el orden', 'Drag to reorder')}"` : ''}>${tx('Estrofa', 'Verse')} ${k + 1}</button>`).join('');
    return `<div class="row">
          <div class="seg" role="group" aria-label="${tx('Estrofas', 'Verses')}">${chips}</div>
          <button data-act="stanza-add" data-part="${part}" ${count >= MAX_STANZAS ? 'disabled' : ''} title="${tx('Añade una estrofa vacía al final', 'Adds an empty verse at the end')}">${tx('+ Estrofa', '+ Verse')}</button>
          <button data-act="stanza-dup" data-part="${part}" ${count >= MAX_STANZAS ? 'disabled' : ''} title="${tx(`Copia la estrofa ${cur + 1} justo después de ella`, `Copies verse ${cur + 1} right after it`)}">${tx('Duplicar', 'Duplicate')}</button>
          ${count > 1 ? `<button data-act="stanza-remove" data-part="${part}" title="${tx('Quitar la estrofa', 'Remove verse')} ${cur + 1}">${tx('Quitar', 'Remove')}</button>` : ''}
        </div>`;
  }

  // Pestaña Letra: estrofas, su texto y la melodía que canta la voz.
  function renderLetra() {
    const head = $('letra-head');
    if (!chords.length) {
      head.innerHTML = `<p class="muted">${tx('Crea una progresión en la pestaña Progresión y aquí podrás escribir la letra y la melodía que canta la voz.', 'Build a progression in the Progression tab and you can write the lyrics and the melody the voice sings here.')}</p>`;
      $('letra-grid').innerHTML = '';
      return;
    }
    state.stanza = Math.min(Math.max(0, state.stanza), stanzaCount() - 1);
    const st = state.stanzas[state.stanza];
    head.innerHTML = `
      <div class="panel-head">
        ${stanzaBar('v')}
        <div class="row">
          <span class="muted">${tx('Intensidad', 'Dynamics')}</span>${seg('stanza-dyn', [['p', tx('Suave', 'Soft')], ['mf', tx('Normal', 'Normal')], ['f', tx('Fuerte', 'Loud')]], st.dyn || 'mf')}
          ${state.harmony !== 'off' ? `<label class="check"><input type="checkbox" id="c-st-harmony" ${st.harmony !== false ? 'checked' : ''}> ${tx('Segunda voz', 'Second voice')}</label>` : ''}
        </div>
        <span class="voice-status" role="status"></span>
      </div>
      <textarea id="c-lyrics" rows="2" spellcheck="true" lang="${state.lang}" aria-label="${tx('Letra de la estrofa', 'Lyrics of verse')} ${state.stanza + 1}" placeholder="${tx(`Letra de la estrofa ${state.stanza + 1}. Por ejemplo: Cielito lindo, los ojos negros`, `Lyrics of verse ${state.stanza + 1}. For example: Twinkle twinkle little star`)}"></textarea>
      <p class="muted help">${tx('Cada estrofa suena en una vuelta de la progresión, con independencia de las estrofas de la melodía. Una sílaba por nota: «-» alarga la anterior, «_» une dos palabras (de_amor) y la puntuación marca dónde respirar. Se canta con pronunciación española.', 'Each verse plays over one pass of the progression, independently of the melody verses. One syllable per note: “-” holds the previous one, and punctuation marks where to breathe. Sung with English pronunciation.')}</p>`;
    const ta = $('c-lyrics');
    ta.value = state.stanzas[state.stanza].lyrics;
    ta.oninput = () => { state.stanzas[state.stanza].lyrics = ta.value; save(); renderLetraGrid(); };
    const hb = $('c-st-harmony');
    if (hb) hb.onchange = () => { st.harmony = hb.checked; save(); renderLetraGrid(); };
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
    if (al.extraSyllables.length) warn = `<p class="va-warn">${tx(`Sobran ${al.extraSyllables.length} sílabas sin nota: «${al.extraSyllables.map((x) => x.text).join(' ')}». Añade notas o pulsa «Ajustar a la letra».`, `${al.extraSyllables.length} syllables have no note: “${al.extraSyllables.map((x) => x.text).join(' ')}”. Add notes or press “Fit to lyrics”.`)}</p>`;
    else if (al.extraNotes && sylls.length) warn = `<p class="va-warn is-soft">${tx(`${al.extraNotes} notas sin letra: la voz calla en ellas.`, `${al.extraNotes} notes without lyrics: the voice rests on them.`)}</p>`;
    el.innerHTML = `
      <div class="panel-head">
        ${legendHTML()}
        <div class="row">
          <button class="primary" data-act="vmel-generate" title="${tx('Una nota por sílaba, con las frases en compases enteros', 'One note per syllable, each phrase in whole bars')}">${sylls.length ? tx('Ajustar a la letra', 'Fit to lyrics') : tx('Proponer melodía', 'Suggest a melody')}</button>
          <button data-act="vmel-copy" aria-expanded="${ui.copyPick}" title="${tx('Copia aquí la melodía de una estrofa de la pestaña Melodía', 'Copy the melody of a verse from the Melody tab')}">${tx('Copiar de Melodía', 'Copy from Melody')}</button>
          <button data-act="vmel-clear">${tx('Borrar', 'Clear')}</button>
        </div>
      </div>
      ${ui.copyPick ? copyPickHTML() : ''}
      <div class="mel-scroll">${gridHTML('v', al.pairs)}</div>${warn}`;
    el.querySelector('.mel-scroll').scrollLeft = left;
  }

  function copyMelody(mk) {
    snapshot();
    state.prog.forEach((it, i) => { vmelW(i, state.stanza).splice(0, M.STEPS, ...melAt(i, mk)); });
    ui.cursor = null;
    ui.copyPick = false;
    save();
    renderLetraGrid();
  }

  // Qué estrofa de la melodía copiar. Se propone la que suena junto a esta la primera vez.
  function copyPickHTML() {
    const suggested = state.stanza % state.melVerses;
    const opts = Array.from({ length: state.melVerses }, (x, k) =>
      `<button data-act="vmel-copy-from" data-v="${k}" class="${k === suggested ? 'is-suggested' : ''}" ${k === suggested ? `title="${tx('Suena junto a esta estrofa', 'Plays alongside this verse')}"` : ''}>${tx('Estrofa', 'Verse')} ${k + 1}</button>`).join('');
    return `<div class="copy-pick" role="group" aria-label="${tx('Estrofa de la melodía', 'Melody verse')}">
        <span class="muted">${tx(`Copiar a la estrofa ${state.stanza + 1} de la letra la melodía de:`, `Copy into lyrics verse ${state.stanza + 1} the melody of:`)}</span>
        ${opts}
        <button class="link" data-act="vmel-copy-cancel">${tx('Cancelar', 'Cancel')}</button>
      </div>`;
  }

  function alignBars(pairs, k) {
    const byBar = chords.map(() => []);
    pairs.forEach((p) => { if (byBar[p.i]) byBar[p.i].push(p); }); // p.i: compás dentro de la estrofa
    return chords.map((c, i) => `<div class="va-bar fn-${c.fn}">
        <span class="va-chord">${nameHTML(c)}</span>
        <div class="va-notes">${byBar[i].map((p) => `<span class="va-note ${p.syl ? '' : 'is-empty'}" data-vn="${k}:${i}:${p.s}">
          <b>${p.syl ? p.syl.text : '·'}</b><small>${midiLabel(p.midi)}${p.syl && p.harmonyMidi ? ' · ' + midiLabel(p.harmonyMidi) : ''}</small></span>`).join('') || `<span class="va-rest">${tx('silencio', 'rest')}</span>`}</div>
      </div>`).join('');
  }

  // Pestaña Voz, a la izquierda: la canción entera tal como la cantará.
  function renderSong() {
    const el = $('song');
    let body;
    if (!chords.length) body = `<p class="muted">${tx('Crea primero una progresión.', 'Build a progression first.')}</p>`;
    else {
      const plan = voicePlan();
      body = plan.stanzas.map((st) => {
        let warn = '';
        if (st.extraSyllables.length) warn = `<p class="va-warn">${tx(`Sobran ${st.extraSyllables.length} sílabas sin nota.`, `${st.extraSyllables.length} syllables have no note.`)}</p>`;
        const empty = !st.pairs.length ? `<p class="muted">${tx('Sin melodía todavía.', 'No melody yet.')}</p>` : `<div class="va-bars">${alignBars(st.pairs, st.k)}</div>`;
        return `<div class="song-stanza"><h3>${tx('Estrofa', 'Verse')} ${st.k + 1}</h3>${empty}${warn}</div>`;
      }).join('');
    }
    el.innerHTML = `
      <div class="panel-head">
        <h2>${tx('Canción', 'Song')}</h2>
        <span class="voice-status" role="status"></span>
      </div>
      <p class="muted help">${tx('La letra y su melodía se escriben en la pestaña', 'Lyrics and their melody are written in the')} <button class="link inline" data-act="tab" data-v="letra">${tx('Letra', 'Lyrics')}</button>${tx('. Aquí se ve lo que cantará la voz, estrofa a estrofa.', ' tab. Here you can see what the voice will sing, verse by verse.')}</p>
      <div class="voice-align">${body}</div>`;
    renderVoiceStatus();
  }

  function renderVoice() {
    const el = $('voice');
    const plan = voicePlan();
    const sung = plan.pairs.filter((p) => p.syl);
    const span = (ms) => (ms.length ? `${midiLabel(Math.min(...ms))} ${tx('a', 'to')} ${midiLabel(Math.max(...ms))}` : '');
    const range = span(sung.map((p) => p.midi));
    const hRange = span(sung.filter((p) => p.harmonyMidi).map((p) => p.harmonyMidi));
    const vib = Voice.vibratoRate(state.bpm);
    const bodies = [['male', tx('Hombre', 'Man')], ['female', tx('Mujer', 'Woman')], ['child', tx('Niño', 'Child')]];
    const harmonies = [['off', tx('No', 'Off')], ['above3', tx('3ª arriba', '3rd above')], ['below3', tx('3ª abajo', '3rd below')], ['below6', tx('6ª abajo', '6th below')]];
    const slider = (id, label, min, max, value, unit) => `<label class="vslider"><span>${label}</span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}" aria-label="${label}"><output>${value}${unit}</output></label>`;
    const harmOn = state.harmony !== 'off';
    const sings = tx('Canta de ', 'Sings from ');
    const decimal = (x) => tx(x.toFixed(1).replace('.', ','), x.toFixed(1));
    el.innerHTML = `
      <div class="panel-head"><h2>${tx('Voz', 'Voice')}</h2></div>
      <div class="vfields">
        <div class="field"><span>${tx('Cuerpo', 'Body')}</span>${seg('voice-body', bodies, state.voiceBody)}</div>
        ${state.lang === 'es' ? `<div class="field"><span>Acento</span>${seg('accent', [['es', 'España'], ['latam', 'Latinoamérica']], state.accent)}</div>`
          : `<div class="field"><span>Pronunciation</span><span class="muted">English (CMU Pronouncing Dictionary)${ui.dict === 'loading' ? ', loading…' : ''}</span></div>`}
        <div class="field"><span>${tx('Octava', 'Octave')}</span>${seg('octave', [['auto', 'Auto'], ['-1', '−1'], ['0', '0'], ['1', '+1']], state.octave)}
          <span class="muted">${range ? sings + range : ''}${state.octave === 'auto' && range ? ` (${plan.oct > 0 ? '+' : ''}${plan.oct} oct.)` : ''}</span></div>
        ${slider('v-force', tx('Fuerza', 'Power'), 0, 100, state.force, '%')}
        ${slider('v-vibrato', 'Vibrato', 0, 80, state.vibrato, ' cents')}
        ${slider('v-breath', tx('Aire', 'Breath'), 0, 60, state.breath, '%')}
        ${slider('v-bright', tx('Brillo', 'Brightness'), 0, 60, state.bright, '%')}
        ${slider('v-vol', tx('Volumen', 'Volume'), 0, 100, state.voiceVol, '%')}
      </div>
      <div class="vgroup">
        <h3>${tx('Segunda voz', 'Second voice')}</h3>
        <div class="vfields">
          ${seg('harmony', harmonies, state.harmony)}
          ${harmOn ? `<div class="field"><span>${tx('Cuerpo', 'Body')}</span>${seg('harmony-body', bodies, state.harmonyBody)}
            <span class="muted">${hRange ? sings + hRange : tx('Sin notas en las estrofas elegidas', 'No notes in the chosen verses')}</span></div>
          ${slider('v-hvol', tx('Volumen', 'Volume'), 0, 100, state.harmonyVol, '%')}` : `<p class="muted">${tx('Una voz paralela dentro de la escala. En la pestaña Letra eliges en qué estrofas canta.', 'A parallel voice inside the scale. In the Lyrics tab you choose which verses it sings.')}</p>`}
        </div>
      </div>
      <div class="vgroup">
        <h3>${tx('Sala', 'Room')}</h3>
        <div class="vfields">
          ${slider('v-reverb', tx('Reverb.', 'Reverb'), 0, 100, state.reverb, '%')}
          ${slider('v-echo', tx('Eco', 'Echo'), 0, 100, state.echo, '%')}
          <div class="field"><span>${tx('Eco cada', 'Echo every')}</span>${seg('echo-time', Object.entries(ECHO_TIMES).map(([id, t]) => [id, tx(...t.name)]), state.echoTime)}</div>
        </div>
      </div>
      <div class="vauto">
        <h3>${tx('Sigue a la canción', 'Follows the song')}</h3>
        <ul>
          <li><b>${tx('Tonalidad', 'Key')}</b> ${noteLabel(key.tonic)} ${I18n.scaleInText(key.scale.name)}: ${tx('canta las notas de la pestaña Letra', 'sings the notes from the Lyrics tab')}${harmOn ? tx(' y la segunda voz se mueve dentro de esa escala', ', and the second voice moves within that scale') : ''}.</li>
          <li><b>${tx('Estrofas', 'Verses')}</b>: ${stanzaCount()}, ${tx('cada una en una vuelta de la progresión y con su intensidad.', 'each over one pass of the progression, with its own dynamics.')}</li>
          <li><b>Tempo</b> ${state.bpm} ${tx('ppm', 'bpm')}: ${tx('cada sílaba dura su nota y las consonantes entran antes del pulso.', 'each syllable lasts its note and consonants land before the beat.')}</li>
          <li><b>${tx('Eco', 'Echo')}</b> ${tx(...ECHO_TIMES[state.echoTime].long)}: ${Math.round(echoSeconds() * 1000)} ms ${tx('a este tempo', 'at this tempo')}.</li>
          <li><b>Swing</b> ${swingLabel(state.swingVoice)}: ${tx('el de la voz, que se ajusta en la barra desde esta pestaña o desde Letra.', 'the voice’s own, set from the bar while on this tab or Lyrics.')}</li>
          <li><b>Vibrato</b> ${tx('a', 'at')} ${decimal(vib.rate)} Hz, ${vib.per} ${tx('ondas por pulso, solo en las notas largas.', 'cycles per beat, only on long notes.')}</li>
          <li><b>${tx('Respira', 'Breathes')}</b> ${tx('en los silencios y en la puntuación.', 'at rests and punctuation.')}</li>
        </ul>
        <p class="muted">${tx('La voz suena en el navegador; no se envía por MIDI. La genera CHIMERA, un modelo físico de garganta y boca.', 'The voice plays in the browser; it is not sent over MIDI. It is generated by CHIMERA, a physical model of the throat and mouth.')}</p>
      </div>`;
    const bind = (id, prop, unit, live) => {
      const input = $(id);
      if (!input) return;
      input.oninput = () => {
        state[prop] = Number(input.value);
        input.nextElementSibling.textContent = input.value + unit;
        save();
        if (live) live();
      };
    };
    bind('v-force', 'force', '%');
    bind('v-vibrato', 'vibrato', ' cents');
    bind('v-breath', 'breath', '%');
    bind('v-bright', 'bright', '%');
    // Volumen y sala no obligan a volver a cantar: se aplican al vuelo.
    bind('v-vol', 'voiceVol', '%', voiceGain);
    bind('v-hvol', 'harmonyVol', '%', voiceGain);
    bind('v-reverb', 'reverb', '%', applyFx);
    bind('v-echo', 'echo', '%', applyFx);
  }


  // Proyectos en archivo --------------------------------------------------------

  const FILE_APP = 'enlace';
  const FILE_VERSION = 1;

  function songData() {
    const song = {};
    SONG_KEYS.forEach((k) => { song[k] = state[k]; });
    return JSON.parse(JSON.stringify(song));
  }

  // Nombre de archivo a partir del nombre del proyecto (o la fecha).
  function fileName() {
    const base = (state.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return (base || tx('proyecto-', 'project-') + date) + '.enlace.json';
  }

  function saveProject() {
    const data = { app: FILE_APP, version: FILE_VERSION, saved: new Date().toISOString(), lang: state.lang, song: songData() };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    fileMessage(tx(`Guardado como ${a.download}`, `Saved as ${a.download}`), 'ok');
  }

  // Comprueba el archivo y copia solo lo que es de la canción, con el tipo esperado.
  function readProject(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(tx('El archivo no es un proyecto de Enlace.', 'The file is not an Enlace project.')); }
    if (!data || data.app !== FILE_APP || typeof data.song !== 'object' || !data.song) {
      throw new Error(tx('El archivo no es un proyecto de Enlace.', 'The file is not an Enlace project.'));
    }
    if (data.version > FILE_VERSION) throw new Error(tx('El proyecto es de una versión más nueva de Enlace.', 'The project comes from a newer version of Enlace.'));
    const song = migrate({ ...data.song });
    const out = {};
    for (const k of SONG_KEYS) {
      const v = song[k];
      const want = k in DEFAULTS ? DEFAULTS[k] : (k === 'stanzas' ? [] : 50);
      if (v === undefined || v === null) continue;
      if (Array.isArray(want) ? Array.isArray(v) : typeof v === typeof want) out[k] = v;
    }
    if (!Array.isArray(out.prog)) throw new Error(tx('El proyecto no tiene progresión.', 'The project has no progression.'));
    out.prog = out.prog.filter((it) => it && typeof it.q === 'string' && Array.isArray(it.mels));
    if (!T.SCALES.some((sc) => sc.id === out.scale)) delete out.scale;
    return { song: out, lang: data.lang };
  }

  function openProject(file) {
    if (!file) return;
    file.text().then((text) => {
      const { song, lang } = readProject(text);
      stop();
      ui.undo.push(JSON.stringify({ prog: state.prog, sel: ui.sel, rings: state.rings, stanzas: state.stanzas, stanza: state.stanza, song: songData() }));
      // Lo que el archivo no trae vuelve a su valor por defecto, no se hereda de la canción anterior.
      const fresh = migrate(Object.fromEntries(SONG_KEYS.filter((k) => k in DEFAULTS).map((k) => [k, DEFAULTS[k]])));
      Object.assign(state, JSON.parse(JSON.stringify(fresh)), song);
      if (!state.name) state.name = file.name.replace(/(\.enlace)?\.json$/i, '');
      ui.sel = state.prog.length - 1;
      ui.preview = null;
      ui.cursor = null;
      update();
      applyFx();
      const other = lang && lang !== state.lang && state.stanzas.some((st) => st.lyrics);
      fileMessage(tx(`Abierto «${state.name}».`, `Opened “${state.name}”.`) + (other
        ? ' ' + tx('La letra se escribió en inglés: cambia el idioma a EN para cantarla con su pronunciación.', 'The lyrics were written in Spanish: switch the language to ES to sing them with their pronunciation.')
        : ''), 'ok');
    }).catch((e) => fileMessage(e.message, 'error'));
  }

  function fileMessage(text, kind) {
    ui.fileMsg = { text, kind };
    renderFile();
    const menu = $('file').closest('details');
    if (menu) menu.open = true;
  }

  function renderFile() {
    const el = $('file');
    const msg = ui.fileMsg;
    el.innerHTML = `
      <label class="field wide"><span>${tx('Nombre del proyecto', 'Project name')}</span>
        <input type="text" id="c-name" value="${escapeAttr(state.name)}" placeholder="${tx('Sin título', 'Untitled')}" maxlength="80"></label>
      <div class="row">
        <button class="primary" data-act="file-save" title="${tx('Cmd/Ctrl+S', 'Cmd/Ctrl+S')}">${tx('Descargar proyecto', 'Download project')}</button>
        <button data-act="file-open" title="${tx('Cmd/Ctrl+O', 'Cmd/Ctrl+O')}">${tx('Abrir…', 'Open…')}</button>
      </div>
      <p class="muted">${tx('Guarda progresión, melodía, percusión, letra, voz y tempo en un archivo .enlace.json. También puedes arrastrar un archivo a la página para abrirlo.', 'Saves progression, melody, drums, lyrics, voice and tempo in a .enlace.json file. You can also drop a file onto the page to open it.')}</p>
      ${msg ? `<p class="file-msg is-${msg.kind}" role="status">${escapeText(msg.text)}</p>` : ''}`;
    $('c-name').oninput = (e) => { state.name = e.target.value; ui.fileMsg = null; saveQuiet(); updateTitle(); };
    updateTitle();
  }

  // La pestaña del navegador lleva el nombre del proyecto abierto.
  function updateTitle() {
    const name = (state.name || '').trim();
    document.title = name ? `${name} · Enlace` : 'Enlace';
  }

  // Guardar en el navegador sin volver a cantar (el nombre no cambia la voz).
  function saveQuiet() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignorar */ }
  }

  // Línea de tiempo --------------------------------------------------------------

  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  function renderTimeline() {
    const el = $('timeline');
    if (!el) return;
    if (!chords.length) {
      el.innerHTML = `<p class="muted tl-empty">${tx('La línea de tiempo aparece cuando hay una progresión.', 'The timeline appears once there is a progression.')}</p>`;
      return;
    }
    const bars = barsPerPass();
    const total = songBars();
    const barSec = 4 * 60 / state.bpm;
    const r = regionOf();
    const p = ui.playing;
    const passes = Array.from({ length: songPasses() }, (x, k) => {
      const mk = k % state.melVerses;
      const vk = k % stanzaCount();
      const cells = chords.map((c, i) => {
        const g = k * bars + i;
        const inLoop = r && g >= r.from && g <= r.to;
        return `<div class="tl-bar fn-${c.fn}${inLoop ? ' in-loop' : ''}" title="${tx('Compás', 'Bar')} ${g + 1} · ${T.chordText(c, state.notation)}"><span>${nameHTML(c)}</span></div>`;
      }).join('');
      return `<div class="tl-pass" style="flex:${bars}">
          <div class="tl-label" title="${tx(`Estrofa ${mk + 1} de la melodía · estrofa ${vk + 1} de la letra`, `Melody verse ${mk + 1} · lyrics verse ${vk + 1}`)}">M${mk + 1} · L${vk + 1}</div>
          <div class="tl-bars">${cells}</div>
        </div>`;
    }).join('');
    const pct = (g) => (g / total * 100) + '%';
    const start = startBarFor();
    el.innerHTML = `
      <div class="tl-side">
        <span class="tl-time" id="tl-time">${clock((p ? p.shownG : start) * barSec)}<small> / ${clock(total * barSec)}</small></span>
        <span class="muted tl-bars-count">${total} ${tx('compases', 'bars')}</span>
      </div>
      <div class="tl-track" id="tl-track" title="${tx('Arrastra para elegir un bucle; haz clic para empezar ahí', 'Drag to pick a loop; click to start there')}">
        <div class="tl-passes">${passes}</div>
        ${r ? `<div class="tl-loop" style="left:${pct(r.from)};width:${(r.to - r.from + 1) / total * 100}%"></div>` : ''}
        <div class="tl-sel" id="tl-sel" hidden></div>
        <div class="tl-start" style="left:${pct(start)}" ${p ? 'hidden' : ''}></div>
        <div class="tl-head" id="tl-head" style="left:${pct(p ? p.shownG : start)}" ${p ? '' : 'hidden'}></div>
      </div>
      <div class="tl-side tl-right">
        ${r ? `<span class="tl-loop-label">${tx('Bucle', 'Loop')} ${tx('c.', 'bars')} ${r.from + 1}–${r.to + 1}</span>
          <button data-act="region-clear">${tx('Quitar bucle', 'Clear loop')}</button>`
          : `<span class="muted">${tx('Arrastra para hacer un bucle', 'Drag to make a loop')}</span>`}
      </div>`;
    bindTimeline();
  }

  // Arrastrar sobre la línea elige el bucle; un clic elige desde dónde suena.
  function bindTimeline() {
    const track = $('tl-track');
    if (!track) return;
    const barAt = (x) => {
      const rect = track.getBoundingClientRect();
      return Math.max(0, Math.min(songBars() - 1, Math.floor((x - rect.left) / rect.width * songBars())));
    };
    let drag = null;
    const showSel = (a, b) => {
      const sel = $('tl-sel');
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      sel.hidden = false;
      sel.style.left = (lo / songBars() * 100) + '%';
      sel.style.width = ((hi - lo + 1) / songBars() * 100) + '%';
    };
    track.onpointerdown = (e) => {
      if (e.button !== 0) return;
      drag = { a: barAt(e.clientX), b: null, x: e.clientX };
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* da igual */ }
      e.preventDefault();
    };
    track.onpointermove = (e) => {
      if (!drag) return;
      if (drag.b === null && Math.abs(e.clientX - drag.x) < 5) return;
      drag.b = barAt(e.clientX);
      showSel(drag.a, drag.b);
    };
    track.onpointerup = (e) => {
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.b === null) { seekBar(barAt(e.clientX)); return; }
      state.region = { from: Math.min(d.a, d.b), to: Math.max(d.a, d.b) };
      saveQuiet();
      renderTimeline();
    };
    track.onpointercancel = () => { drag = null; renderTimeline(); };
  }

  function seekBar(g) {
    ui.startBar = g;
    if (ui.playing) { stop(); play(); } else renderTimeline();
  }

  // Coordinación ---------------------------------------------------------------

  // Textos fijos de index.html: cada uno guarda su versión inglesa en data-en*.
  function applyLang() {
    I18n.set(state.lang);
    document.documentElement.lang = state.lang;
    updateTitle();
    document.querySelectorAll('[data-en]').forEach((el) => {
      if (el.dataset.es === undefined) el.dataset.es = el.textContent;
      el.textContent = state.lang === 'en' ? el.dataset.en : el.dataset.es;
    });
    [['enLabel', 'aria-label'], ['enTitle', 'title']].forEach(([key, attr]) => {
      document.querySelectorAll(`[data-${key === 'enLabel' ? 'en-label' : 'en-title'}]`).forEach((el) => {
        const store = key + 'Es';
        if (el.dataset[store] === undefined) el.dataset[store] = el.getAttribute(attr);
        el.setAttribute(attr, state.lang === 'en' ? el.dataset[key] : el.dataset[store]);
      });
    });
    $('lang').innerHTML = [['es', 'ES', 'Español'], ['en', 'EN', 'English']].map(([id, short, name]) =>
      `<button data-act="lang" data-v="${id}" aria-pressed="${state.lang === id}" title="${name}" lang="${id}">${short}</button>`).join('');
  }

  // El inglés necesita el diccionario de pronunciación: se carga la primera vez.
  function ensureDict() {
    if (state.lang !== 'en' || ui.dict === 'ready' || ui.dict === 'loading' || !Voice.supported()) return;
    ui.dict = 'loading';
    Voice.loadDict().then(() => {
      ui.dict = 'ready';
      renderLetra();
      renderSong();
      renderVoice();
      refreshVoice();
    }).catch(() => { ui.dict = 'error'; renderVoice(); });
  }

  function render() {
    renderTimeline();
    renderControls();
    renderFile();
    renderStrip();
    renderMidi();
    renderNext();
    renderDetail();
    renderMelody();
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
    chords: { prop: 'playChords', name: ['progresión', 'progression'] },
    melody: { prop: 'playMelody', name: ['melodía', 'melody'] },
    drums: { prop: 'playDrums', name: ['percusión', 'drums'] },
    voice: { prop: 'playVoice', name: ['voz', 'voice'] },
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
      const label = tx('Silenciar ', 'Mute ') + tx(...name);
      btn.setAttribute('aria-label', label);
      btn.title = blocked ? tx('El sonido del navegador está apagado en el menú MIDI', 'Browser sound is turned off in the MIDI menu') : label;
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
    renderTransport();
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
      // Deshacer la apertura de un proyecto devuelve la canción entera.
      if (snap.song) Object.assign(state, snap.song);
      state.prog = snap.prog;
      ui.sel = snap.sel;
      state.rings = snap.rings;
      if (snap.stanzas) { state.stanzas = snap.stanzas; state.stanza = snap.stanza || 0; }
      if (snap.melVerses) { state.melVerses = snap.melVerses; state.mstanza = snap.mstanza || 0; }
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
    stanza(el) {
      if (el.dataset.part === 'm') state.mstanza = Number(el.dataset.v);
      else { state.stanza = Number(el.dataset.v); ui.copyPick = false; }
      ui.cursor = null;
      save();
      if (el.dataset.part === 'm') renderMelody(); else renderLetra();
    },
    // Estrofa vacía al final.
    'stanza-add'(el) {
      const part = el.dataset.part;
      if ((part === 'm' ? state.melVerses : stanzaCount()) >= MAX_STANZAS) return;
      snapshot();
      if (part === 'm') {
        state.melVerses += 1;
        state.mstanza = state.melVerses - 1;
      } else {
        state.stanzas.push({ lyrics: '' });
        state.stanza = state.stanzas.length - 1;
      }
      ui.cursor = null;
      save();
      if (part === 'm') renderMelody();
      else { renderLetra(); renderSong(); $('c-lyrics').focus(); }
    },
    // Copia de la estrofa elegida, justo detrás de ella; queda elegida la copia.
    'stanza-dup'(el) {
      const part = el.dataset.part;
      const count = part === 'm' ? state.melVerses : stanzaCount();
      if (count >= MAX_STANZAS) return;
      snapshot();
      const k = part === 'm' ? state.mstanza : state.stanza;
      const field = part === 'm' ? 'mels' : 'vmel';
      state.prog.forEach((it, i) => {
        barW(field, i, count - 1);
        it[field].splice(k + 1, 0, it[field][k].slice());
      });
      if (part === 'm') {
        state.melVerses += 1;
        state.mstanza = k + 1;
      } else {
        state.stanzas.splice(k + 1, 0, JSON.parse(JSON.stringify(state.stanzas[k])));
        state.stanza = k + 1;
      }
      ui.cursor = null;
      save();
      if (part === 'm') renderMelody(); else { renderLetra(); renderSong(); }
    },
    'stanza-remove'(el) {
      snapshot();
      if (el.dataset.part === 'm') {
        if (state.melVerses < 2) return;
        const k = state.mstanza;
        state.melVerses -= 1;
        state.prog.forEach((it) => { if (it.mels) it.mels.splice(k, 1); });
        state.mstanza = Math.max(0, k - 1);
        save();
        renderMelody();
        return;
      }
      if (stanzaCount() < 2) return;
      const k = state.stanza;
      state.stanzas.splice(k, 1);
      state.prog.forEach((it) => { if (it.vmel) it.vmel.splice(k, 1); });
      state.stanza = Math.max(0, k - 1);
      save();
      renderLetra();
      renderSong();
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
    // Con una sola estrofa de melodía se copia directamente; si hay más, se pregunta cuál.
    'vmel-copy'() {
      if (state.melVerses > 1) { ui.copyPick = !ui.copyPick; renderLetraGrid(); return; }
      copyMelody(0);
    },
    'vmel-copy-from'(el) { copyMelody(Number(el.dataset.v)); },
    'vmel-copy-cancel'() { ui.copyPick = false; renderLetraGrid(); },
    'vmel-clear'() {
      snapshot();
      state.prog.forEach((it, i) => { vmelW(i, state.stanza).fill(null); });
      ui.cursor = null;
      save();
      renderLetraGrid();
    },
    'file-save'() { saveProject(); },
    'region-clear'() { state.region = null; saveQuiet(); renderTimeline(); },
    'file-open'() { $('file-input').click(); },
    lang(el) {
      if (state.lang === el.dataset.v) return;
      state.lang = el.dataset.v;
      // Cada idioma con su forma habitual de nombrar las notas.
      state.notation = state.lang === 'en' ? 'intl' : 'latin';
      applyLang();
      update();
      ensureDict();
    },
    harmony(el) { state.harmony = el.dataset.v; save(); renderVoice(); renderSong(); },
    'harmony-body'(el) { state.harmonyBody = el.dataset.v; save(); renderVoice(); renderSong(); },
    'echo-time'(el) { state.echoTime = el.dataset.v; save(); applyFx(); renderVoice(); },
    'stanza-dyn'(el) { state.stanzas[state.stanza].dyn = el.dataset.v; save(); renderLetra(); },
    'toggle-voice'() { state.playVoice = !state.playVoice; save(); renderMutes(); voiceGain(); },
    'voice-body'(el) { state.voiceBody = el.dataset.v; save(); renderVoice(); renderSong(); },
    accent(el) { state.accent = el.dataset.v; save(); renderVoice(); renderSong(); },
    octave(el) { state.octave = el.dataset.v; save(); renderVoice(); renderSong(); },
    'mel-generate'() {
      snapshot();
      ui.seed += 1;
      M.generate(chords, key, M.seeded(ui.seed * 7919)).forEach((bar, i) => { barW('mels', i, state.mstanza).splice(0, M.STEPS, ...bar); });
      ui.cursor = null;
      save();
      renderMelody();
      renderStrip();
      renderSong();
      renderVoice();
    },
    'mel-clear'() {
      snapshot();
      state.prog.forEach((it, i) => { barW('mels', i, state.mstanza).fill(null); });
      ui.cursor = null;
      save();
      renderMelody();
      renderStrip();
      renderSong();
      renderVoice();
    },
  };

  // Reproducción ---------------------------------------------------------------

  function melodyAt(list, i, s, pass) {
    const mel = melAt(i, pass);
    const off = mel[s];
    if (off === null || off === undefined) return null;
    // Dura hasta la siguiente nota o el final del compás.
    let len = 1;
    for (let k = s + 1; k < M.STEPS && (mel[k] === null || mel[k] === undefined); k++) len++;
    return { off: M.snap(off, list), len };
  }

  // Las rejillas solo muestran el cursor si la estrofa que suena es la que se ve.
  function movePlayhead(i, s, mk, vk) {
    document.querySelectorAll('.mel-grid').forEach((grid) => {
      const head = grid.querySelector('.playhead');
      if (!head) return;
      if ((grid.dataset.track === 'v' ? vk !== state.stanza : mk !== state.mstanza)) { head.hidden = true; return; }
      const label = grid.querySelector('.mel-corner').offsetWidth;
      const cell = (grid.scrollWidth - label) / (chords.length * M.STEPS);
      head.hidden = false;
      head.style.left = label + (i * M.STEPS + s) * cell + 'px';
    });
  }

  function highlight(i, mk, vk) {
    document.querySelectorAll('.is-playing').forEach((n) => n.classList.remove('is-playing'));
    document.querySelectorAll(`.pc[data-i="${i}"], .mel-chord[data-i="${i}"], .stanza-chip[data-part="m"][data-k="${mk}"], .stanza-chip[data-part="v"][data-k="${vk}"]`)
      .forEach((n) => n.classList.add('is-playing'));
  }

  // Los pasos se programan con un poco de antelación: así el MIDI lleva marcas de
  // tiempo exactas y no depende de lo ocupada que esté la página.
  const LOOKAHEAD_MS = 120;

  // base: el paso sin swing. Cada parte retrasa sus contratiempos con su propio swing.
  function scheduleStep(p, base) {
    const stepMs = 30000 / state.bpm;
    const at = base;
    const { g, s } = p;
    const bars = barsPerPass();
    const i = g % bars;
    const pass = Math.floor(g / bars);
    // Melodía y voz recorren sus estrofas cada una por su cuenta.
    const mk = pass % state.melVerses;
    const vk = pass % stanzaCount();
    const { hits } = M.COMP[state.comp];
    const hit = hits.indexOf(s);
    if (s === 0) {
      p.queue.push(...drumHits(p, i, mk));
      // La voz se vuelve a lanzar si el compás siguiente es un salto o empieza su toma.
      const ng = nextBar(g);
      if (ng >= 0) {
        const vb = voiceBar(ng);
        const jump = ng !== g + 1;
        if (jump || vb === 0) p.voicePend = { at: base + M.STEPS * stepMs, vb, jump };
      }
    }
    if (hit >= 0 && chords[i]) {
      const v = voicings[i][state.instrument === 'piano' ? 'p' : 'g'];
      const to = hit + 1 < hits.length ? hits[hit + 1] : M.STEPS;
      const dur = M.spanMs(s, to, state.swingChords, stepMs) * .95 / 1000;
      if (v) emitChord(v.midis, dur, .15, base + M.swingShift(s, state.swingChords, stepMs), state.playChords);
    }
    const n = melodyAt(p.list, i, s, mk);
    if (n) {
      const dur = M.spanMs(s, s + n.len, state.swingMelody, stepMs) * .92 / 1000;
      emitNote(M.midiOf(n.off, key), dur, .32, base + M.swingShift(s, state.swingMelody, stepMs), state.playMelody);
    }
    setTimeout(() => {
      if (ui.playing !== p) return;
      if (s === 0) { highlight(i, mk, vk); p.barSeen = performance.now(); p.shownG = g; }
      movePlayhead(i, s, mk, vk);
      markVoiceNote(vk, i, s);
    }, Math.max(0, at - performance.now()));
  }

  function schedule() {
    const p = ui.playing;
    if (!p) return;
    if (!canPlay()) { stop(); return; }
    const now = performance.now();
    while (p.queue.length && p.queue[0].at < now + LOOKAHEAD_MS) fireDrum(p.queue.shift());
    // La voz arranca antes del compás: sus consonantes van antes del pulso.
    const vp = p.voicePend;
    if (vp && vp.at - (vp.vb === 0 ? Voice.LEAD * 1000 : 0) < now + LOOKAHEAD_MS) {
      p.voicePend = null;
      startVoice(p, vp);
    }
    if (p.endAt) {
      if (now >= p.endAt) stop(true);
      return;
    }
    // El margen se mide con el swing ya aplicado (el mayor de las partes): una
    // corchea retrasada no debe programarse tan lejos que parar no pueda alcanzarla.
    const stepMs = 30000 / state.bpm;
    const late = Math.max(state.swingChords, state.swingMelody);
    while (p.next + M.swingShift(p.s, late, stepMs) < now + LOOKAHEAD_MS) {
      if (p.g >= songBars()) p.g = 0; // la canción se acortó mientras sonaba
      scheduleStep(p, p.next);
      p.next += stepMs;
      p.s += 1;
      if (p.s >= M.STEPS) {
        p.s = 0;
        const ng = nextBar(p.g);
        if (ng < 0) { p.endAt = p.next; return; }
        p.g = ng;
      }
    }
  }

  // La canción en compases: cada vuelta de la progresión es una estrofa; dura lo
  // que la parte con más estrofas (la otra se repite).
  const songPasses = () => Math.max(state.melVerses, stanzaCount());
  const barsPerPass = () => Math.max(1, chords.length);
  const songBars = () => songPasses() * barsPerPass();
  // Compás dentro de la toma de la voz (que abarca todas sus estrofas).
  const voiceBar = (g) => (Math.floor(g / barsPerPass()) % stanzaCount()) * barsPerPass() + g % barsPerPass();

  // Bucle elegido en la línea de tiempo (compases, ambos incluidos), ajustado a la canción.
  function regionOf() {
    const r = state.region;
    if (!r || !chords.length) return null;
    const last = songBars() - 1;
    const from = Math.min(r.from, last);
    const to = Math.min(r.to, last);
    return from <= to ? { from, to } : null;
  }

  // Compás que sigue a g, o -1 si la canción termina. Un bucle elegido siempre se repite.
  function nextBar(g) {
    const r = regionOf();
    if (r) return g >= r.from && g < r.to ? g + 1 : g >= r.to ? r.from : g + 1;
    if (g + 1 < songBars()) return g + 1;
    return state.loop ? 0 : -1;
  }

  function startBarFor() {
    const r = regionOf();
    let g = Math.min(ui.startBar || 0, songBars() - 1);
    if (r && (g < r.from || g > r.to)) g = r.from;
    return Math.max(0, g);
  }

  function play() {
    if (!canPlay()) return;
    const g = startBarFor();
    const vb = voiceBar(g);
    // Con voz lista se deja margen para que entren sus primeras consonantes.
    const lead = voiceTake() && vb === 0 ? Voice.LEAD * 1000 : 0;
    const next = performance.now() + 40 + lead;
    ui.playing = { g, s: 0, next, list: M.rows(key, chords), endAt: 0, queue: [], barSeen: 0, shownG: g, voices: [], voicePend: { at: next, vb, jump: false } };
    renderTransport();
    renderTimeline();
    animateHand();
  }

  // natural: la canción terminó sola; la voz acaba su última sílaba.
  function stop(natural = false) {
    if (!ui.playing) return;
    if (!natural) ui.playing.voices.forEach((v) => v.node.stop());
    ui.playing = null;
    markVoiceNote(-1, -1, -1);
    Midi.silence();
    document.querySelectorAll('.playhead').forEach((h) => { h.hidden = true; });
    highlight(-1);
    renderTransport();
    renderTimeline();
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

  // Arrastrar una estrofa la cambia de sitio. Con eventos de puntero, para que
  // funcione también con el dedo; un toque sin arrastrar sigue siendo un clic.
  let chipDrag = null;
  let skipClick = false;
  const clearDropMarks = () => document.querySelectorAll('.stanza-chip.drop-before, .stanza-chip.drop-after')
    .forEach((c) => c.classList.remove('drop-before', 'drop-after'));

  document.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.stanza-chip');
    if (!chip || e.button !== 0) return;
    const group = chip.parentElement.querySelectorAll('.stanza-chip');
    if (group.length < 2) return;
    chipDrag = { chip, part: chip.dataset.part, from: Number(chip.dataset.k), x: e.clientX, y: e.clientY, moved: false, to: null };
  });
  document.addEventListener('pointermove', (e) => {
    const d = chipDrag;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      d.moved = true;
      d.chip.classList.add('is-dragging');
      document.body.classList.add('is-reordering');
      try { d.chip.setPointerCapture(e.pointerId); } catch (err) { /* sin captura también funciona */ }
    }
    e.preventDefault();
    clearDropMarks();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest(`.stanza-chip[data-part="${d.part}"]`);
    if (!target || target.parentElement !== d.chip.parentElement) { d.to = null; return; }
    const r = target.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    let to = Number(target.dataset.k) + (after ? 1 : 0);
    if (to > d.from) to -= 1;
    d.to = to;
    if (to !== d.from) target.classList.add(after ? 'drop-after' : 'drop-before');
  });
  const endChipDrag = () => {
    const d = chipDrag;
    chipDrag = null;
    if (!d) return;
    clearDropMarks();
    d.chip.classList.remove('is-dragging');
    document.body.classList.remove('is-reordering');
    if (!d.moved) return;
    // El clic que el navegador manda al soltar no debe seleccionar ninguna estrofa:
    // se descarta, y el cambio de orden se hace justo después (los botones siguen en su sitio).
    skipClick = true;
    setTimeout(() => {
      skipClick = false;
      if (d.to !== null) moveStanza(d.part, d.from, d.to);
    }, 0);
  };
  document.addEventListener('pointerup', endChipDrag);
  document.addEventListener('pointercancel', () => { if (chipDrag) chipDrag.moved = false; endChipDrag(); });

  document.addEventListener('click', (e) => {
    if (skipClick) { skipClick = false; e.preventDefault(); return; }
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
    // Guardar y abrir funcionan también con el foco en un campo de texto.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 's' || e.key === 'o')) {
      e.preventDefault();
      if (e.key === 's') saveProject(); else $('file-input').click();
      return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); ACTIONS.undo(); return; }
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); ACTIONS.play(); }
  });

  $('file-input').onchange = (e) => { openProject(e.target.files[0]); e.target.value = ''; };
  // Arrastrar un proyecto a la página lo abre.
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('is-dropping'); }
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('is-dropping'); });
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('is-dropping');
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    openProject(e.dataTransfer.files[0]);
  });

  startTicker(() => { schedule(); Midi.flush(); });
  applyLang();
  recompute();
  render();
  ensureDict();
  applyFx();
  refreshVoice();
  if (state.midiOn && Midi.supported()) connectMidi();
})();
