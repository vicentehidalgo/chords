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
- `js/diagrams.js`, `js/audio.js`, `js/app.js`: dibujos, sonido e interfaz.

## Atajos

- `Tab`: pasa a la pestaña siguiente (Progresión, Melodía, Percusión). `Mayús+Tab` recorre los controles.
- `Espacio`: reproduce o para. `Cmd/Ctrl+Z`: deshace.

## MIDI

Conecta el instrumento por USB y pulsa «Conectar instrumento». Eliges qué enviar
(progresión, melodía, percusión o cualquier combinación) y por qué canal. La percusión
usa el mapa General MIDI, por defecto en el canal 10. Funciona en Chrome y Edge; Safari
no tiene Web MIDI.

Pruebas del motor, desde esta carpeta:

    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/run.js
