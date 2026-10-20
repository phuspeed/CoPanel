#!/bin/bash
# CPU-without-AVX frontend toolchain: swap native esbuild/rollup for WASM builds.
# Does not download packages or run Vite.
# shellcheck disable=SC2034
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/install.sh"

FAILS=0

assert_eq() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        printf 'ok  %s\n' "$name"
    else
        printf 'FAIL %s\n  expected: [%s]\n  actual:   [%s]\n' "$name" "$expected" "$actual" >&2
        FAILS=$((FAILS + 1))
    fi
}

assert_true() {
    local name="$1"
    shift
    if "$@"; then
        printf 'ok  %s\n' "$name"
    else
        printf 'FAIL %s\n' "$name" >&2
        FAILS=$((FAILS + 1))
    fi
}

assert_false() {
    local name="$1"
    shift
    if "$@"; then
        printf 'FAIL %s (expected false)\n' "$name" >&2
        FAILS=$((FAILS + 1))
    else
        printf 'ok  %s\n' "$name"
    fi
}

unset COPANEL_FORCE_NO_AVX || true
if grep -q avx /proc/cpuinfo 2>/dev/null; then
    assert_true "this host reports AVX" copanel_cpu_has_avx
fi
COPANEL_FORCE_NO_AVX=1
assert_false "force flag hides AVX" copanel_cpu_has_avx
unset COPANEL_FORCE_NO_AVX || true

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
cd "$tmpdir"
mkdir -p scripts
cp "$ROOT/frontend/scripts/wasm-toolchain.mjs" scripts/wasm-toolchain.mjs
printf '%s\n' '{"name":"wasm-fixture","private":true}' > package.json

mkdir -p node_modules/esbuild node_modules/esbuild-wasm \
    node_modules/@esbuild/linux-x64 \
    node_modules/rollup node_modules/@rollup/wasm-node \
    node_modules/@rollup/rollup-linux-x64-gnu \
    node_modules/vite/node_modules/esbuild \
    node_modules/vite/node_modules/rollup

printf '%s\n' '{"name":"esbuild","version":"0.21.5"}' > node_modules/esbuild/package.json
printf '%s\n' '{"name":"esbuild-wasm","version":"0.21.5","main":"lib/main.js"}' > node_modules/esbuild-wasm/package.json
printf 'wasm\n' > node_modules/esbuild-wasm/esbuild.wasm
printf '%s\n' '{"name":"@esbuild/linux-x64"}' > node_modules/@esbuild/linux-x64/package.json
printf '%s\n' '{"name":"rollup","version":"4.60.2"}' > node_modules/rollup/package.json
printf '%s\n' '{"name":"@rollup/wasm-node","version":"4.60.2"}' > node_modules/@rollup/wasm-node/package.json
printf '%s\n' '{"name":"@rollup/rollup-linux-x64-gnu"}' > node_modules/@rollup/rollup-linux-x64-gnu/package.json
printf '%s\n' '{"name":"esbuild"}' > node_modules/vite/node_modules/esbuild/package.json
printf '%s\n' '{"name":"rollup"}' > node_modules/vite/node_modules/rollup/package.json

copanel_install_wasm_toolchain
assert_true "wasm toolchain replaces native packages" copanel_frontend_wasm_ready
assert_eq "nested esbuild is wasm" "esbuild-wasm" \
    "$(node -p "require('./node_modules/vite/node_modules/esbuild/package.json').name")"
assert_eq "nested rollup is wasm" "@rollup/wasm-node" \
    "$(node -p "require('./node_modules/vite/node_modules/rollup/package.json').name")"
assert_false "native @esbuild directory is gone" test -d node_modules/@esbuild
assert_false "native rollup optional package is gone" test -d node_modules/@rollup/rollup-linux-x64-gnu

prebuilt="$(mktemp -d)"
mkdir -p "$prebuilt/src/dist"
printf '%s\n' '<!doctype html><title>prebuilt</title>' > "$prebuilt/src/dist/index.html"
tar -C "$prebuilt/src" -czf "$prebuilt/dist.tar.gz" dist
(
    cd "$prebuilt/work" 2>/dev/null || mkdir -p "$prebuilt/work"
    cd "$prebuilt/work"
    COPANEL_PREBUILT_FRONTEND="$prebuilt/dist.tar.gz"
    copanel_use_prebuilt_frontend >/tmp/copanel-prebuilt-noavx.log
)
assert_true "prebuilt archive extracts index.html" test -f "$prebuilt/work/dist/index.html"
assert_eq "prebuilt index is the archive copy" "<!doctype html><title>prebuilt</title>" \
    "$(cat "$prebuilt/work/dist/index.html")"
rm -rf "$prebuilt"

if [[ "$FAILS" -eq 0 ]]; then
    printf 'no-avx installer checks passed\n'
else
    printf '%s check(s) failed\n' "$FAILS" >&2
    exit 1
fi
