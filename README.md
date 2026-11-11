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

- `Tab`: pasa a la pestaña siguiente (Progresión, Melodía, Percusión, Letra, Voz). `Mayús+Tab` recorre los controles.
- `Espacio`: reproduce o para. `Cmd/Ctrl+Z`: deshace.

## MIDI

Conecta el instrumento por USB y pulsa «Conectar instrumento». Eliges qué enviar
(progresión, melodía, percusión o cualquier combinación) y por qué canal. La percusión
usa el mapa General MIDI, por defecto en el canal 10. Funciona en Chrome y Edge; Safari
no tiene Web MIDI.

## Voz

En la pestaña Letra se escribe lo que canta la voz: la letra y su propia melodía, en una
rejilla como la de Melodía pero independiente de ella. Se pueden tener varias estrofas;
cada una suena en una vuelta de la progresión, una tras otra. Una sílaba por nota: «-»
alarga la sílaba anterior una nota más, «_» une dos palabras en una sílaba (`de_amor`) y
la puntuación marca dónde respirar. «Ajustar a la letra» propone una melodía con una nota
por sílaba y cada frase en compases enteros.

La pestaña Voz muestra la canción entera y el sonido:

- **Fuerza**: la presión del aire, que sube el volumen y empuja la voz. Cada estrofa puede
  ir suave, normal o fuerte (se elige en Letra).
- **Segunda voz**: una armonía automática dentro de la escala (3ª arriba, 3ª abajo o 6ª
  abajo), con su propio cuerpo y volumen. En Letra se elige en qué estrofas canta.
- **Sala**: reverberación y un eco que cae a tempo (a la corchea, a la corchea con
  puntillo o a la negra) y se reajusta al cambiar el tempo. Sigue sola la tonalidad, el tempo y el
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
