//! Voz cantada de Enlace. Una sola llamada planifica la canción entera con el
//! cantante de CHIMERA y luego se renderiza por trozos, para poder mostrar el
//! progreso y cancelar. Sin imports ni wasm-bindgen: solo números y punteros.
//!
//! Petición (JSON, camelCase):
//! { sampleRate, body: {female, child}, bpm, t0, vibrato, tail,
//!   source: { breathiness, brightness, pressure, ... },
//!   notes: [{ midi, beats, syl? }],            — una nota sin `syl` es un silencio
//!   events?: [{ t, source }],                   — cambios de fuente en el tiempo (s)
//!   harmony?: { body, notes } }                 — segunda voz, misma letra y tiempo

use chimera::anatomy::human::BodyMix;
use chimera::math::midi_to_hz;
use chimera::phonetics::Syllable;
use chimera::phonetics::english::EnglishG2P;
use chimera::phonetics::syllables::lyrics_to_syllables;
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
    /// Cambios de la fuente a lo largo de la canción (p. ej. la fuerza de cada estrofa).
    #[serde(default)]
    events: Vec<Event>,
    /// Segunda voz: otro cuerpo y otras notas, con la misma letra y el mismo tiempo.
    #[serde(default)]
    harmony: Option<Part>,
}

#[derive(Deserialize)]
struct Note {
    midi: f64,
    beats: f64,
    #[serde(default)]
    syl: Option<Syllable>,
}

#[derive(Deserialize)]
struct Event {
    t: f64,
    source: SourcePatch,
}

#[derive(Deserialize)]
struct Part {
    body: BodyMix,
    notes: Vec<Note>,
}

#[derive(Default)]
struct State {
    input: Vec<u8>,
    out: Vec<f32>,
    out2: Vec<f32>,
    error: String,
    voices: Vec<HumanVoice>,
    events: Vec<Event>,
    next_event: usize,
    fs: f64,
    total: usize,
    done: usize,
    /// Pronunciación inglesa: diccionario CMU (o reglas de letra a sonido sin él).
    g2p: Option<EnglishG2P>,
    result: String,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

/// Una voz con sus notas planificadas. Devuelve la voz y cuándo termina (s).
fn voice(req: &Request, body: BodyMix, notes: &[Note]) -> Result<(HumanVoice, f64), String> {
    let first = notes.iter().find(|n| n.syl.is_some() && n.midi > 0.0).ok_or("no hay notas con letra")?;
    let fs = req.sample_rate;
    let mut v = HumanVoice::new(fs, body.body(), oversample_for(fs));
    // Igual que `chimera render notes`, con los retoques de la petición encima.
    let mut source = SourcePatch {
        f0: Some(midi_to_hz(first.midi)),
        voiced: Some(true),
        pressure: Some(9.0),
        tension: Some(0.55),
        ..Default::default()
    };
    merge(&mut source, &req.source);
    v.set_source(&source);

    // Cada tramo cantado entre silencios se planifica por separado: toma aire.
    let beat = 60.0 / req.bpm;
    let (mut t, mut start, mut end) = (req.t0, req.t0, 0.0f64);
    let mut phrase: Vec<SungNote> = Vec::new();
    let mut flush = |phrase: &mut Vec<SungNote>, start: f64, v: &mut HumanVoice| {
        if phrase.is_empty() {
            return;
        }
        let plan = plan_song(phrase, &SongOptions { body, bpm: req.bpm, t0: start, vibrato: req.vibrato });
        v.schedule(&plan.gestures);
        end = end.max(plan.end);
        phrase.clear();
    };
    for n in notes {
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
    Ok((v, end))
}

/// Copia en `dst` los valores que trae `src` (los que no, se quedan).
fn merge(dst: &mut SourcePatch, src: &SourcePatch) {
    for (d, s) in [
        (&mut dst.breathiness, src.breathiness),
        (&mut dst.brightness, src.brightness),
        (&mut dst.pressure, src.pressure),
        (&mut dst.tension, src.tension),
        (&mut dst.roughness, src.roughness),
        (&mut dst.vibrato_rate, src.vibrato_rate),
        (&mut dst.drift, src.drift),
        (&mut dst.fry, src.fry),
        (&mut dst.glide, src.glide),
    ] {
        if s.is_some() {
            *d = s;
        }
    }
}

fn start(st: &mut State, mut req: Request) -> Result<usize, String> {
    if !(req.bpm > 0.0) || !(req.sample_rate > 0.0) {
        return Err("bpm y sampleRate deben ser positivos".into());
    }
    let (lead, mut end) = voice(&req, req.body, &req.notes)?;
    st.voices = vec![lead];
    if let Some(h) = &req.harmony {
        // Una segunda voz sin ninguna nota cantada simplemente no se crea.
        if let Ok((v, e)) = voice(&req, h.body, &h.notes) {
            st.voices.push(v);
            end = end.max(e);
        }
    }
    req.events.sort_by(|a, b| a.t.total_cmp(&b.t));
    st.events = std::mem::take(&mut req.events);
    st.next_event = 0;
    st.fs = req.sample_rate;
    Ok(((end + req.tail.unwrap_or(0.4)) * req.sample_rate).round() as usize)
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
        s.voices.clear();
        s.error.clear();
        let parsed = serde_json::from_slice::<Request>(&s.input).map_err(|e| e.to_string());
        match parsed.and_then(|req| start(s, req)) {
            Ok(total) => {
                s.total = total;
                s.done = 0;
                total as f64
            }
            Err(e) => {
                s.voices.clear();
                s.error = e;
                -1.0
            }
        }
    })
}

/// Cuántas voces suenan: 1, o 2 con la armonía (la segunda se lee en `voz_output2`).
#[unsafe(no_mangle)]
pub extern "C" fn voz_parts() -> usize {
    STATE.with_borrow(|s| s.voices.len())
}

/// Renderiza hasta `frames` muestras más. Devuelve cuántas; se leen en `voz_output`.
#[unsafe(no_mangle)]
pub extern "C" fn voz_render(frames: usize) -> usize {
    STATE.with_borrow_mut(|s| {
        if s.voices.is_empty() {
            return 0;
        }
        let n = frames.min(MAX_RENDER).min(s.total - s.done);
        s.out.resize(MAX_RENDER, 0.0);
        s.out2.resize(MAX_RENDER, 0.0);
        let mut pos = 0;
        while pos < n {
            // Los cambios de fuente entran al principio del bloque que los contiene.
            let now = (s.done + pos) as f64 / s.fs;
            while s.next_event < s.events.len() && s.events[s.next_event].t <= now {
                let patch = s.events[s.next_event].source;
                s.voices.iter_mut().for_each(|v| v.set_source(&patch));
                s.next_event += 1;
            }
            let len = BLOCK.min(n - pos);
            let (a, b) = (&mut s.out[pos..pos + len], &mut s.out2[pos..pos + len]);
            s.voices[0].render(a);
            match s.voices.get_mut(1) {
                Some(v) => v.render(b),
                None => b.fill(0.0),
            }
            pos += len;
        }
        s.done += n;
        if s.done >= s.total {
            s.voices.clear();
        }
        n
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn voz_output() -> *const f32 {
    STATE.with_borrow(|s| s.out.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn voz_output2() -> *const f32 {
    STATE.with_borrow(|s| s.out2.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn voz_error_ptr() -> *const u8 {
    STATE.with_borrow(|s| s.error.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn voz_error_len() -> usize {
    STATE.with_borrow(|s| s.error.len())
}

// Inglés ----------------------------------------------------------------------

/// Carga el diccionario de pronunciación (texto de CMUdict) escrito con `voz_input`.
#[unsafe(no_mangle)]
pub extern "C" fn voz_dict_load() {
    STATE.with_borrow_mut(|s| {
        let text = String::from_utf8_lossy(&s.input).into_owned();
        s.g2p.get_or_insert_with(EnglishG2P::new).load_dict(&text);
        s.input = Vec::new();
    })
}

/// Letra inglesa (escrita con `voz_input`) → sílabas en JSON, en `voz_result_*`.
#[unsafe(no_mangle)]
pub extern "C" fn voz_english() -> usize {
    STATE.with_borrow_mut(|s| {
        let text = String::from_utf8_lossy(&s.input).into_owned();
        let g2p = s.g2p.get_or_insert_with(EnglishG2P::new);
        let syl = lyrics_to_syllables(&text, g2p);
        s.result = serde_json::to_string(&syl).unwrap_or_else(|_| "[]".into());
        s.result.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn voz_result_ptr() -> *const u8 {
    STATE.with_borrow(|s| s.result.as_ptr())
}
