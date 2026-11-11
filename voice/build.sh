#!/bin/sh
# Compila la voz (voice/) y la incrusta en js/voz-wasm.js, para que la app siga
# abriéndose con doble clic, sin servidor. Necesita Rust con el destino wasm32:
#   rustup target add wasm32-unknown-unknown
set -e
cd "$(dirname "$0")"
PATH="$HOME/.cargo/bin:$PATH" cargo build --release --target wasm32-unknown-unknown
python3 - <<'PY'
import base64
wasm = open('target/wasm32-unknown-unknown/release/enlace_voz.wasm', 'rb').read()
with open('../js/voz-wasm.js', 'w') as f:
    f.write('// Generado por voice/build.sh: el motor de voz CHIMERA (licencia MIT, voice/CHIMERA-LICENSE)\n')
    f.write('// compilado a WebAssembly. No editar a mano.\n')
    f.write('globalThis.VOZ_WASM = "' + base64.b64encode(wasm).decode() + '";\n')
print(f'js/voz-wasm.js: {len(wasm)} bytes de wasm')
PY
