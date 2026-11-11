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

  // delay: segundos hasta que debe sonar (permite programar con antelación).
  function chord(midis, instrument, dur = 1.6, gain = .2, delay = 0) {
    if (!ensure()) return;
    const strum = instrument === 'guitar' ? .022 : .004;
    const at = ctx.currentTime + .01 + Math.max(0, delay);
    midis.forEach((m, i) => tone(m, at + i * strum, dur, gain, instrument));
  }

  function note(midi, dur = .4, gain = .32, delay = 0) {
    if (!ensure()) return;
    tone(midi, ctx.currentTime + .01 + Math.max(0, delay), dur, gain, 'lead');
  }

  // Percusión sintetizada ------------------------------------------------------

  let noiseBuffer = null;
  function noise(at, dur, gain, filterType, freq, q = 1) {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(.0001, at + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(at, Math.random() * .5, dur + .02);
  }

  function pitched(at, dur, gain, type, from, to = from) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur * .6);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(.0001, at + dur);
    osc.connect(env).connect(master);
    osc.start(at);
    osc.stop(at + dur + .02);
  }

  const KIT = {
    kick(t, g) { pitched(t, .28, g * .95, 'sine', 150, 45); noise(t, .012, g * .2, 'lowpass', 2000); },
    tom(t, g) { pitched(t, .3, g * .7, 'sine', 190, 95); },
    snare(t, g) { noise(t, .17, g * .55, 'bandpass', 1900, .7); pitched(t, .1, g * .35, 'triangle', 200, 150); },
    clap(t, g) {
      [0, .011, .022].forEach((d) => noise(t + d, .02, g * .4, 'bandpass', 1300, 1.2));
      noise(t + .03, .13, g * .45, 'bandpass', 1300, 1);
    },
    rim(t, g) { pitched(t, .035, g * .4, 'square', 1700); pitched(t, .05, g * .4, 'triangle', 480); },
    hat(t, g) { noise(t, .045, g * .3, 'highpass', 8000); },
    openhat(t, g) { noise(t, .3, g * .28, 'highpass', 7000); },
    shaker(t, g) { noise(t, .06, g * .16, 'bandpass', 6000, .8); },
    cowbell(t, g) { pitched(t, .2, g * .2, 'square', 562); pitched(t, .2, g * .2, 'square', 845); },
    clave(t, g) { pitched(t, .05, g * .55, 'sine', 2500); },
  };

  function drum(name, velocity = 100, delay = 0) {
    if (!ensure()) return;
    KIT[name](ctx.currentTime + .01 + Math.max(0, delay), .75 * velocity / 127);
  }

  // Sala de la voz -------------------------------------------------------------
  // Las voces pasan por un bus con reverberación (respuesta sintética: ruido que
  // se apaga) y un eco con realimentación, cuyo tiempo fija la app según el tempo.

  let bus = null;
  let fx = { reverb: 0, echo: 0, echoTime: .45 };

  function impulse(secs) {
    const len = Math.round(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      const pre = Math.round(ctx.sampleRate * .012);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre);
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (1 - Math.exp(-i / (ctx.sampleRate * .004)));
      }
    }
    return buf;
  }

  function voiceBus() {
    if (bus) return bus;
    const input = ctx.createGain();
    input.connect(master); // señal directa
    const revSend = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse(2.6);
    const revOut = ctx.createGain();
    revOut.gain.value = .9;
    input.connect(revSend).connect(conv).connect(revOut).connect(master);
    const echoSend = ctx.createGain();
    const delay = ctx.createDelay(3);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2800;
    const feedback = ctx.createGain();
    input.connect(echoSend).connect(delay).connect(tone);
    tone.connect(feedback).connect(delay);
    tone.connect(master);
    tone.connect(revSend); // los ecos también suenan en la sala
    bus = { input, revSend, echoSend, delay, feedback };
    applyFx();
    return bus;
  }

  function applyFx() {
    if (!bus) return;
    const t = ctx.currentTime;
    bus.revSend.gain.setTargetAtTime(fx.reverb * .7, t, .05);
    bus.echoSend.gain.setTargetAtTime(fx.echo * .55, t, .05);
    bus.feedback.gain.setTargetAtTime(.22 + fx.echo * .3, t, .05);
    bus.delay.delayTime.setTargetAtTime(Math.min(2.9, fx.echoTime), t, .05);
  }

  // reverb y echo de 0 a 1; echoTime en segundos.
  function voiceFx(next) {
    fx = { ...fx, ...next };
    applyFx();
  }

  // Muestras ya renderizadas (la voz). Devuelve con qué pararlas o cambiar su volumen.
  const buffers = new WeakMap();
  function buffer(samples, rate, delay = 0, gain = 1, pan = 0) {
    if (!ensure()) return null;
    let buf = buffers.get(samples);
    if (!buf) {
      buf = ctx.createBuffer(1, samples.length, rate);
      buf.copyToChannel(samples, 0);
      buffers.set(samples, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = src.connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(voiceBus().input);
    // Si el momento ya pasó, empieza ahora desde donde debería ir.
    const at = ctx.currentTime + .01 + delay;
    if (delay >= 0) src.start(at);
    else src.start(ctx.currentTime + .01, Math.min(-delay, buf.duration));
    return {
      stop() { try { src.stop(); } catch (e) { /* ya parado */ } },
      gain(v) { g.gain.setTargetAtTime(v, ctx.currentTime, .03); },
    };
  }

  globalThis.Sound = { chord, note, drum, buffer, voiceFx };
})();
