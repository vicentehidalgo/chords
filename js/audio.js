// Sintetizador mínimo con Web Audio: no necesita muestras de sonido.
(function () {
  'use strict';
  let ctx = null;
  let master = null;

  function ensure() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createDynamicsCompressor();
      const out = ctx.createGain();
      out.gain.value = .8;
      master.connect(out).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const VOICES = {
    guitar: { waves: [['triangle', 1, .7], ['sawtooth', 1, .08]], attack: .004, decay: 1.6, cut: 2600 },
    piano: { waves: [['triangle', 1, .6], ['sine', 2, .18]], attack: .006, decay: 2.2, cut: 3400 },
    lead: { waves: [['sine', 1, .75], ['triangle', 2, .1]], attack: .02, decay: 3, cut: 5000 },
  };

  function tone(midi, at, dur, gain, name) {
    const v = VOICES[name];
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(v.cut, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(600, v.cut * .3), at + dur);
    env.gain.setValueAtTime(.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + v.attack);
    env.gain.setTargetAtTime(gain * .3, at + v.attack, v.decay / 4);
    env.gain.setTargetAtTime(.0001, at + dur, .06);
    filter.connect(env).connect(master);
    v.waves.forEach(([type, ratio, level]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = hz(midi) * ratio;
      g.gain.value = level;
      osc.connect(g).connect(filter);
      osc.start(at);
      osc.stop(at + dur + .4);
    });
  }

  function chord(midis, instrument, dur = 1.6, gain = .2) {
    if (!ensure()) return;
    const strum = instrument === 'guitar' ? .022 : .004;
    midis.forEach((m, i) => tone(m, ctx.currentTime + .01 + i * strum, dur, gain, instrument));
  }

  function note(midi, dur = .4, gain = .32) {
    if (!ensure()) return;
    tone(midi, ctx.currentTime + .01, dur, gain, 'lead');
  }

  globalThis.Sound = { chord, note };
})();
