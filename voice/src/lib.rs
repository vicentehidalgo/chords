//! Voz cantada de Enlace. Una sola llamada planifica la canción entera con el
//! cantante de CHIMERA y luego se renderiza por trozos, para poder mostrar el
//! progreso y cancelar. Sin imports ni wasm-bindgen: solo números y punteros.
//!
//! Petición (JSON, camelCase):
//! { sampleRate, body: {female, child}, bpm, t0, vibrato, tail,
//!   source: { breathiness, brightness, ... },
//!   notes: [{ midi, beats, syl? }] }  — una nota sin `syl` es un silencio.

use chimera::anatomy::human::BodyMix;
use chimera::math::midi_to_hz;
use chimera::phonetics::Syllable;
use chimera::phonetics::sing::{SongOptions, SungNote, plan_song};
use chimera::voice::human_voice::{HumanVoice, SourcePatch, oversample_for};
use serde::Deserialize;
use std::cell::RefCell;

const BLOCK: usize = 128;
const MAX_RENDER: usize = 16384;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    sample_rate: f64,
    body: BodyMix,
    bpm: f64,
    t0: f64,
    vibrato: f64,
    #[serde(default)]
    tail: Option<f64>,
    #[serde(default)]
    source: SourcePatch,
    notes: Vec<Note>,
}

#[derive(Deserialize)]
struct Note {
    midi: f64,
    beats: f64,
    #[serde(default)]
    syl: Option<Syllable>,
}

#[derive(Default)]
struct State {
    input: Vec<u8>,
    out: Vec<f32>,
    error: String,
    voice: Option<HumanVoice>,
    total: usize,
    done: usize,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn start(req: Request) -> Result<(HumanVoice, usize), String> {
    if !(req.bpm > 0.0) || !(req.sample_rate > 0.0) {
        return Err("bpm y sampleRate deben ser positivos".into());
    }
    let first = req.notes.iter().find(|n| n.syl.is_some()).ok_or("no hay notas con letra")?;
    let fs = req.sample_rate;
    let mut v = HumanVoice::new(fs, req.body.body(), oversample_for(fs));
    // Igual que `chimera render notes`, con los retoques de la petición encima.
    let mut source = SourcePatch {
        f0: Some(midi_to_hz(first.midi)),
        voiced: Some(true),
        pressure: Some(9.0),
        tension: Some(0.55),
        ..Default::default()
    };
    let p = req.source;
    for (dst, src) in [
        (&mut source.breathiness, p.breathiness),
        (&mut source.brightness, p.brightness),
        (&mut source.pressure, p.pressure),
        (&mut source.tension, p.tension),
        (&mut source.roughness, p.roughness),
        (&mut source.vibrato_rate, p.vibrato_rate),
        (&mut source.drift, p.drift),
    ] {
        if src.is_some() {
            *dst = src;
        }
    }
    v.set_source(&source);

    // Cada tramo cantado entre silencios se planifica por separado: toma aire.
    let beat = 60.0 / req.bpm;
    let (mut t, mut start, mut end) = (req.t0, req.t0, 0.0f64);
    let mut phrase: Vec<SungNote> = Vec::new();
    let mut flush = |phrase: &mut Vec<SungNote>, start: f64, v: &mut HumanVoice| {
        if phrase.is_empty() {
            return;
        }
        let plan = plan_song(phrase, &SongOptions { body: req.body, bpm: req.bpm, t0: start, vibrato: req.vibrato });
        v.schedule(&plan.gestures);
        end = end.max(plan.end);
        phrase.clear();
    };
    for n in &req.notes {
        match &n.syl {
            Some(syl) if n.midi > 0.0 => {
                if phrase.is_empty() {
                    start = t;
                }
                phrase.push(SungNote { midi: n.midi, beats: n.beats, syl: syl.clone() });
            }
            _ => flush(&mut phrase, start, &mut v),
        }
        t += n.beats * beat;
    }
    flush(&mut phrase, start, &mut v);
    let total = ((end + req.tail.unwrap_or(0.4)) * fs).round() as usize;
    Ok((v, total))
}

/// Reserva `len` bytes para la petición y devuelve dónde escribirla.
#[unsafe(no_mangle)]
pub extern "C" fn voz_input(len: usize) -> *mut u8 {
    STATE.with_borrow_mut(|s| {
        s.input.clear();
        s.input.resize(len, 0);
        s.input.as_mut_ptr()
    })
}

/// Planifica la petición escrita con `voz_input`. Devuelve las muestras totales, o -1.
#[unsafe(no_mangle)]
pub extern "C" fn voz_start() -> f64 {
    STATE.with_borrow_mut(|s| {
        s.voice = None;
        s.error.clear();
        let parsed = serde_json::from_slice::<Request>(&s.input).map_err(|e| e.to_string()).and_then(start);
        match parsed {
            Ok((v, total)) => {
                s.voice = Some(v);
                s.total = total;
                s.done = 0;
                total as f64
            }
            Err(e) => {
                s.error = e;
                -1.0
            }
        }
    })
}

/// Renderiza hasta `frames` muestras más. Devuelve cuántas; se leen en `voz_output`.
#[unsafe(no_mangle)]
pub extern "C" fn voz_render(frames: usize) -> usize {
    STATE.with_borrow_mut(|s| {
        let n = frames.min(MAX_RENDER).min(s.total - s.done);
        s.out.resize(MAX_RENDER, 0.0);
        let Some(v) = s.voice.as_mut() else { return 0 };
        for block in s.out[..n].chunks_mut(BLOCK) {
            v.render(block);
        }
        s.done += n;
        if s.done >= s.total {
            s.voice = None;
        }
        n
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn voz_output() -> *const f32 {
    STATE.with_borrow(|s| s.out.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn voz_error_ptr() -> *const u8 {
    STATE.with_borrow(|s| s.error.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn voz_error_len() -> usize {
    STATE.with_borrow(|s| s.error.len())
}
