# Enlace

A songwriting tool in the browser: chain chords that work together, write a melody and a
bass line over them, build drum patterns, and have a synthetic voice sing your lyrics, all in
the key and tempo of the song. Nothing to install: open `index.html` and start. Available in
Spanish and English.

## Features at a glance

- **Chord progressions that make sense**: suggests the next chord, explains why it fits, and
  shows it on guitar and piano. 29 scales and modes, plus well-known progressions.
- **Melody**: a note grid that colours every note by how it sounds over each chord, with
  hints for the next note and a melody generator.
- **Bass**: its own grid and a line generator in six styles (whole notes, root and fifth,
  octaves, arpeggio, walking, syncopated).
- **Drums**: a rhythm wheel with one ring per instrument; rings with different step counts
  make polyrhythms. Euclidean patterns, rhythms from around the world, and an “invent” button.
- **Lyrics and a singing voice**: write lyrics in Spanish or English and a physically
  modelled voice sings them, with each language’s own pronunciation. The voice has its own
  melody, independent of the instrumental one.
- **Fast re-singing**: the voice is rendered verse by verse across several processor cores,
  and only the verse you change is sung again.
- **Voice sound**: body (man, woman, child), power and per-verse dynamics, an automatic second
  voice that harmonises in the scale, reverb and an echo in time with the song.
- **Verses**: melody, bass and lyrics each have their own verses, with independent counts.
  Add, duplicate, remove and drag them to reorder.
- **Timeline**: a bar across the bottom shows the whole song and where playback is. Drag to
  loop a section of bars; clear it to play the song normally; click to start anywhere.
- **Feel**: tempo, a swing amount for each part, and a rhythm for the chords.
- **Mute and solo**: next to each part’s tab; solo one or several parts to hear them alone.
- **MIDI out**: play your instrument over USB with any combination of chords, melody, bass and
  drums, each on its own channel.
- **Projects**: save the song to a file you can download and open later; the browser tab shows
  the project name.
- **Export to WAV**: render the whole song, or the bars you choose, to an audio file.
- **Spanish and English**: the whole interface in either language, switched from the top right.
- **Quick to use**: tabs for each part (switch with the `Tab` key), undo, keyboard shortcuts,
  and a layout that fits the window without scrolling.

## Progression

Pick a tonic and a scale or mode (major and minor, the church modes, harmonic and melodic
minor modes, pentatonics, blues and more) and a chord level: triads, sevenths or all colours.
Each suggestion shows how well it fits and why: cadences, bass motion, common tones,
voice leading, the mode’s characteristic note. Outside the scale you also get secondary
dominants, tritone substitutes and chords borrowed from parallel modes. Every chord comes with
a guitar fingering and a piano voicing; positions are linked so the hand moves as little as
possible, and you can step through other voicings. The selected chord shows its notes and
diagrams; well-known progressions for the current scale load with one click.

## Melody

Click on the grid to place notes (eighth notes, each lasting until the next one). Colours
show the role of each note over the chord underneath: chord tone (rest), scale tone
(movement), a clash to use only in passing, or outside the scale. Rings suggest good notes to
continue. “Suggest a melody” writes one that leans on chord tones on strong beats and follows
an arc. Each verse has its own melody.

## Bass

A grid two octaves below the melody. Pick a style and press “Suggest a line” so the bass
follows the chords: the walking style approaches the next root by a semitone, and chromatic
notes get their own row so you can see where they sound. Edit note by note afterwards. Its
own verses, swing, mute button and MIDI channel (3 by default).

## Drums

Each ring is an instrument (kick, tom, snare, claps, rim, hi-hats, shaker, cowbell, clave) and
goes round once per bar. Set the steps and hits of each ring; hits are spread evenly
(Euclidean rhythms) and named when they match a traditional pattern such as the Cuban
tresillo or the bossa nova clave. Rotate rings, mute them, or choose when each one plays: freely,
with the melody, in its gaps, or with the chords. “Life” adds variation between bars,
“Invent” composes a new pattern and “Mutate” varies the current one. Presets range from rock
and funk to son, bembé, bulería and polyrhythms like 3 against 4.

## Lyrics and voice

In the Lyrics tab you write the lyrics and the melody the voice sings, on its own grid,
independent of the instrumental melody. One syllable per note: “-” holds the previous
syllable one more note, “_” joins two words into one syllable (Spanish `de_amor`) and
punctuation marks where to breathe. The syllable of each note is shown above the grid, with
a warning if there are syllables or notes left over. “Fit to lyrics” proposes a melody with
one note per syllable and each phrase in whole bars; “Copy from Melody” asks which melody
verse to copy. Each verse also has its dynamics (soft, normal, loud) and whether the second
voice sings in it.

The Voice tab shows the whole song verse by verse, and the sound:

- **Body, octave and timbre**: man, woman or child; automatic or fixed octave; vibrato,
  breath, brightness and volume. In Spanish, a Spain or Latin American accent.
- **Power**: air pressure, which makes the voice louder and more pushed.
- **Second voice**: a parallel harmony inside the scale (3rd above, 3rd below or 6th below)
  with its own body and volume.
- **Room**: reverb and an echo every eighth, dotted eighth or quarter note, which follows the
  tempo.

The voice follows the song’s key, tempo and swing, fits its vibrato to the beat, and sings its
consonants just before the beat. It is generated by
[CHIMERA](https://github.com/jamesondh/chimera-vocal-synth), a physical model of the lungs,
vocal folds, throat and mouth. Spanish is sung with its own rules (syllables, diphthongs, soft
b/d/g, rolled and tapped r…) and English with the CMU Pronouncing Dictionary. The voice is
rendered in pieces (each verse, and the second voice, separately) spread across up to four
processor cores, and pieces that have not changed are reused, so editing one verse only
re-sings that verse. The voice plays in the browser; it is not sent over MIDI.

## Verses

The melody, the bass and the lyrics each have their own verses (up to 8). Each verse plays
over one pass of the progression. “+ Verse” adds an empty one, “Duplicate” copies the
selected verse right after it, and you can drag the verse buttons to change the order (mouse
or finger). If one part has fewer verses than another it starts over; without loop, the song
lasts as long as the part with the most verses.

## Timeline

The bar at the bottom, the same on every tab, shows the whole song bar by bar with the chord
of each bar and which verses play in each pass (M = melody, B = bass, L = lyrics), the total
length and the playback position. Drag across it to loop a section of bars, even across
verses; “Clear loop” removes it and the song plays normally. Click a bar to start from there.

## Mute and solo

Next to each part’s tab there is a mute button (speaker) and a solo button (S). When any part
is soloed, only the soloed parts play; you can solo several at once, and a soloed part that is
also muted stays silent. Parts silenced by someone else’s solo show a dimmed speaker. Mute and
solo affect the browser sound; what is sent over MIDI is chosen in the MIDI menu.

## Swing and rhythm

Each part (chords, melody, bass, drums and voice) has its own swing, from straight to
triplet feel and beyond. The slider in the transport bar controls the part of the tab you are
on. The chords can play as whole notes, quarters, a Charleston rhythm or eighths.

## MIDI

Plug your instrument in over USB and press “Connect instrument”. Choose what to send
(progression, melody, bass, drums or any combination) and on which channel; drums use the
General MIDI map on channel 10. You can keep the browser sound on as well, and silence the
instrument at any time. Works in Chrome and Edge (Safari has no Web MIDI).

## Projects

In the Project menu, “Download project” saves the song to a `.enlace.json` file: progression,
melody, bass, drums, lyrics and voice with all their verses, tempo and swing. “Open…” (or
dropping the file onto the page) brings it back; if you open one by mistake, Undo returns to
the song you had. Language, the open tab and the MIDI setup stay with your browser.

“Export WAV”, in the same menu, renders the song to a stereo 16-bit, 44.1 kHz audio file:
the whole song or a range of bars (it starts with the loop picked on the timeline, if any). It
mixes chords, melody, bass, drums and voice with the reverb and echo, follows each part’s
swing and respects mute and solo; if the voice is still being sung, it waits for it.

## Shortcuts

- `Tab`: next tab (Progression, Melody, Bass, Drums, Lyrics, Voice). `Shift+Tab` moves through the controls.
- `Space`: play or stop. `Cmd/Ctrl+Z`: undo.
- `Cmd/Ctrl+S`: download the project. `Cmd/Ctrl+O`: open one.

## For developers

No build step: plain scripts loaded by `index.html`, so it also works from `file://`.

- `js/theory.js`: scales, chords, note spelling and Roman numerals.
- `js/suggest.js`: scores the next chord and explains why; weight tables and well-known progressions.
- `js/voicings.js`: guitar fingerings and piano voicings.
- `js/melody.js`: note roles over a chord, hints, the melody generator and swing timing.
- `js/bass.js`: bass line styles.
- `js/drums.js`: the rhythm wheel, Euclidean patterns and variation between bars.
- `js/spanish.js`: Spanish lyrics to syllables with their pronunciation (IPA).
- `js/voice.js`: spreads the lyrics over the melody and runs the voice engine in workers.
- `js/i18n.js`: English texts for the interface and the data.
- `js/midi.js`, `js/audio.js`, `js/diagrams.js`, `js/app.js`: MIDI, sound, drawings and interface.
- `voice/`: the Rust bridge to CHIMERA. `js/voz-wasm.js` is its WebAssembly build
  (`voice/build.sh`, needs Rust with the `wasm32-unknown-unknown` target) and
  `js/cmudict.js` the embedded pronouncing dictionary (`voice/dict.sh`).

Licenses: CHIMERA is MIT (`voice/CHIMERA-LICENSE`); the CMU Pronouncing Dictionary has its own
license (`voice/CMUDICT-LICENSE`).

Engine tests, from this folder:

    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/run.js
