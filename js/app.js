// Interfaz: guarda el estado, dibuja las secciones y atiende los clics.
(function () {
  'use strict';
  const T = globalThis.Theory;
  const { suggest, presetsFor, originLabel } = globalThis.Suggest;
  const V = globalThis.Voicings;
  const D = globalThis.Diagrams;
  const M = globalThis.Melody;
  const { Sound, Midi } = globalThis;
  const { mod } = T;
  const $ = (id) => document.getElementById(id);

  const STORE = 'enlace.v1';
  const DEFAULTS = {
    tonic: 0, scale: 'ionian', level: 0, instrument: 'guitar', notation: 'latin',
    outside: true, smooth: true, bpm: 88, loop: true, playChords: true, playMelody: true,
    tab: 'chords', swing: 50, comp: 'whole', midiOn: false, midiOut: null, midiSend: 'both', midiChordCh: 1, midiMelodyCh: 2, localSound: true,
    prog: [],
  };
  const state = { ...DEFAULTS };
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORE) || '{}'));
  } catch (e) { /* sin almacenamiento: se usan los valores por defecto */ }

  // Estado que no se guarda.
  const ui = {
    sel: state.prog.length - 1, preview: null, previewG: 0, previewP: 0,
    more: false, undo: [], seed: Date.now() % 100000, cursor: null, playing: null, midiError: null,
  };

  let key;
  let catalog;
  let chords;
  let voicings;

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignorar */ }
  }

  function snapshot() {
    ui.undo.push(JSON.stringify({ prog: state.prog, sel: ui.sel }));
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
      <button class="primary" data-act="play" ${chords.length ? '' : 'disabled'}>${ui.playing ? '■ Parar' : '▶ Reproducir'}</button>
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
    };
    $('c-swing').oninput = (e) => {
      state.swing = Number(e.target.value);
      $('swing-value').textContent = swingLabel();
      updateSwingHint();
      save();
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

  function renderMelody() {
    const el = $('melody');
    const scroller = el.querySelector('.mel-scroll');
    const left = scroller ? scroller.scrollLeft : 0;

    if (!chords.length) {
      el.innerHTML = `<p class="muted">Crea una progresión en la pestaña Progresión y aquí podrás escribir una melodía sobre ella.</p>`;
      return;
    }

    const list = M.rows(key, chords);
    const steps = chords.length * M.STEPS;
    const hint = melodyHints(list);

    const head = chords.map((c, i) =>
      `<button class="mel-chord fn-${c.fn} ${i === ui.sel ? 'is-sel' : ''}" data-act="select" data-i="${i}" style="grid-column:span ${M.STEPS}" aria-label="Ver notas sobre ${chordLabel(c)}">${nameHTML(c)}</button>`).join('');

    const rowsHTML = list.map((off) => {
      const pc = mod(key.pc + off);
      const isScale = key.pcs.has(pc);
      const cells = [];
      chords.forEach((c, i) => {
        const r = M.role(pc, c, key);
        const mel = state.prog[i].mel.map((x) => (x === null ? null : M.snap(x, list)));
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
          cells.push(`<div class="${cls.join(' ')}" data-cell="${i}:${s}:${off}"></div>`);
        }
      });
      const label = pcLabel(pc);
      return `<div class="mel-label ${pc === key.pc ? 'is-tonic' : ''} ${isScale ? '' : 'is-chroma'}" data-note="${off}">${label}</div>${cells.join('')}`;
    }).join('');

    el.innerHTML = `
      <div class="panel-head">
        <div class="mel-legend">
          <span class="r-chord"><i></i>Del acorde: reposo</span>
          <span class="r-tension"><i></i>De la escala: movimiento</span>
          <span class="r-avoid"><i></i>Choca: úsala de paso</span>
          <span class="r-out"><i></i>Fuera de escala</span>
        </div>
        <div class="row">
          <button class="primary" data-act="mel-generate">Proponer melodía</button>
          <button data-act="mel-clear">Borrar melodía</button>
          <button data-act="toggle-chords" aria-pressed="${state.playChords}" ${browserMuted() ? 'disabled' : ''}>Oír acordes</button>
          <button data-act="toggle-melody" aria-pressed="${state.playMelody}" ${browserMuted() ? 'disabled' : ''}>Oír melodía</button>
        </div>
      </div>
      <p class="muted help">Haz clic para poner una nota; suena hasta la siguiente. Otro clic la quita. Los aros marcan buenas notas para continuar.</p>
      <div class="mel-scroll">
        <div class="mel-grid" style="--cols:${steps};--rows:${list.length}">
          <div class="mel-corner"></div>${head}${rowsHTML}
          <div class="playhead" hidden></div>
        </div>
      </div>`;
    el.querySelector('.mel-scroll').scrollLeft = left;
  }

  // Tras la última nota escrita, sugiere continuaciones en el paso siguiente.
  function melodyHints(list) {
    if (!ui.cursor) return null;
    let { i, s } = ui.cursor;
    const item = state.prog[i];
    if (!item || item.mel[s] === null || item.mel[s] === undefined) return null;
    const prev = M.snap(item.mel[s], list);
    s += 1;
    if (s >= M.STEPS) { s = 0; i += 1; }
    if (i >= chords.length) return null;
    return { i, s, offs: M.hints(prev, chords[i], key, list, s % 4 === 0) };
  }

  function toggleCell(i, s, off) {
    snapshot();
    const mel = state.prog[i].mel;
    if (mel[s] === off) {
      mel[s] = null;
      ui.cursor = null;
    } else {
      mel[s] = off;
      ui.cursor = { i, s };
      emitNote(M.midiOf(off, key));
    }
    save();
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

  // Salida de sonido: navegador, instrumento MIDI o ambos -----------------------

  const browserMuted = () => Boolean(Midi.output) && !state.localSound;
  const sendsChords = () => state.midiSend !== 'melody';
  const sendsMelody = () => state.midiSend !== 'chords';

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
      <div class="field"><span>Enviar</span>${seg('midi-send', [['chords', 'Progresión'], ['melody', 'Melodía'], ['both', 'Las dos']], state.midiSend)}</div>
      ${sendsChords() ? channelSelect('m-chord-ch', 'Canal progresión', state.midiChordCh) : ''}
      ${sendsMelody() ? channelSelect('m-melody-ch', 'Canal melodía', state.midiMelodyCh) : ''}
      <label class="check"><input type="checkbox" id="m-local" ${state.localSound ? 'checked' : ''}> Sonar también en el navegador</label>
      <button data-act="midi-panic">Silenciar instrumento</button>`;
    $('m-out').onchange = (e) => { Midi.select(e.target.value); state.midiOut = e.target.value; save(); };
    $('m-local').onchange = (e) => { state.localSound = e.target.checked; save(); renderMelody(); };
    const ch = (id, prop) => {
      if ($(id)) $(id).onchange = (e) => { Midi.silence(); state[prop] = Number(e.target.value); save(); };
    };
    ch('m-chord-ch', 'midiChordCh');
    ch('m-melody-ch', 'midiMelodyCh');
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
    renderMelody();
  }

  // Al enchufar o desenchufar: recupera el instrumento elegido o el primero que haya.
  Midi.onChange = () => {
    if (!Midi.output) {
      const outs = Midi.list();
      const found = outs.find((o) => o.id === state.midiOut) || outs[0];
      if (found) Midi.select(found.id);
    }
    renderMidi();
    renderMelody();
  };

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
    applyTab();
  }

  function applyTab() {
    ['chords', 'melody'].forEach((t) => {
      $('tab-' + t).hidden = state.tab !== t;
      $('tab-btn-' + t).setAttribute('aria-selected', String(state.tab === t));
    });
  }

  function setTab(tab) {
    state.tab = tab;
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
    'midi-send'(el) { Midi.silence(); state.midiSend = el.dataset.v; save(); renderMidi(); },
    'midi-panic'() { Midi.panic(); },
    'toggle-loop'() { state.loop = !state.loop; save(); renderStrip(); },
    'toggle-chords'() { state.playChords = !state.playChords; save(); renderMelody(); },
    'toggle-melody'() { state.playMelody = !state.playMelody; save(); renderMelody(); },
    'mel-generate'() {
      snapshot();
      ui.seed += 1;
      M.generate(chords, key, M.seeded(ui.seed * 7919)).forEach((bar, i) => { state.prog[i].mel = bar; });
      ui.cursor = null;
      save();
      renderMelody();
      renderStrip();
    },
    'mel-clear'() {
      snapshot();
      state.prog.forEach((it) => { it.mel = Array(M.STEPS).fill(null); });
      ui.cursor = null;
      save();
      renderMelody();
      renderStrip();
    },
  };

  // Reproducción ---------------------------------------------------------------

  function melodyAt(list, i, s) {
    const off = state.prog[i].mel[s];
    if (off === null || off === undefined) return null;
    // Dura hasta la siguiente nota o el final del compás.
    let len = 1;
    for (let k = s + 1; k < M.STEPS && state.prog[i].mel[k] === null; k++) len++;
    return { off: M.snap(off, list), len };
  }

  function movePlayhead(i, s) {
    const grid = document.querySelector('.mel-grid');
    const head = document.querySelector('.playhead');
    if (!grid || !head) return;
    const label = grid.querySelector('.mel-corner').offsetWidth;
    const cell = (grid.scrollWidth - label) / (chords.length * M.STEPS);
    head.hidden = false;
    head.style.left = label + (i * M.STEPS + s) * cell + 'px';
  }

  function highlight(i) {
    document.querySelectorAll('.is-playing').forEach((n) => n.classList.remove('is-playing'));
    document.querySelectorAll(`.pc[data-i="${i}"], .mel-chord[data-i="${i}"]`)
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
    if (hit >= 0) {
      const v = voicings[i][state.instrument === 'piano' ? 'p' : 'g'];
      const to = hit + 1 < hits.length ? hits[hit + 1] : M.STEPS;
      const dur = M.spanMs(s, to, state.swing, stepMs) * .95 / 1000;
      if (v) emitChord(v.midis, dur, .15, at, state.playChords);
    }
    const n = melodyAt(p.list, i, s);
    if (n) {
      const dur = M.spanMs(s, s + n.len, state.swing, stepMs) * .92 / 1000;
      emitNote(M.midiOf(n.off, key), dur, .32, at, state.playMelody);
    }
    setTimeout(() => {
      if (ui.playing !== p) return;
      if (s === 0) highlight(i);
      movePlayhead(i, s);
    }, Math.max(0, at - performance.now()));
  }

  function schedule() {
    const p = ui.playing;
    if (!p) return;
    if (!chords.length) { stop(); return; }
    const now = performance.now();
    if (p.endAt) {
      if (now >= p.endAt) stop();
      return;
    }
    // El margen se mide con el swing ya aplicado: una corchea retrasada no debe
    // programarse tan lejos que parar no pueda alcanzarla.
    const stepMs = 30000 / state.bpm;
    while (p.next + M.swingShift(p.s, state.swing, stepMs) < now + LOOKAHEAD_MS) {
      if (p.i >= chords.length) p.i = 0; // se quitó un acorde mientras sonaba
      scheduleStep(p, p.next + M.swingShift(p.s, state.swing, stepMs));
      p.next += stepMs;
      p.s += 1;
      if (p.s >= M.STEPS) {
        p.s = 0;
        p.i += 1;
        if (p.i >= chords.length) {
          if (!state.loop) { p.endAt = p.next; return; }
          p.i = 0;
        }
      }
    }
  }

  function play() {
    if (!chords.length) return;
    ui.playing = { i: 0, s: 0, next: performance.now() + 40, list: M.rows(key, chords), endAt: 0 };
    renderStrip();
  }

  function stop() {
    if (!ui.playing) return;
    ui.playing = null;
    Midi.silence();
    const head = document.querySelector('.playhead');
    if (head) head.hidden = true;
    highlight(-1);
    renderStrip();
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
      const [i, s, off] = cell.dataset.cell.split(':').map(Number);
      toggleCell(i, s, off);
      return;
    }
    const label = e.target.closest('[data-note]');
    if (label) { emitNote(M.midiOf(Number(label.dataset.note), key)); return; }
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled) ACTIONS[el.dataset.act](el);
  });

  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.menu[open]').forEach((m) => {
      if (!m.contains(e.target)) m.open = false;
    });
  });

  document.addEventListener('keydown', (e) => {
    // Tab cambia de pestaña. Mayús+Tab conserva la navegación por teclado del navegador.
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (document.activeElement) document.activeElement.blur();
      setTab(state.tab === 'chords' ? 'melody' : 'chords');
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
  if (state.midiOn && Midi.supported()) connectMidi();
})();
