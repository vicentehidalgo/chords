// Interfaz: guarda el estado, dibuja las secciones y atiende los clics.
(function () {
  'use strict';
  const T = globalThis.Theory;
  const { suggest, presetsFor, originLabel } = globalThis.Suggest;
  const V = globalThis.Voicings;
  const D = globalThis.Diagrams;
  const M = globalThis.Melody;
  const { Sound } = globalThis;
  const { mod } = T;
  const $ = (id) => document.getElementById(id);

  const STORE = 'enlace.v1';
  const DEFAULTS = {
    tonic: 0, scale: 'ionian', level: 0, instrument: 'guitar', notation: 'latin',
    outside: true, smooth: true, bpm: 88, loop: true, playChords: true, playMelody: true,
    prog: [],
  };
  const state = { ...DEFAULTS };
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORE) || '{}'));
  } catch (e) { /* sin almacenamiento: se usan los valores por defecto */ }

  // Estado que no se guarda.
  const ui = {
    sel: state.prog.length - 1, preview: null, previewG: 0, previewP: 0,
    more: false, undo: [], seed: Date.now() % 100000, cursor: null, playing: null,
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
      <label class="field"><span>Tónica</span><select id="c-tonic">${tonics}</select></label>
      <label class="field wide"><span>Escala o modo</span><select id="c-scale">${scales}</select></label>
      <div class="field"><span>Acordes</span>${seg('level', [[0, 'Tríadas'], [1, 'Con 7ª'], [2, 'Todos']], state.level)}</div>
      <div class="field"><span>Ver en</span>${seg('instrument', [['guitar', 'Guitarra'], ['piano', 'Piano'], ['both', 'Ambos']], state.instrument)}</div>
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

    $('strip').innerHTML = `
      <div class="strip-head">
        <h2>Progresión <span class="muted">${noteLabel(key.tonic)} ${key.scale.name.toLowerCase()}</span></h2>
        <div class="transport">
          <button class="primary" data-act="play" ${chords.length ? '' : 'disabled'}>${ui.playing ? '■ Parar' : '▶ Reproducir'}</button>
          <label class="bpm">${state.bpm} ppm <input type="range" id="c-bpm" min="50" max="180" step="2" value="${state.bpm}" aria-label="Tempo"></label>
          <button data-act="toggle-loop" aria-pressed="${state.loop}">Bucle</button>
          <button data-act="undo" ${ui.undo.length ? '' : 'disabled'}>Deshacer</button>
          <button data-act="clear" ${chords.length ? '' : 'disabled'}>Vaciar</button>
        </div>
      </div>
      <div class="pcs">${chords.length ? cards : empty}</div>`;
    $('c-bpm').oninput = (e) => {
      state.bpm = Number(e.target.value);
      e.target.parentElement.firstChild.textContent = state.bpm + ' ppm ';
      save();
    };
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
          <span class="why">${s.reasons.slice(0, 3).map((r) => `<span class="r-${r.kind}">${r.text}</span>`).join('')}</span>
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
    const nOut = ui.more ? 8 : 3;
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
    const groups = roleGroups(c);
    const origin = originLabel(c);
    const chips = (list) => list.map((n) => `<b>${n.label}</b>`).join(' ') || '<span class="muted">ninguna</span>';
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
      <p class="tones">${c.tones.map((t) => `<span><b>${noteLabel(t)}</b><i>${t.deg.replace('b', '♭').replace('#', '♯')}</i></span>`).join('')}</p>
      <div class="bigs">${big.join('')}</div>
      <h3>Notas para tu melodía</h3>
      <dl class="roles">
        <div class="role-safe"><dt>Seguras</dt><dd>${chips(groups.safe)}</dd></div>
        <div class="role-tension"><dt>Dan tensión</dt><dd>${chips(groups.tension)}</dd></div>
        <div class="role-avoid"><dt>De paso</dt><dd>${chips(groups.avoid)}</dd></div>
      </dl>
      ${melodyMap(c)}`;
  }

  // Editor de melodía ----------------------------------------------------------

  function renderMelody() {
    const el = $('melody');
    const scroller = el.querySelector('.mel-scroll');
    const left = scroller ? scroller.scrollLeft : 0;

    if (!chords.length) {
      el.innerHTML = `<div class="panel-head"><h2>Melodía</h2></div>
        <p class="muted">Crea una progresión y aquí podrás escribir una melodía sobre ella.</p>`;
      return;
    }

    const list = M.rows(key, chords);
    const steps = chords.length * M.STEPS;
    const hint = melodyHints(list);

    const head = chords.map((c, i) =>
      `<div class="mel-chord fn-${c.fn} ${i === ui.sel ? 'is-sel' : ''}" style="grid-column:span ${M.STEPS}">${nameHTML(c)}</div>`).join('');

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
        <h2>Melodía</h2>
        <div class="row">
          <button class="primary" data-act="mel-generate">Proponer melodía</button>
          <button data-act="mel-clear">Borrar melodía</button>
          <button data-act="toggle-chords" aria-pressed="${state.playChords}">Oír acordes</button>
          <button data-act="toggle-melody" aria-pressed="${state.playMelody}">Oír melodía</button>
        </div>
      </div>
      <p class="muted help">Haz clic para poner una nota; suena hasta la siguiente. Otro clic la quita. Los aros marcan buenas notas para continuar.</p>
      <div class="mel-legend">
        <span class="r-chord"><i></i>Del acorde: reposo</span>
        <span class="r-tension"><i></i>De la escala: movimiento</span>
        <span class="r-avoid"><i></i>Choca: úsala de paso</span>
        <span class="r-out"><i></i>Fuera de escala</span>
      </div>
      <div class="mel-scroll">
        <div class="mel-grid" style="--cols:${steps}">
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
      Sound.note(M.midiOf(off, key));
    }
    save();
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
      <div class="panel-head"><h2>Acordes de la escala</h2></div>
      <p class="scale-notes">${key.notes.map((n) => `<span><b>${noteLabel(n)}</b><i>${n.deg.replace('b', '♭').replace('#', '♯')}</i></span>`).join('')}</p>
      <div class="fieldchips">${list.map((c) =>
        `<button class="fc fn-${c.fn}" data-act="add" data-id="${c.id}" aria-label="Añadir ${chordLabel(c)}"><span class="roman">${c.roman}</span>${nameHTML(c)}</button>`).join('')}</div>`;
  }

  function renderPresets() {
    const list = presetButtons();
    $('presets').innerHTML = `<div class="panel-head"><h2>Progresiones conocidas</h2></div>
      ${list.length ? `<div class="presets">${list.join('')}</div>`
        : `<p class="muted">No hay progresiones guardadas para esta escala. Construye la tuya con las sugerencias.</p>`}`;
  }

  // Coordinación ---------------------------------------------------------------

  function render() {
    renderControls();
    renderStrip();
    renderNext();
    renderDetail();
    renderMelody();
    renderField();
    renderPresets();
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
    const piano = state.instrument === 'piano';
    const v = piano ? f.p : f.g;
    if (v) Sound.chord(v.midis, piano ? 'piano' : 'guitar');
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
    document.querySelectorAll('.pc.is-playing').forEach((n) => n.classList.remove('is-playing'));
    const el = document.querySelector(`.pc[data-i="${i}"]`);
    if (el) el.classList.add('is-playing');
  }

  function play() {
    if (!chords.length) return;
    const list = M.rows(key, chords);
    const piano = state.instrument === 'piano';
    const tick = () => {
      const p = ui.playing;
      if (!p) return;
      if (!chords.length) { stop(); return; }
      if (p.i >= chords.length) p.i = 0; // se quitó un acorde mientras sonaba
      const stepDur = 30 / state.bpm;
      if (p.s === 0) {
        highlight(p.i);
        if (state.playChords) {
          const v = voicings[p.i][piano ? 'p' : 'g'];
          if (v) Sound.chord(v.midis, piano ? 'piano' : 'guitar', stepDur * M.STEPS * .95, .15);
        }
      }
      movePlayhead(p.i, p.s);
      if (state.playMelody) {
        const n = melodyAt(list, p.i, p.s);
        if (n) Sound.note(M.midiOf(n.off, key), n.len * stepDur * .92);
      }
      p.s += 1;
      if (p.s >= M.STEPS) {
        p.s = 0;
        p.i += 1;
        if (p.i >= chords.length) {
          if (!state.loop) {
            p.timer = setTimeout(stop, stepDur * 1000);
            ui.playing = { ...p, ended: true };
            return;
          }
          p.i = 0;
        }
      }
      p.timer = setTimeout(tick, stepDur * 1000);
    };
    ui.playing = { i: 0, s: 0, timer: null };
    renderStrip();
    tick();
  }

  function stop() {
    if (!ui.playing) return;
    clearTimeout(ui.playing.timer);
    ui.playing = null;
    const head = document.querySelector('.playhead');
    if (head) head.hidden = true;
    highlight(-1);
    renderStrip();
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
    if (label) { Sound.note(M.midiOf(Number(label.dataset.note), key)); return; }
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled) ACTIONS[el.dataset.act](el);
  });

  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); ACTIONS.undo(); return; }
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); ACTIONS.play(); }
  });

  recompute();
  render();
})();
