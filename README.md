# Enlace

Web para encadenar acordes y construir melodías sobre ellos, en guitarra y piano,
con 29 escalas y modos. No necesita instalación: abre `index.html` en el navegador.

- `js/theory.js`: escalas, acordes, ortografía y grados romanos.
- `js/suggest.js`: puntúa el siguiente acorde y explica por qué. Aquí están las
  tablas de pesos y las progresiones conocidas.
- `js/melody.js`: papel de cada nota sobre un acorde, pistas y generador.
- `js/voicings.js`: digitaciones de guitarra y posiciones de piano.
- `js/diagrams.js`, `js/audio.js`, `js/app.js`: dibujos, sonido e interfaz.

Pruebas del motor, desde esta carpeta:

    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/run.js
