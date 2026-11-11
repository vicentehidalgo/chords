// Idioma de la interfaz. La app está escrita en español; en inglés, `tx` elige la
// variante inglesa de un texto de la interfaz y `tr` traduce los textos que vienen
// de los datos (escalas, acordes, razones de las sugerencias, ritmos…).
(function () {
  'use strict';

  let lang = 'es';

  const DICT = {
    // Escalas y grupos
    'Modos griegos': 'Church modes', 'Menor armónica': 'Harmonic minor', 'Menor melódica': 'Melodic minor', Otras: 'Others',
    'Jónico (mayor)': 'Ionian (major)', 'Dórico': 'Dorian', Frigio: 'Phrygian', Lidio: 'Lydian', Mixolidio: 'Mixolydian',
    'Eólico (menor natural)': 'Aeolian (natural minor)', Locrio: 'Locrian',
    'Locrio ♮6': 'Locrian ♮6', 'Jónico ♯5': 'Ionian ♯5', 'Dórico ♯4': 'Dorian ♯4', 'Frigio dominante': 'Phrygian dominant',
    'Lidio ♯2': 'Lydian ♯2', 'Superlocrio ♭♭7': 'Superlocrian ♭♭7',
    'Dórico ♭2': 'Dorian ♭2', 'Lidio aumentado': 'Lydian augmented', 'Lidio dominante': 'Lydian dominant',
    'Mixolidio ♭6': 'Mixolydian ♭6', 'Locrio ♮2': 'Locrian ♮2', Alterada: 'Altered',
    'Mayor armónica': 'Harmonic major', 'Húngara menor': 'Hungarian minor', 'Doble armónica': 'Double harmonic',
    'Pentatónica mayor': 'Major pentatonic', 'Pentatónica menor': 'Minor pentatonic', Blues: 'Blues',
    'Tonos enteros': 'Whole tone', 'Disminuida (tono-semitono)': 'Diminished (whole-half)',
    // Cualidades de acorde
    mayor: 'major', menor: 'minor', disminuido: 'diminished', aumentado: 'augmented',
    'mayor con 7ª mayor': 'major seventh', dominante: 'dominant seventh', 'menor con 7ª': 'minor seventh',
    semidisminuido: 'half-diminished', 'disminuido con 7ª': 'diminished seventh', 'menor con 7ª mayor': 'minor-major seventh',
    'aumentado con 7ª mayor': 'augmented major seventh', 'dominante aumentado': 'augmented seventh',
    'suspendido 2ª': 'suspended 2nd', 'suspendido 4ª': 'suspended 4th', 'dominante suspendido': 'suspended dominant',
    'mayor con 6ª': 'major sixth', 'menor con 6ª': 'minor sixth', 'mayor con 9ª añadida': 'major add 9',
    'menor con 9ª añadida': 'minor add 9', 'mayor con 7ª y 9ª': 'major ninth', 'dominante con 9ª': 'dominant ninth',
    'menor con 7ª y 9ª': 'minor ninth',
    // Progresiones conocidas
    'Pop canónico': 'Pop canon', 'Pop desde el relativo': 'Pop from the relative minor', 'Doo-wop': 'Doo-wop',
    'Rock clásico': 'Classic rock', 'II–V–I de jazz': 'Jazz ii–V–I', Turnaround: 'Turnaround', 'Royal Road': 'Royal Road',
    'Balada menor': 'Minor ballad', 'Descenso eólico': 'Aeolian descent', 'Menor modal': 'Modal minor',
    'Ciclo menor': 'Minor cycle', 'Cadencia menor': 'Minor cadence', 'Cadencia andaluza': 'Andalusian cadence',
    'Menor con vi': 'Minor with ♭VI', 'Menor luminosa': 'Bright minor', 'Dominante menor': 'Minor dominant',
    'Vamp dórico': 'Dorian vamp', 'Dórico rock': 'Dorian rock', 'Subida dórica': 'Dorian climb', 'Dórico soul': 'Dorian soul',
    'Vamp frigio': 'Phrygian vamp', 'Frigio ibérico': 'Iberian Phrygian', 'Frigio oscuro': 'Dark Phrygian',
    'Vamp lidio': 'Lydian vamp', 'Lidio flotante': 'Floating Lydian', 'Lidio cinematográfico': 'Cinematic Lydian',
    'Rock mixolidio': 'Mixolydian rock', 'Vamp mixolidio': 'Mixolydian vamp', 'Mixolidio folk': 'Mixolydian folk',
    'Mixolidio con v': 'Mixolydian with v', 'Vamp locrio': 'Locrian vamp', 'Locrio inquieto': 'Restless Locrian',
    'Vamp flamenco': 'Flamenco vamp', 'Vamp lidio dominante': 'Lydian dominant vamp', 'Mayor con iv': 'Major with iv',
    'Subdominante menor': 'Minor subdominant', 'Épica menor': 'Minor epic',
    // Razones de las sugerencias
    'Bajo sube un semitono': 'Bass rises a semitone', 'Bajo sube por grado conjunto': 'Bass rises by step',
    'Bajo sube una tercera': 'Bass rises a third', 'Bajo baja una quinta': 'Bass falls a fifth',
    'Bajo sube una quinta': 'Bass rises a fifth', 'Bajo baja una tercera': 'Bass falls a third',
    'Bajo baja por grado conjunto': 'Bass falls by step', 'Bajo baja un semitono': 'Bass falls a semitone',
    'Bajo sube una cuarta': 'Bass rises a fourth', 'Bajo baja una cuarta': 'Bass falls a fourth', 'Bajo se mueve un tritono': 'Bass moves a tritone',
    'Cadencia perfecta: dominante a tónica': 'Perfect cadence: dominant to tonic',
    'La sensible resuelve en la tónica': 'The leading tone resolves to the tonic', 'Cadencia plagal': 'Plagal cadence',
    'Cadencia frigia: ♭II a tónica': 'Phrygian cadence: ♭II to tonic', 'Cadencia modal: ♭VII a tónica': 'Modal cadence: ♭VII to tonic',
    'Cadencia rota: evita la tónica': 'Deceptive cadence: avoids the tonic',
    'Retroceso suave a la subdominante': 'Gentle step back to the subdominant',
    'Predominante prepara la dominante': 'Predominant sets up the dominant',
    'Subdominante prepara la dominante': 'Subdominant sets up the dominant', 'Semicadencia: abre tensión': 'Half cadence: opens tension',
    'Sale de la tónica a la subdominante': 'Leaves the tonic for the subdominant',
    'Avanza hacia la subdominante': 'Moves toward the subdominant', 'Prolonga la tónica con otro color': 'Extends the tonic with another colour',
    'El sustituto de tritono resuelve bajando un semitono': 'The tritone substitute resolves down a semitone',
    'Tritono compartido: resolución cromática': 'Shared tritone: chromatic resolution',
    'Vuelve a la tónica desde la nota característica': 'Returns to the tonic from the characteristic note',
    'Las voces se mueven muy poco': 'The voices barely move', 'Empieza en la tónica': 'Starts on the tonic',
    'Comienzo con color de tónica': 'Opens with tonic colour', 'Comienzo en suspenso': 'Opens in suspense',
    'Comienzo con tensión': 'Opens with tension', 'Comienzo modal': 'Modal opening',
    'Dominante secundaria': 'Secondary dominant', 'Sustituto de tritono': 'Tritone substitute',
    'Cambio de color, sin resolución marcada': 'Change of colour, no strong resolution',
    // Percusión
    Bombo: 'Kick', Tom: 'Tom', Caja: 'Snare', Palmas: 'Claps', Aro: 'Rim', Charles: 'Hi-hat', 'Charles abierto': 'Open hi-hat',
    Maraca: 'Shaker', Cencerro: 'Cowbell', Clave: 'Clave',
    Libre: 'Free', 'Con la melodía': 'With the melody', 'En sus huecos': 'In its gaps', 'Con los acordes': 'With the chords',
    'Tresillo cubano': 'Cuban tresillo', 'Cinquillo cubano': 'Cuban cinquillo', 'Bossa nova': 'Bossa nova',
    'Samba brasileña': 'Brazilian samba', 'África central y Brasil': 'Central Africa and Brazil',
    'Campana de África occidental': 'West African bell', 'Palmas venda, Sudáfrica': 'Venda clapping, South Africa',
    'Pigmeos aka': 'Aka Pygmies', 'Khafif-e-ramal persa': 'Persian khafif-e-ramal', 'Ruchenitza búlgara': 'Bulgarian ruchenitza',
    'Agsag-samai árabe': 'Arabic agsag-samai', 'Nawakhat árabe': 'Arabic nawakhat', 'Cumbia y calipso': 'Cumbia and calypso',
    'Samai yorubá': 'Yoruba samai', 'Outside Now, Frank Zappa': 'Outside Now, Frank Zappa',
    'Cuadros de una exposición': 'Pictures at an Exhibition',
    Rock: 'Rock', Funk: 'Funk', 'Swing de jazz': 'Jazz swing', 'Son cubano': 'Cuban son', Dembow: 'Dembow',
    'Bembé en 12': 'Bembé in 12', 'Bulería': 'Bulería', '3 contra 4': '3 against 4', '5 contra 4': '5 against 4',
    'Geometría prima': 'Prime geometry',
    // Ritmo de los acordes
    Redonda: 'Whole notes', Negras: 'Quarter notes', 'Charlestón': 'Charleston', Corcheas: 'Eighth notes',
  };
  const LOWER = new Map(Object.entries(DICT).map(([k, v]) => [k.toLowerCase(), v]));
  // También sin el paréntesis: «eólico» → «Aeolian».
  Object.entries(DICT).forEach(([k, v]) => {
    const bare = k.replace(/ \(.*\)$/, '');
    if (bare !== k) LOWER.set(bare.toLowerCase(), v.replace(/ \(.*\)$/, ''));
  });

  const scale = (s) => DICT[s] || LOWER.get(s.toLowerCase()) || s;

  // Textos con partes variables (notas, grados, nombres de escala).
  const PATTERNS = [
    [/^Resuelve su dominante secundaria \((.+)\)$/, (m, r) => `Resolves its secondary dominant (${r})`],
    [/^Tritono resuelto: (.+)$/, (m, r) => `Tritone resolved: ${r}`],
    [/^Lleva (.+), la nota que define el (.+)$/, (m, n, s) => `Contains ${n}, the note that defines ${scale(s)}`],
    [/^Notas comunes: (.+)$/, (m, r) => `Common tones: ${r}`],
    [/^Nota común: (.+)$/, (m, r) => `Common tone: ${r}`],
    [/^Sigue la progresión «(.+)»$/, (m, r) => `Follows the “${tr(r)}” progression`],
    [/^Prestado del (.+)$/, (m, s) => `Borrowed from ${scale(s)}`],
  ];

  function tr(s) {
    if (lang === 'es' || typeof s !== 'string') return s;
    if (DICT[s] !== undefined) return DICT[s];
    for (const [re, fn] of PATTERNS) {
      if (re.test(s)) return s.replace(re, fn);
    }
    return s;
  }

  const tx = (es, en) => (lang === 'en' ? en : es);

  globalThis.I18n = {
    get lang() { return lang; },
    set(l) { lang = l === 'en' ? 'en' : 'es'; },
    tr, tx,
    known: (s) => DICT[s] !== undefined,
    // Nombre de escala dentro de una frase: «dórico» en español, «Dorian» en inglés.
    scaleInText: (name) => (lang === 'en' ? scale(name) : name.toLowerCase()),
  };
})();
