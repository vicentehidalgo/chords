# Enlace

Web para encadenar acordes y construir melodías sobre ellos, en guitarra y piano,
con 29 escalas y modos. No necesita instalación: abre `index.html` en el navegador.

- `js/theory.js`: escalas, acordes, ortografía y grados romanos.
- `js/suggest.js`: puntúa el siguiente acorde y explica por qué. Aquí están las
  tablas de pesos y las progresiones conocidas.
- `js/melody.js`: papel de cada nota sobre un acorde, pistas y generador.
- `js/voicings.js`: digitaciones de guitarra y posiciones de piano.
- `js/drums.js`: rueda de ritmos, repartos euclídeos y variación entre compases.
- `js/midi.js`: salida a un instrumento externo.
- `js/spanish.js`: de la letra en español a sílabas con su pronunciación (IPA).
- `js/voice.js`: reparte la letra sobre la melodía y pide al motor que la cante.
- `voice/`: el puente en Rust con el motor de voz; `js/voz-wasm.js` es su compilado.
- `js/diagrams.js`, `js/audio.js`, `js/app.js`: dibujos, sonido e interfaz.

## Atajos

- `Tab`: pasa a la pestaña siguiente (Progresión, Melodía, Percusión, Voz). `Mayús+Tab` recorre los controles.
- `Espacio`: reproduce o para. `Cmd/Ctrl+Z`: deshace.

## MIDI

Conecta el instrumento por USB y pulsa «Conectar instrumento». Eliges qué enviar
(progresión, melodía, percusión o cualquier combinación) y por qué canal. La percusión
usa el mapa General MIDI, por defecto en el canal 10. Funciona en Chrome y Edge; Safari
no tiene Web MIDI.

## Voz

La pestaña Voz canta una letra sobre la melodía de la pestaña Melodía, una sílaba por
nota. «-» alarga la sílaba anterior una nota más, «_» une dos palabras en una sílaba
(`de_amor`) y la puntuación marca dónde respirar. Sigue sola la tonalidad, el tempo y el
swing de la canción, y ajusta el vibrato al pulso. A mano se eligen el cuerpo (hombre,
mujer o niño), el acento (España o Latinoamérica), la octava, el vibrato, el aire, el
brillo y el volumen.

La voz la genera [CHIMERA](https://github.com/jamesondh/chimera-vocal-synth), un modelo
físico de garganta y boca escrito en Rust (licencia MIT, `voice/CHIMERA-LICENSE`). Va
compilado a WebAssembly dentro de `js/voz-wasm.js`, así que la app sigue abriéndose con
doble clic. Para recompilarlo hace falta Rust con el destino `wasm32-unknown-unknown`:

    voice/build.sh

La voz solo suena en el navegador: no se envía por MIDI.

Pruebas del motor, desde esta carpeta:

    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/run.js
