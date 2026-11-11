// Del texto en español a sílabas cantables: una por nota, con su pronunciación
// en IPA (ataque, núcleo, coda) en el formato que espera el cantante de CHIMERA.
//
// Convenciones de la letra:
//   «-»  alarga la sílaba anterior una nota más (melisma)
//   «_»  une dos palabras en una sílaba (sinalefa): «de_amor» → de‿a·mor
//   , . ; : ! ? y el salto de línea marcan respiración.
(function () {
  'use strict';

  const ACCENTED = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' };
  const isVowelLetter = (ch) => ch.length === 1 && 'aeiouáéíóúü'.includes(ch);
  const NASALS = new Set(['m', 'n', 'ɲ', 'ŋ', 'ɱ']);
  // Ataques de dos consonantes posibles en español (sin «tl», a la peninsular).
  const ONSET_PAIRS = new Set(['pl', 'pɾ', 'bl', 'bɾ', 'fl', 'fɾ', 'kl', 'kɾ', 'gl', 'gɾ', 'tɾ', 'dɾ']);
  const BREATH = /[,.;:!?¡¿…\n]/;

  // Letras → unidades con su sonido. Una vocal lleva v (a e i o u) y si es fuerte.
  function units(word, { seseo }) {
    const lower = word.toLowerCase();
    const out = [];
    let pending = ''; // letras mudas que se pegan a la unidad siguiente
    const push = (t, p, extra = {}) => { out.push({ t: pending + t, p, ...extra }); pending = ''; };
    const next = (k) => lower[k] || '';
    const front = (k) => next(k) !== '' && 'eiéí'.includes(next(k));
    for (let k = 0; k < lower.length; k++) {
      const ch = lower[k];
      const orig = word.slice(k, k + 1);
      const two = word.slice(k, k + 2);
      if (isVowelLetter(ch)) {
        const v = ACCENTED[ch] || ch;
        // Una vocal con tilde (í, ú) rompe el diptongo: se pronuncia aparte.
        const strong = 'aeo'.includes(v) || 'íú'.includes(ch);
        push(orig, null, { v, strong });
        continue;
      }
      switch (ch) {
        case 'h': pending += orig; break;
        case 'c':
          if (next(k + 1) === 'h') { push(two, ['tʃ']); k++; }
          else push(orig, [front(k + 1) ? (seseo ? 's' : 'θ') : 'k']);
          break;
        case 'z': push(orig, [seseo ? 's' : 'θ']); break;
        case 'l':
          if (next(k + 1) === 'l') { push(two, ['ʝ']); k++; } else push(orig, ['l']);
          break;
        case 'r':
          if (next(k + 1) === 'r') { push(two, ['r']); k++; break; }
          {
            const prev = out[out.length - 1];
            const strong = !prev || (prev.p && ['n', 'l', 's'].includes(prev.p[prev.p.length - 1]));
            push(orig, [strong ? 'r' : 'ɾ']);
          }
          break;
        case 'q':
          // «qu» ante e/i: la u no suena.
          if (next(k + 1) === 'u') { push(two, ['k']); k++; } else push(orig, ['k']);
          break;
        case 'g':
          if (next(k + 1) === 'u' && front(k + 2)) { push(two, ['g']); k++; }
          else push(orig, [front(k + 1) ? 'x' : 'g']);
          break;
        case 'j': push(orig, ['x']); break;
        case 'ñ': push(orig, ['ɲ']); break;
        case 'v': case 'b': push(orig, ['b']); break;
        case 'w': push(orig, ['w']); break;
        case 'k': push(orig, ['k']); break;
        case 'x':
          if (out.length === 0) push(orig, ['s']);
          else { push(orig, ['k']); push('', ['s']); }
          break;
        case 'y':
          // Ante vocal es consonante; si no («hoy», «y»), es una i.
          if (isVowelLetter(next(k + 1))) push(orig, ['ʝ']);
          else push(orig, null, { v: 'i', strong: false });
          break;
        default:
          if ('pdtfmns'.includes(ch)) push(orig, [ch]);
          // Cualquier otra letra se ignora, pero su texto se conserva.
          else pending += orig;
      }
    }
    if (pending) {
      if (out.length) out[out.length - 1].t += pending;
      else return [];
    }
    return out;
  }

  // Unidades → sílabas. Las vocales débiles junto a otra vocal se vuelven
  // semiconsonantes (j, w): delante del núcleo van al ataque, detrás a la coda.
  function syllabify(us) {
    const vowelIdx = us.map((u, i) => (u.v ? i : -1)).filter((i) => i >= 0);
    if (!vowelIdx.length) return [];
    // Núcleos: toda vocal fuerte; en una racha solo de débiles, la última.
    const nucleus = new Set();
    let run = [];
    const closeRun = () => {
      if (!run.length) return;
      const strong = run.filter((i) => us[i].strong);
      if (strong.length) strong.forEach((i) => nucleus.add(i));
      else nucleus.add(run[run.length - 1]);
      run = [];
    };
    us.forEach((u, i) => {
      if (u.v) run.push(i); else closeRun();
    });
    closeRun();

    const nuclei = [...nucleus].sort((a, b) => a - b);
    const sylls = nuclei.map((n) => ({ nucleus: n, onset: [], coda: [] }));
    // Reparte lo que hay entre núcleos consecutivos.
    for (let k = 0; k <= nuclei.length; k++) {
      const from = k === 0 ? 0 : nuclei[k - 1] + 1;
      const to = k === nuclei.length ? us.length : nuclei[k];
      const mid = [];
      for (let i = from; i < to; i++) mid.push(i);
      if (k === 0) { sylls[0].onset = mid; continue; }
      if (k === nuclei.length) { sylls[k - 1].coda = mid; continue; }
      // Una vocal débil pegada al núcleo anterior y sin consonantes detrás va a su coda.
      let split = mid.length;
      const isGlide = (i) => Boolean(us[i].v);
      // Desde el final: las semiconsonantes pegadas al núcleo siguiente son suyas.
      while (split > 0 && isGlide(mid[split - 1])) split--;
      const glidesAfter = mid.slice(split);
      const rest = mid.slice(0, split);
      // Lo que queda: [vocales débiles del núcleo anterior] [consonantes]
      let c = 0;
      while (c < rest.length && isGlide(rest[c])) c++;
      const codaGlides = rest.slice(0, c);
      const cons = rest.slice(c);
      // Si no hay consonantes, una débil entre dos núcleos va con el siguiente.
      if (!cons.length && !glidesAfter.length && codaGlides.length) {
        glidesAfter.push(...codaGlides.splice(codaGlides.length - 1));
      }
      // Consonantes: el ataque más largo válido para la sílaba siguiente.
      let take = Math.min(1, cons.length);
      if (cons.length >= 2) {
        const pair = us[cons[cons.length - 2]].p.join('') + us[cons[cons.length - 1]].p.join('');
        if (ONSET_PAIRS.has(pair)) take = 2;
      }
      sylls[k - 1].coda = codaGlides.concat(cons.slice(0, cons.length - take));
      sylls[k].onset = cons.slice(cons.length - take).concat(glidesAfter);
    }
    return sylls;
  }

  const GLIDE = { i: 'j', u: 'w', e: 'j', o: 'w' };

  function toSegments(us, idx) {
    return idx.flatMap((i) => (us[i].v ? [GLIDE[us[i].v] || us[i].v] : us[i].p));
  }

  // Una palabra (o varias unidas con «_») → sílabas con su IPA y su texto.
  function wordSyllables(word, opts) {
    const parts = word.split('_').filter(Boolean);
    let us = [];
    parts.forEach((p, n) => {
      const pu = units(p, opts);
      if (n > 0 && pu.length) pu[0].t = '‿' + pu[0].t;
      // Sinalefa: la vocal final y la inicial pasan a ser una sola sílaba.
      if (n > 0 && us.length && pu.length && us[us.length - 1].v && pu[0].v) {
        const a = us[us.length - 1];
        const b = pu[0];
        if (a.v === b.v) { a.t += b.t; pu.shift(); }
        else if (a.v === 'a' || (b.v !== 'a' && 'iu'.includes(b.v))) { b.strong = false; }
        else { a.strong = false; }
      }
      us = us.concat(pu);
    });
    if (!us.length) return [];
    // Una «e»/«o» débil por sinalefa se canta como semiconsonante: j/w.
    const sylls = syllabify(us);
    return sylls.map((s) => {
      const all = [...s.onset, s.nucleus, ...s.coda].sort((a, b) => a - b);
      return {
        text: all.map((i) => us[i].t).join(''),
        onset: toSegments(us, s.onset),
        nucleus: us[s.nucleus].v,
        coda: toSegments(us, s.coda),
      };
    });
  }

  // Alófonos que dependen de lo que suena antes: b d g suaves entre vocales,
  // la n que se asimila a la consonante siguiente.
  function allophones(sylls) {
    const segs = [];
    sylls.forEach((s) => {
      s.onset.forEach((ipa, j) => segs.push({ s, part: 'onset', j, ipa }));
      segs.push({ s, part: 'nucleus', ipa: s.nucleus });
      s.coda.forEach((ipa, j) => segs.push({ s, part: 'coda', j, ipa }));
      if (s.phraseEnd) segs.push(null); // respiración
    });
    let prev = null; // último sonido; null al empezar o tras respirar
    segs.forEach((f, k) => {
      if (!f) { prev = null; return; }
      const next = segs[k + 1] ? segs[k + 1].ipa : null;
      let ipa = f.ipa;
      if (ipa === 'n') {
        if (['b', 'p', 'm'].includes(next)) ipa = 'm';
        else if (['k', 'g', 'x'].includes(next)) ipa = 'ŋ';
        else if (next === 'f') ipa = 'ɱ';
      }
      if (['b', 'd', 'g'].includes(ipa) && prev !== null && !NASALS.has(prev) && !(ipa === 'd' && prev === 'l')) {
        ipa = { b: 'β', d: 'ð', g: 'ɣ' }[ipa];
      }
      if (ipa !== f.ipa) {
        if (f.part === 'nucleus') f.s.nucleus = ipa;
        else f.s[f.part][f.j] = ipa;
      }
      prev = ipa;
    });
  }

  // Texto completo → sílabas en el formato de CHIMERA.
  function syllables(text, { seseo = false } = {}) {
    const tokens = String(text).match(/[A-Za-zÀ-ÿñÑ_']+|-+|~+|[,.;:!?¡¿…\n]/g) || [];
    const out = [];
    tokens.forEach((tok) => {
      if (BREATH.test(tok)) {
        if (out.length) out[out.length - 1].phraseEnd = true;
        return;
      }
      if (/^[-~]+$/.test(tok)) {
        // Melisma: la vocal sigue en otra nota; la coda pasa a la última.
        for (let r = 0; r < tok.length; r++) {
          const prev = out[out.length - 1];
          if (!prev) return;
          out.push({ text: '–', onset: [], nucleus: prev.nucleus, coda: prev.coda, melisma: true, wordEnd: prev.wordEnd, phraseEnd: false });
          prev.coda = [];
          prev.wordEnd = false;
        }
        return;
      }
      const ws = wordSyllables(tok.replace(/'/g, ''), { seseo });
      ws.forEach((s, n) => out.push({ ...s, wordEnd: n === ws.length - 1, phraseEnd: false }));
    });
    allophones(out);
    return out;
  }

  // Al formato JSON del cantante: cada sonido como { ipa }.
  function toChimera(s) {
    const seg = (ipa) => ({ ipa });
    const o = { text: s.text, onset: s.onset.map(seg), nucleus: seg(s.nucleus), coda: s.coda.map(seg), wordEnd: s.wordEnd, phraseEnd: s.phraseEnd };
    if (s.melisma) o.melisma = true;
    return o;
  }

  globalThis.Spanish = { syllables, toChimera, units, wordSyllables };
})();
