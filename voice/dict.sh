#!/bin/sh
# Incrusta el diccionario de pronunciación inglesa (CMUdict, licencia en
# voice/CMUDICT-LICENSE) en js/cmudict.js, comprimido, desde la misma versión de
# CHIMERA que usa voice/Cargo.toml.
set -e
cd "$(dirname "$0")"
REV=1d3ea496cad0fbe3e73361515aec187e868fbd47
URL="https://raw.githubusercontent.com/jamesondh/chimera-vocal-synth/$REV/public/data"
curl -fsSL "$URL/cmudict.txt.gz" -o /tmp/enlace-cmudict.txt.gz
curl -fsSL "$URL/CMUDICT-LICENSE.txt" -o CMUDICT-LICENSE
python3 - <<'PY'
import base64
gz = open('/tmp/enlace-cmudict.txt.gz', 'rb').read()
with open('../js/cmudict.js', 'w') as f:
    f.write('// Generado por voice/dict.sh: CMU Pronouncing Dictionary (voice/CMUDICT-LICENSE), gzip en base64.\n')
    f.write('globalThis.CMUDICT_GZ = "' + base64.b64encode(gz).decode() + '";\n')
print(f'js/cmudict.js: {len(gz)} bytes comprimidos')
PY
