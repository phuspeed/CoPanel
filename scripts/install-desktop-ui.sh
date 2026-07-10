#!/bin/bash

###############################################################################
# CoPanel Desktop UI — installer (unified codebase on branch main or DesktopUI)
#
# Same CoPanel repo: classic + desktop shell in one tree. This script sets
# COPANEL_UI_TRACK=desktop and checks out DesktopUI until merge to main completes.
# After unification, use: COPANEL_UI_TRACK=desktop sudo bash scripts/install.sh
#
# One-liner:
#   curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
#     "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install-desktop-ui.sh?ref=DesktopUI" | sudo bash
#
# Local (from cloned repo):
#   sudo bash scripts/install-desktop-ui.sh
#
# Override branch:
#   COPANEL_GIT_BRANCH=DesktopUI sudo bash install-desktop-ui.sh
###############################################################################

set -e

export COPANEL_GIT_BRANCH="${COPANEL_GIT_BRANCH:-DesktopUI}"
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
    exec bash "$SCRIPT_DIR/install.sh" "$@"
fi

# Piped from curl — fetch install.sh from the DesktopUI branch
TMP_INSTALL="$(mktemp)"
trap 'rm -f "$TMP_INSTALL"' EXIT

if ! curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
    "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install.sh?ref=${COPANEL_GIT_BRANCH}" \
    -o "$TMP_INSTALL"; then
    echo "Error: could not download install.sh (branch ${COPANEL_GIT_BRANCH})." >&2
    echo "Try: sudo apt install -y git && sudo git clone -b DesktopUI https://github.com/phuspeed/CoPanel.git /opt/copanel" >&2
    exit 1
fi

exec bash "$TMP_INSTALL" "$@"
