#!/bin/bash

###############################################################################
# CoPanel Desktop UI install — alias for install.sh --desktop
#
# Prefer the unified installer:
#   sudo bash scripts/install.sh --desktop
#
# One-liner:
#   curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
#     "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install.sh?ref=main" \
#     | sudo bash -s -- --desktop
###############################################################################

set -e

export COPANEL_GIT_BRANCH="${COPANEL_GIT_BRANCH:-main}"
export COPANEL_UI_TRACK="${COPANEL_UI_TRACK:-desktop}"

_resolve_script_dir() {
    local src="${BASH_SOURCE[0]}"
    while [[ -L "$src" ]]; do
        local dir
        dir="$(cd "$(dirname "$src")" && pwd)"
        src="$(readlink "$src")"
        [[ "$src" != /* ]] && src="$dir/$src"
    done
    cd "$(dirname "$src")" && pwd
}

SCRIPT_DIR="$(_resolve_script_dir 2>/dev/null || true)"

if [[ -n "$SCRIPT_DIR" ]] && [[ -f "$SCRIPT_DIR/install.sh" ]]; then
    exec bash "$SCRIPT_DIR/install.sh" --desktop "$@"
fi

TMP_INSTALL="$(mktemp)"
trap 'rm -f "$TMP_INSTALL"' EXIT

if ! curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
    "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install.sh?ref=${COPANEL_GIT_BRANCH}" \
    -o "$TMP_INSTALL"; then
    echo "Error: could not download install.sh (branch ${COPANEL_GIT_BRANCH})." >&2
    exit 1
fi

exec bash "$TMP_INSTALL" --desktop "$@"
