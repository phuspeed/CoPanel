#!/bin/bash

###############################################################################
# CoPanel Installation Script
# One-click setup for Linux VPS Management Panel
# 
# Usage:
#   sudo bash install.sh              # interactive: choose Web UI or Desktop UI
#   sudo bash install.sh --classic    # Web UI (sidebar)
#   sudo bash install.sh --desktop    # Desktop UI (dock + windows)
#   COPANEL_UI_TRACK=desktop sudo bash install.sh
#
# One-liner (curl):
#   curl -fsSL https://copanel.io.vn/install.sh | sudo bash
#   curl -fsSL https://copanel.io.vn/install.sh | sudo bash -s -- --desktop
# Alternate (GitHub raw):
#   curl -fsSL https://raw.githubusercontent.com/phuspeed/CoPanel/main/scripts/install.sh | sudo bash
# 
# Features:
# - Python virtual environment setup
# - Nginx reverse proxy configuration (port 8686)
# - Systemd service installation
# - Sparse git checkout (runtime paths only; skips README/.md/website)
# - Idempotent (safe to run multiple times)
# - Low-RAM hosts (<=2 GB, including Oracle Cloud free tier): 2 GB swap + Node heap cap
# - Firewall: UFW plus iptables/ip6tables for 8686/80/443 (Oracle INPUT REJECT)
# - Alma/RHEL/Rocky: conf.d nginx site, dnf package names, Rocky Docker CE repo
###############################################################################

set -e  # Exit on error
set -o pipefail

# Premium Aesthetic Color Palette
BOLD=$(echo -e '\033[1m')
CYAN=$(echo -e '\033[0;36m')
GREEN=$(echo -e '\033[1;32m')
YELLOW=$(echo -e '\033[1;33m')
RED=$(echo -e '\033[1;31m')
BLUE=$(echo -e '\033[1;34m')
PURPLE=$(echo -e '\033[1;35m')
NC=$(echo -e '\033[0m')

# Configuration
CoPanel_USER="copanel"
CoPanel_HOME="/opt/copanel"
COPANEL_GIT_BRANCH="${COPANEL_GIT_BRANCH:-main}"
COPANEL_GIT_REMOTE="${COPANEL_GIT_REMOTE:-https://github.com/phuspeed/CoPanel.git}"
VENV_PATH="$CoPanel_HOME/venv"
BACKEND_PORT=8000
FRONTEND_PORT=5173
NGINX_PORT=8686
NGINX_CONF="/etc/nginx/sites-available/copanel"
NGINX_ENABLED="/etc/nginx/sites-enabled/copanel"

###############################################################################
# Helper Functions
###############################################################################

log_info() {
    echo -e " ${BLUE}➜${NC} $1"
}

log_success() {
    echo -e " ${GREEN}✔${NC} ${BOLD}$1${NC}"
}

log_warning() {
    echo -e " ${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e " ${RED}✖${NC} ${BOLD}$1${NC}"
}

log_step() {
    echo -e "\n ${PURPLE}●${NC} ${BOLD}$1${NC}"
    echo -e "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# -----------------------------------------------------------------------------
# Panel version for banner / summary (no hardcoded semver).
#
# Collect candidates (checkout, /opt/copanel, GitHub main, git tags) and pick
# the newest with ``sort -V``. This avoids curl/upgrade banners stuck on a
# stale ``/opt/copanel/VERSION`` before ``git pull`` finishes.
# -----------------------------------------------------------------------------
copanel_read_version_file() {
    local f="$1"
    [[ -f "$f" ]] || return 1
    local line
    line="$(grep -v '^[[:space:]]*#' "$f" 2>/dev/null | head -1 | tr -d '\r')"
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -n "$line" ]] || return 1
    printf '%s' "$line"
}

copanel_git_version_nearest_tag() {
    local dir="$1"
    [[ -d "$dir/.git" ]] || return 1
    local t
    t="$(git -C "$dir" describe --tags --match 'v*' --abbrev=0 2>/dev/null)"
    [[ -n "$t" ]] || return 1
    t="${t#v}"
    printf '%s' "$t"
}

copanel_git_version_describe() {
    local dir="$1"
    [[ -d "$dir/.git" ]] || return 1
    local t
    # Prefer an exact tag on HEAD (e.g. v1.1.2); avoid dirty describe strings for the banner.
    t="$(git -C "$dir" describe --tags --match 'v*' --exact-match 2>/dev/null)" || t=""
    if [[ -z "$t" ]]; then
        t="$(git -C "$dir" describe --tags --match 'v*' --abbrev=0 2>/dev/null)" || t=""
    fi
    [[ -n "$t" ]] || return 1
    t="${t#v}"
    printf '%s' "$t"
}

copanel_fetch_github_version() {
    local api_url="https://api.github.com/repos/phuspeed/CoPanel/contents/VERSION?ref=main"
    local raw_url="${COPANEL_VERSION_URL:-https://raw.githubusercontent.com/phuspeed/CoPanel/main/VERSION}"
    local releases_url="https://api.github.com/repos/phuspeed/CoPanel/releases/latest"
    local raw=""
    if command -v curl &>/dev/null; then
        raw="$(curl -fsSL --max-time 12 -H "Accept: application/vnd.github.v3.raw" "$api_url" 2>/dev/null || true)"
        [[ -n "$raw" ]] || raw="$(curl -fsSL --max-time 12 "$raw_url" 2>/dev/null || true)"
        if [[ -z "$raw" ]]; then
            raw="$(curl -fsSL --max-time 12 -H "Accept: application/vnd.github+json" "$releases_url" 2>/dev/null \
                | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\?\([^"]*\)".*/\1/p' | head -1 || true)"
        fi
    elif command -v wget &>/dev/null; then
        raw="$(wget -qO- --timeout=12 --header="Accept: application/vnd.github.v3.raw" "$api_url" 2>/dev/null || true)"
        [[ -n "$raw" ]] || raw="$(wget -qO- --timeout=12 "$raw_url" 2>/dev/null || true)"
    fi
    [[ -n "$raw" ]] || return 1
    local line
    line="$(printf '%s' "$raw" | grep -v '^[[:space:]]*#' | head -1 | tr -d '\r')"
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -n "$line" ]] || return 1
    printf '%s' "$line"
}

# Keep only plain semver-ish tokens for sort -V (drop describe junk like 1.1.2-3-gabc).
copanel_normalize_semver_candidate() {
    local s="${1#v}"
    s="${s%%-*}"
    s="${s%%+*}"
    [[ "$s" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]] || return 1
    printf '%s' "$s"
}

copanel_pick_newest_version() {
    local newest=""
    local c n
    for c in "$@"; do
        [[ -n "$c" ]] || continue
        n="$(copanel_normalize_semver_candidate "$c" || true)"
        [[ -n "$n" ]] || continue
        if [[ -z "$newest" ]]; then
            newest="$n"
            continue
        fi
        if printf '%s\n' "$newest" "$n" | sort -V | tail -1 | grep -qx "$n"; then
            newest="$n"
        fi
    done
    [[ -n "$newest" ]] || return 1
    printf '%s' "$newest"
}

copanel_resolve_panel_version() {
    local script_dir="" repo_dir="" v=""
    local c_repo="" c_home="" c_gh="" c_tag=""
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || script_dir=""
    if [[ -n "$script_dir" ]]; then
        repo_dir="$(dirname "$script_dir")"
    fi

    if [[ -n "$repo_dir" ]]; then
        c_repo="$(copanel_read_version_file "$repo_dir/VERSION" || true)"
        c_tag="$(copanel_git_version_describe "$repo_dir" || true)"
    fi
    c_home="$(copanel_read_version_file "${CoPanel_HOME:-/opt/copanel}/VERSION" || true)"
    [[ -n "$c_tag" ]] || c_tag="$(copanel_git_version_describe "${CoPanel_HOME:-/opt/copanel}" || true)"
    c_gh="$(copanel_fetch_github_version || true)"

    v="$(copanel_pick_newest_version "$c_gh" "$c_repo" "$c_home" "$c_tag" || true)"

    if [[ -z "$v" ]]; then
        v="1.0.0"
    fi
    v="${v#v}"
    printf '%s' "$v"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        log_error "Unable to detect OS"
        exit 1
    fi
    
    . /etc/os-release
    log_info "Detected OS: $ID $VERSION_ID"

    # Check for unsupported CentOS 7 EOL
    if [[ "$ID" == "centos" && "$VERSION_ID" == "7" ]] || [[ "$ID" == "centos" && "$VERSION" =~ ^7 ]]; then
        log_error "CentOS 7 reached End-of-Life (EOL) and is no longer supported by CoPanel. Please use a modern Linux distribution (Ubuntu 20+, Debian 11+, Rocky Linux 8+, AlmaLinux 8+)."
        exit 1
    fi
}

copanel_install_usage() {
    cat <<EOF
CoPanel install.sh — unified installer (Web UI + Desktop UI on branch main)

Usage:
  sudo bash install.sh                 Interactive UI choice
  sudo bash install.sh --classic       Web UI (sidebar, default for curl pipe)
  sudo bash install.sh --webui         Alias for --classic
  sudo bash install.sh --desktop       Desktop UI (dock + floating windows)

Environment:
  COPANEL_UI_TRACK=classic|desktop     Skip prompt
  COPANEL_NONINTERACTIVE=1             Non-interactive (default UI: classic)
  COPANEL_GIT_BRANCH=main              Git branch to clone/update
  COPANEL_LOW_MEM_MB=2048              RAM at or below this (MB) is low-memory
  COPANEL_SWAP_SIZE_MB=2048            Swap file created on low-memory hosts
  COPANEL_NODE_HEAP_MB=1536            Node --max-old-space-size on those hosts
  COPANEL_SKIP_SWAP=1                  Do not create /swapfile
  COPANEL_SKIP_NODE_HEAP=1             Do not set NODE_OPTIONS

One-liner:
  curl -fsSL https://copanel.io.vn/install.sh | sudo bash
  curl -fsSL https://copanel.io.vn/install.sh | sudo bash -s -- --desktop
EOF
}

copanel_parse_install_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --desktop|-d)
                export COPANEL_UI_TRACK=desktop
                shift
                ;;
            --classic|--webui|-w)
                export COPANEL_UI_TRACK=classic
                shift
                ;;
            --help|-h)
                copanel_install_usage
                exit 0
                ;;
            *)
                log_warning "Unknown option: $1 (see --help)"
                shift
                ;;
        esac
    done
}

copanel_prompt_ui_mode() {
    if [[ -n "${COPANEL_UI_TRACK:-}" ]]; then
        return 0
    fi
    if [[ -f "$CoPanel_HOME/config/ui_track" ]]; then
        COPANEL_UI_TRACK="$(tr -d ' \t\r\n' < "$CoPanel_HOME/config/ui_track")"
        export COPANEL_UI_TRACK
        log_info "Keeping existing UI track: ${COPANEL_UI_TRACK} ($(copanel_ui_track_label))"
        return 0
    fi
    if [[ -n "${COPANEL_NONINTERACTIVE:-}" ]]; then
        export COPANEL_UI_TRACK=classic
        return 0
    fi
    if [[ ! -t 0 ]]; then
        export COPANEL_UI_TRACK=classic
        log_info "Non-TTY install — default UI: Web UI (classic). Use: ... | sudo bash -s -- --desktop"
        return 0
    fi

    echo ""
    echo -e "   ${CYAN}${BOLD}Choose panel interface:${NC}"
    echo -e "   ${BOLD}1)${NC} Web UI — classic sidebar ${GREEN}(recommended)${NC}"
    echo -e "   ${BOLD}2)${NC} Desktop UI — dock + floating windows"
    echo ""
    local choice=""
    read -r -p "   Enter 1 or 2 [1]: " choice
    choice="${choice:-1}"
    case "$choice" in
        2|desktop|Desktop|d|D)
            export COPANEL_UI_TRACK=desktop
            ;;
        *)
            export COPANEL_UI_TRACK=classic
            ;;
    esac
    log_info "Selected: ${COPANEL_UI_TRACK} UI"
}

copanel_ui_track_label() {
    if [[ "${COPANEL_UI_TRACK:-classic}" == "desktop" ]]; then
        printf 'Desktop UI'
    else
        printf 'Web UI (classic)'
    fi
}

command_exists() {
    command -v "$1" &> /dev/null
}

###############################################################################
# Low-RAM hosts (Oracle Cloud free tier is 1 GB) cannot finish `npm run build`
# unless swap exists and Node's heap is capped. Oracle Ubuntu also leaves UFW
# inactive and REJECTs new INPUT in iptables, so :8686 stays closed.
###############################################################################

copanel_mem_total_mb() {
    if [[ -n "${COPANEL_MEM_TOTAL_MB:-}" ]]; then
        printf '%s' "$COPANEL_MEM_TOTAL_MB"
        return 0
    fi
    awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || printf '0'
}

copanel_swap_total_mb() {
    if [[ -n "${COPANEL_SWAP_TOTAL_MB:-}" ]]; then
        printf '%s' "$COPANEL_SWAP_TOTAL_MB"
        return 0
    fi
    awk '/^SwapTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || printf '0'
}

copanel_root_free_mb() {
    if [[ -n "${COPANEL_DISK_FREE_MB:-}" ]]; then
        printf '%s' "$COPANEL_DISK_FREE_MB"
        return 0
    fi
    df -BM --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9'
}

# Unknown / unreadable memory is not treated as low, so a missing meminfo
# does not create a swap file.
copanel_is_low_memory() {
    local mb
    mb="$(copanel_mem_total_mb)"
    [[ "$mb" =~ ^[0-9]+$ ]] || return 1
    [[ "$mb" -gt 0 ]] || return 1
    [[ "$mb" -le "${COPANEL_LOW_MEM_MB:-2048}" ]]
}

copanel_is_oracle_cloud() {
    if [[ "${COPANEL_FORCE_ORACLE:-}" == "1" ]]; then
        return 0
    fi
    if [[ "${COPANEL_FORCE_ORACLE:-}" == "0" ]]; then
        return 1
    fi
    if [[ -d /usr/lib/oracle-cloud-agent || -d /etc/oracle-cloud-agent || -d /var/lib/oracle-cloud-agent ]]; then
        return 0
    fi
    local f blob=""
    for f in /sys/class/dmi/id/sys_vendor \
             /sys/class/dmi/id/chassis_asset_tag \
             /sys/class/dmi/id/bios_vendor \
             /sys/class/dmi/id/product_name; do
        [[ -r "$f" ]] || continue
        blob+=" $(<"$f")"
    done
    grep -qi 'oracle' <<<"$blob"
}

# fallocate on some filesystems leaves a sparse file; swapon rejects holes.
copanel_swapfile_is_sparse() {
    local path="$1"
    local size blocks
    size="$(stat -c %s "$path" 2>/dev/null || echo 0)"
    blocks="$(stat -c %b "$path" 2>/dev/null || echo 0)"
    [[ "$size" =~ ^[0-9]+$ && "$blocks" =~ ^[0-9]+$ ]] || return 1
    [[ "$size" -gt 0 ]] || return 1
    [[ $((blocks * 512)) -lt "$size" ]]
}

# skip-disabled | skip-enough | skip-nospace | activate | create
copanel_swap_plan() {
    if [[ "${COPANEL_SKIP_SWAP:-}" == "1" ]]; then
        printf 'skip-disabled'
        return 0
    fi
    local target current swapfile free_mb
    target="${COPANEL_SWAP_SIZE_MB:-2048}"
    [[ "$target" =~ ^[0-9]+$ ]] || target=2048
    current="$(copanel_swap_total_mb)"
    current="${current:-0}"
    if [[ "$current" =~ ^[0-9]+$ && "$current" -ge "$target" ]]; then
        printf 'skip-enough'
        return 0
    fi
    swapfile="${COPANEL_SWAPFILE:-/swapfile}"
    if [[ -e "$swapfile" ]]; then
        printf 'activate'
        return 0
    fi
    free_mb="$(copanel_root_free_mb)"
    if [[ -n "$free_mb" && "$free_mb" =~ ^[0-9]+$ && "$free_mb" -lt $((target + 256)) ]]; then
        printf 'skip-nospace'
        return 0
    fi
    printf 'create'
}

copanel_persist_swap_fstab() {
    local swapfile="$1"
    local fstab="${2:-${COPANEL_FSTAB_FILE:-/etc/fstab}}"
    if [[ ! -f "$fstab" ]]; then
        log_warning "No $fstab — swap will not come back after reboot"
        return 0
    fi
    if awk -v p="$swapfile" '$1 == p { found = 1 } END { exit !found }' "$fstab"; then
        return 0
    fi
    printf '%s\n' "$swapfile swap swap defaults 0 0" >> "$fstab"
}

copanel_write_swapfile() {
    local path="$1"
    local mb="$2"
    local wrote=0
    rm -f "$path"
    if command -v fallocate >/dev/null 2>&1; then
        if fallocate -l "${mb}M" "$path" 2>/dev/null && ! copanel_swapfile_is_sparse "$path"; then
            wrote=1
        else
            rm -f "$path"
        fi
    fi
    if [[ "$wrote" -ne 1 ]]; then
        if ! dd if=/dev/zero of="$path" bs=1M count="$mb" status=none 2>/dev/null; then
            dd if=/dev/zero of="$path" bs=1M count="$mb"
        fi
    fi
    chmod 600 "$path"
    mkswap "$path" >/dev/null
}

copanel_ensure_swap() {
    local plan swapfile target err
    plan="$(copanel_swap_plan)"
    swapfile="${COPANEL_SWAPFILE:-/swapfile}"
    target="${COPANEL_SWAP_SIZE_MB:-2048}"
    case "$plan" in
        skip-disabled)
            log_info "COPANEL_SKIP_SWAP=1 — leaving swap unchanged"
            ;;
        skip-enough)
            log_info "Swap already $(copanel_swap_total_mb) MB (>= ${target} MB)"
            ;;
        skip-nospace)
            log_warning "Not enough free disk ($(copanel_root_free_mb) MB) to add ${target} MB swap. The frontend build may be killed."
            ;;
        activate)
            log_info "Enabling existing swapfile $swapfile"
            chmod 600 "$swapfile" || true
            err="$(swapon "$swapfile" 2>&1)" || true
            if swapon --show=NAME --noheadings 2>/dev/null | grep -Fxq "$swapfile"; then
                copanel_persist_swap_fstab "$swapfile"
                log_success "Swap enabled ($swapfile)"
            else
                log_warning "Could not enable $swapfile${err:+: $err}"
            fi
            ;;
        create)
            log_info "Creating ${target} MB swap at $swapfile"
            if copanel_write_swapfile "$swapfile" "$target" && swapon "$swapfile"; then
                copanel_persist_swap_fstab "$swapfile"
                log_success "Swap enabled (${target} MB) and saved in fstab"
            else
                log_warning "Could not create swap at $swapfile. The frontend build may run out of memory."
                swapoff "$swapfile" 2>/dev/null || true
                rm -f "$swapfile"
            fi
            ;;
        *)
            log_warning "Unknown swap plan: $plan"
            ;;
    esac
}

# /etc/environment is KEY=VALUE for pam_env. A line that starts with `export`
# is not applied on login or sudo.
copanel_persist_node_options() {
    local heap="$1"
    local envfile="${2:-${COPANEL_ENVIRONMENT_FILE:-/etc/environment}}"
    local desired mode tmp
    [[ "$heap" =~ ^[0-9]+$ ]] || return 0
    desired="NODE_OPTIONS=\"--max-old-space-size=${heap}\""
    if [[ ! -e "$envfile" ]]; then
        if ! touch "$envfile" 2>/dev/null; then
            log_warning "Cannot write $envfile; Node heap applies to this install only"
            return 0
        fi
    elif [[ ! -w "$envfile" ]]; then
        log_warning "Cannot update $envfile; Node heap applies to this install only"
        return 0
    fi
    mode="$(stat -c %a "$envfile" 2>/dev/null || echo 644)"
    if grep -qE '^[[:space:]]*export[[:space:]]+NODE_OPTIONS=' "$envfile"; then
        tmp="$(mktemp)"
        grep -vE '^[[:space:]]*export[[:space:]]+NODE_OPTIONS=' "$envfile" > "$tmp" || true
        cat "$tmp" > "$envfile"
        rm -f "$tmp"
        chmod "$mode" "$envfile" || true
    fi
    if grep -qE '^[[:space:]]*NODE_OPTIONS=' "$envfile"; then
        return 0
    fi
    printf '%s\n' "$desired" >> "$envfile"
}

copanel_ensure_node_heap() {
    local heap envfile
    if [[ "${COPANEL_SKIP_NODE_HEAP:-}" == "1" ]]; then
        return 0
    fi
    if ! copanel_is_low_memory; then
        return 0
    fi
    heap="${COPANEL_NODE_HEAP_MB:-1536}"
    if [[ -z "${NODE_OPTIONS:-}" ]]; then
        export NODE_OPTIONS="--max-old-space-size=${heap}"
        log_info "NODE_OPTIONS=${NODE_OPTIONS} (Node heap cap for <=${COPANEL_LOW_MEM_MB:-2048} MB RAM)"
    elif [[ "${NODE_OPTIONS}" =~ max-old-space-size=([0-9]+) ]]; then
        heap="${BASH_REMATCH[1]}"
    else
        export NODE_OPTIONS="${NODE_OPTIONS} --max-old-space-size=${heap}"
        log_info "NODE_OPTIONS=${NODE_OPTIONS}"
    fi
    envfile="${COPANEL_ENVIRONMENT_FILE:-/etc/environment}"
    copanel_persist_node_options "$heap" "$envfile"
}

prepare_low_memory_host() {
    local mem swap
    mem="$(copanel_mem_total_mb)"
    swap="$(copanel_swap_total_mb)"
    log_info "Host memory: ${mem:-unknown} MB RAM, ${swap:-0} MB swap"
    if ! copanel_is_low_memory; then
        return 0
    fi
    COPANEL_LOWMEM_ACTIVE=1
    log_warning "Low RAM (${mem} MB). Adding swap and capping the Node.js heap so the frontend build can finish."
    copanel_ensure_swap
    copanel_ensure_node_heap
    if [[ -z "${VITE_BUILD_LOW_MEMORY:-}" ]]; then
        export VITE_BUILD_LOW_MEMORY=1
    fi
}

copanel_ufw_bin() {
    if [[ -n "${COPANEL_UFW_BIN:-}" ]]; then
        printf '%s' "$COPANEL_UFW_BIN"
        return 0
    fi
    if command -v ufw >/dev/null 2>&1; then
        command -v ufw
        return 0
    fi
    if [[ -x /usr/sbin/ufw ]]; then
        printf '%s' /usr/sbin/ufw
        return 0
    fi
    return 1
}

copanel_iptables_bin() {
    local override="$1"
    local fallback="$2"
    if [[ -n "$override" ]]; then
        printf '%s' "$override"
        return 0
    fi
    if command -v "$fallback" >/dev/null 2>&1; then
        command -v "$fallback"
        return 0
    fi
    if [[ -x "/usr/sbin/${fallback}" ]]; then
        printf '%s' "/usr/sbin/${fallback}"
        return 0
    fi
    if [[ -x "/sbin/${fallback}" ]]; then
        printf '%s' "/sbin/${fallback}"
        return 0
    fi
    return 1
}

copanel_iptables_allow_dport() {
    local bin="$1"
    local port="$2"
    if [[ ! -x "$bin" ]] && ! command -v "$bin" >/dev/null 2>&1; then
        return 0
    fi
    if "$bin" -C INPUT -p tcp --dport "$port" -j ACCEPT >/dev/null 2>&1; then
        return 0
    fi
    if ! "$bin" -I INPUT -p tcp --dport "$port" -j ACCEPT >/dev/null 2>&1; then
        log_warning "Could not open tcp/${port} via $(basename "$bin")"
    fi
}

# Insert an ACCEPT before Oracle's catch-all INPUT REJECT, and before COMMIT
# so the line stays inside the filter table. A full `iptables-save` is avoided
# once Docker is running, because that would persist Docker's chains.
copanel_insert_iptables_dport() {
    local file="$1"
    local port="$2"
    local rule tmp
    [[ -f "$file" ]] || return 1
    if grep -E -q -- "--dport ${port}([^0-9]|\$).*-j ACCEPT" "$file"; then
        return 0
    fi
    rule="-A INPUT -p tcp -m tcp --dport ${port} -j ACCEPT"
    tmp="$(mktemp)"
    awk -v rule="$rule" '
        !inserted && ($0 ~ /^(-A INPUT ).*(-j REJECT|-j DROP)/ || $0 ~ /^COMMIT[[:space:]]*$/) {
            print rule
            inserted = 1
        }
        { print }
        END {
            if (!inserted) print rule
        }
    ' "$file" > "$tmp"
    cat "$tmp" > "$file"
    rm -f "$tmp"
}

copanel_persist_iptables() {
    local v4 v6 port patched=0 persist=""
    if [[ "${COPANEL_SKIP_FIREWALL_PERSIST:-}" == "1" ]]; then
        return 0
    fi
    v4="${COPANEL_IPTABLES_RULES_V4:-/etc/iptables/rules.v4}"
    v6="${COPANEL_IPTABLES_RULES_V6:-/etc/iptables/rules.v6}"
    for port in 8686 80 443; do
        if [[ -f "$v4" ]]; then
            copanel_insert_iptables_dport "$v4" "$port" || true
            patched=1
        fi
        if [[ -f "$v6" ]]; then
            copanel_insert_iptables_dport "$v6" "$port" || true
            patched=1
        fi
    done
    if [[ "$patched" -eq 1 ]]; then
        log_success "Firewall allow rules saved for reboot (8686, 80, 443)"
        return 0
    fi
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet docker; then
        log_info "iptables allows 8686, 80, 443 until reboot. No /etc/iptables rules file to update."
        return 0
    fi
    if command -v netfilter-persistent >/dev/null 2>&1; then
        persist="$(command -v netfilter-persistent)"
    elif [[ -x /usr/sbin/netfilter-persistent ]]; then
        persist=/usr/sbin/netfilter-persistent
    elif [[ -x /sbin/netfilter-persistent ]]; then
        persist=/sbin/netfilter-persistent
    elif copanel_is_oracle_cloud && command -v apt-get >/dev/null 2>&1; then
        log_info "Installing iptables-persistent so Oracle firewall rules survive reboot..."
        echo 'iptables-persistent iptables-persistent/autosave_v4 boolean true' | debconf-set-selections || true
        echo 'iptables-persistent iptables-persistent/autosave_v6 boolean true' | debconf-set-selections || true
        DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent || \
            log_warning "iptables-persistent install failed; rules may reset on reboot"
        if command -v netfilter-persistent >/dev/null 2>&1; then
            persist="$(command -v netfilter-persistent)"
        elif [[ -x /usr/sbin/netfilter-persistent ]]; then
            persist=/usr/sbin/netfilter-persistent
        fi
    fi
    if [[ -n "$persist" ]]; then
        if "$persist" save; then
            log_success "iptables rules saved (netfilter-persistent)"
        else
            log_warning "netfilter-persistent save failed; rules may reset on reboot"
        fi
        return 0
    fi
    log_info "iptables allows 8686, 80, 443 for this boot."
}

copanel_configure_firewalld() {
    local port
    if [[ "${COPANEL_SKIP_FIREWALLD:-}" == "1" ]]; then
        return 0
    fi
    command -v firewall-cmd >/dev/null 2>&1 || return 0
    if ! command -v systemctl >/dev/null 2>&1 || ! systemctl is-active --quiet firewalld; then
        return 0
    fi
    for port in 8686 80 443 22; do
        firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null 2>&1 || \
            log_warning "firewalld could not allow ${port}/tcp"
    done
    firewall-cmd --reload >/dev/null 2>&1 || true
    log_success "firewalld allows 8686, 80, 443"
}

copanel_firewalld_active() {
    if [[ "${COPANEL_ASSUME_FIREWALLD:-}" == "1" ]]; then
        return 0
    fi
    if [[ "${COPANEL_ASSUME_FIREWALLD:-}" == "0" ]]; then
        return 1
    fi
    command -v firewall-cmd >/dev/null 2>&1 || return 1
    command -v systemctl >/dev/null 2>&1 || return 1
    systemctl is-active --quiet firewalld
}

copanel_configure_firewall() {
    # Alma/RHEL use firewalld. Raw iptables inserts fight that backend.
    if copanel_firewalld_active; then
        copanel_configure_firewalld
        return 0
    fi

    local ufw_bin="" iptables_bin="" ip6tables_bin="" port
    if ufw_bin="$(copanel_ufw_bin)"; then
        log_info "Allowing CoPanel ports in UFW..."
        for port in 8686 8000 22 80 443; do
            "$ufw_bin" allow "${port}/tcp" >/dev/null 2>&1 || "$ufw_bin" allow "${port}/tcp" || true
        done
        "$ufw_bin" reload >/dev/null 2>&1 || true
        log_success "UFW allows 8686, 80, 443 (and 22, 8000)"
    fi

    if iptables_bin="$(copanel_iptables_bin "${COPANEL_IPTABLES_BIN:-}" iptables)"; then
        log_info "Opening 8686, 80, 443 on iptables (Oracle Cloud rejects these when UFW is off)..."
        for port in 8686 80 443; do
            copanel_iptables_allow_dport "$iptables_bin" "$port"
        done
    fi
    if ip6tables_bin="$(copanel_iptables_bin "${COPANEL_IP6TABLES_BIN:-}" ip6tables)"; then
        if "$ip6tables_bin" -L INPUT >/dev/null 2>&1; then
            for port in 8686 80 443; do
                copanel_iptables_allow_dport "$ip6tables_bin" "$port"
            done
        fi
    fi
    if [[ -n "$iptables_bin" ]]; then
        copanel_persist_iptables
    fi
    copanel_configure_firewalld
}

# -----------------------------------------------------------------------------
# APT: avoid hanging forever on ppa.launchpadcontent.net (slow/failed TLS, firewalls).
# - Short Acquire timeouts via apt.conf.d (applies to all apt in this install step)
# - GNU timeout(1) caps total apt-get update wall time
# - Disable Ondrej PHP PPA first, then any remaining Launchpad PPA files
# Ubuntu 22.04+ ship php-fpm in main/universe; Launchpad PPAs are optional for CoPanel.
# -----------------------------------------------------------------------------

COPANEL_APT_TIMEOUT_CONF="/etc/apt/apt.conf.d/99-copanel-install-timeouts"

copanel_write_apt_timeouts() {
    cat > "$COPANEL_APT_TIMEOUT_CONF" <<'EOF'
// CoPanel install: do not hang indefinitely on unreachable mirrors
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
Acquire::ftp::Timeout "20";
Acquire::Retries "2";
EOF
}

copanel_remove_apt_timeouts() {
    rm -f "$COPANEL_APT_TIMEOUT_CONF"
}

apt_get_update_timed() {
    # Exit 124 = GNU timeout — treat as failure and run recovery
    if command_exists timeout; then
        timeout 240 apt-get update
        return $?
    fi
    apt-get update
    return $?
}

disable_ondrej_php_launchpad_sources() {
    local disabled_any=false
    shopt -s nullglob
    for ppa_f in /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
        [[ -f "$ppa_f" ]] || continue
        case "$ppa_f" in *.copanel-bak) continue ;; esac
        if grep -q 'ondrej/php' "$ppa_f" 2>/dev/null && grep -qE 'ppa\.launchpad(content)?\.net|ppa\.launchpad\.net' "$ppa_f" 2>/dev/null; then
            log_warning "Temporarily disabling $(basename "$ppa_f") (Ondrej PHP / Launchpad)"
            log_warning "  Restore: sudo mv ${ppa_f}.copanel-bak $ppa_f && sudo apt-get update"
            mv "$ppa_f" "${ppa_f}.copanel-bak"
            disabled_any=true
        fi
    done
    shopt -u nullglob
    if [[ "$disabled_any" == true ]]; then
        return 0
    fi
    return 1
}

disable_all_launchpad_ppa_files() {
    log_warning "Disabling all PPA files under sources.list.d that use Launchpad (ppa.launchpad*)…"
    local disabled_any=false
    shopt -s nullglob
    for ppa_f in /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
        [[ -f "$ppa_f" ]] || continue
        case "$ppa_f" in *.copanel-bak) continue ;; esac
        if grep -qE 'ppa\.launchpad(content)?\.net|ppa\.launchpad\.net' "$ppa_f" 2>/dev/null; then
            log_warning "  disabling $(basename "$ppa_f")"
            mv "$ppa_f" "${ppa_f}.copanel-bak"
            disabled_any=true
        fi
    done
    shopt -u nullglob
    if [[ "$disabled_any" == true ]]; then
        return 0
    fi
    return 1
}

apt_update_or_recover() {
    if ! command_exists apt-get; then
        return 0
    fi
    export DEBIAN_FRONTEND=noninteractive
    copanel_write_apt_timeouts

    log_info "Running apt-get update (timeouts: 20s per mirror, max ~4m total if timeout(1) is available)…"

    if apt_get_update_timed; then
        return 0
    fi

    log_warning "apt-get update failed or timed out (common: ppa.launchpadcontent.net unreachable)."
    log_warning "CoPanel does not require Ondrej PHP on Ubuntu 22.04+ (use ubuntu-provided php*-fpm)."

    if disable_ondrej_php_launchpad_sources; then
        if apt_get_update_timed; then
            log_success "apt-get update succeeded after disabling Ondrej PHP PPA"
            return 0
        fi
    else
        log_warning "No Ondrej PHP Launchpad list found to disable; trying broader Launchpad cleanup…"
    fi

    if disable_all_launchpad_ppa_files; then
        if apt_get_update_timed; then
            log_success "apt-get update succeeded after disabling Launchpad-based PPAs"
            return 0
        fi
    fi

    log_error "apt-get update still failing. Inspect: ls -la /etc/apt/sources.list.d/"
    log_error "Fix network/DNS/firewall or remove broken third-party entries manually, then re-run."
    return 1
}

###############################################################################
# Distro helpers. Debian uses sites-available; Alma/RHEL/Rocky use conf.d.
# One unknown RPM name fails the whole dnf transaction, so ufw/certbot are
# never mixed into the required Alma package list.
###############################################################################

copanel_os_release_id() {
    if [[ -n "${COPANEL_OS_ID:-}" ]]; then
        printf '%s' "$COPANEL_OS_ID"
        return 0
    fi
    [[ -r /etc/os-release ]] || return 1
    # shellcheck disable=SC1091
    . /etc/os-release
    printf '%s' "${ID:-}"
}

copanel_os_id_like() {
    if [[ -n "${COPANEL_OS_ID_LIKE+x}" ]]; then
        printf '%s' "$COPANEL_OS_ID_LIKE"
        return 0
    fi
    [[ -r /etc/os-release ]] || return 0
    # shellcheck disable=SC1091
    . /etc/os-release
    printf '%s' "${ID_LIKE:-}"
}

copanel_is_rhel_family() {
    local id like
    id="$(copanel_os_release_id 2>/dev/null || true)"
    like="$(copanel_os_id_like 2>/dev/null || true)"
    case "$id" in
        almalinux|rocky|rhel|centos|fedora|ol|amzn) return 0 ;;
    esac
    [[ "$like" == *rhel* || "$like" == *fedora* || "$like" == *centos* ]]
}

copanel_rpm_mgr() {
    if command_exists dnf; then
        printf 'dnf'
        return 0
    fi
    if command_exists yum; then
        printf 'yum'
        return 0
    fi
    return 1
}

# Packages that exist on Alma/Rocky/RHEL 8+. ufw and certbot are not among them.
copanel_rpm_required_packages() {
    printf '%s\n' \
        python3 python3-pip nginx cronie \
        curl wget git unzip zip rsync \
        gcc gcc-c++ make
}

copanel_rpm_install_required() {
    local mgr="$1"
    local -a pkgs=()
    local p
    while IFS= read -r p; do
        [[ -n "$p" ]] && pkgs+=("$p")
    done < <(copanel_rpm_required_packages)
    log_info "Installing required packages (${mgr})..."
    "$mgr" install -y "${pkgs[@]}"
}

copanel_enable_rhel_crb() {
    command_exists dnf || return 0
    dnf config-manager --set-enabled crb >/dev/null 2>&1 \
        || dnf config-manager --set-enabled powertools >/dev/null 2>&1 \
        || true
}

copanel_try_rhel_optional_packages() {
    local mgr="$1"
    copanel_enable_rhel_crb
    if ! rpm -q inotify-tools >/dev/null 2>&1; then
        "$mgr" install -y inotify-tools >/dev/null 2>&1 \
            || log_warning "inotify-tools was not installed (optional)."
    fi
    if ! command_exists certbot; then
        "$mgr" install -y epel-release >/dev/null 2>&1 || true
        "$mgr" install -y certbot >/dev/null 2>&1 \
            || log_warning "certbot was not installed (optional). Enable EPEL, then: ${mgr} install certbot"
    fi
}

# get.docker.com accepts rocky/rhel/centos, not almalinux. Rocky's EL repo
# uses $releasever, which is 10 on AlmaLinux 10, and Docker publishes that path.
copanel_docker_install_method() {
    case "$(copanel_os_release_id 2>/dev/null || true)" in
        almalinux) printf 'rocky-repo' ;;
        *) printf 'convenience-script' ;;
    esac
}

copanel_install_docker_rocky_repo() {
    local mgr
    mgr="$(copanel_rpm_mgr)" || return 1
    log_info "AlmaLinux is not in get.docker.com; using the Rocky Linux Docker CE repo."
    curl -fsSL https://download.docker.com/linux/rocky/gpg -o /tmp/docker-rocky.gpg || return 1
    rpm --import /tmp/docker-rocky.gpg || return 1
    rm -f /tmp/docker-rocky.gpg
    curl -fsSL https://download.docker.com/linux/rocky/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo || return 1
    if ! "$mgr" install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
        log_warning "docker-ce conflicted with installed packages; retrying with --allowerasing (this can remove podman)."
        "$mgr" install -y --allowerasing docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    fi
}

copanel_install_docker() {
    if command_exists docker; then
        return 0
    fi
    log_info "Installing Docker..."
    if [[ "$(copanel_docker_install_method)" == "rocky-repo" ]]; then
        copanel_install_docker_rocky_repo \
            || log_warning "Docker was not installed. The panel still runs; install docker-ce later to use Docker modules."
        return 0
    fi
    local script
    script="$(mktemp)"
    if curl -fsSL https://get.docker.com -o "$script"; then
        sh "$script" || log_warning "Docker install script failed. The panel still runs without Docker."
    else
        log_warning "Could not download https://get.docker.com"
    fi
    rm -f "$script"
}

copanel_nginx_conf_path() {
    if [[ "${COPANEL_NGINX_LAYOUT:-}" == "conf.d" ]]; then
        printf '%s' "/etc/nginx/conf.d/copanel.conf"
        return 0
    fi
    if [[ "${COPANEL_NGINX_LAYOUT:-}" == "sites" ]]; then
        printf '%s' "/etc/nginx/sites-available/copanel"
        return 0
    fi
    # Stock Alma/RHEL/Rocky nginx never includes sites-enabled. Prefer conf.d
    # even if a previous run created an empty sites-available directory.
    if copanel_is_rhel_family; then
        printf '%s' "/etc/nginx/conf.d/copanel.conf"
        return 0
    fi
    if [[ -d /etc/nginx/sites-available || -d /etc/nginx/sites-enabled ]]; then
        printf '%s' "/etc/nginx/sites-available/copanel"
        return 0
    fi
    if [[ -d /etc/nginx/conf.d ]]; then
        printf '%s' "/etc/nginx/conf.d/copanel.conf"
        return 0
    fi
    printf '%s' "/etc/nginx/sites-available/copanel"
}

copanel_host_has_ipv6() {
    if [[ "${COPANEL_NGINX_FORCE_NO_IPV6:-}" == "1" ]]; then
        return 1
    fi
    if [[ "${COPANEL_NGINX_FORCE_IPV6:-}" == "1" ]]; then
        return 0
    fi
    [[ -f /proc/net/if_inet6 ]]
}

copanel_strip_nginx_ipv6_if_needed() {
    local file="$1"
    if copanel_host_has_ipv6; then
        return 0
    fi
    sed -i '/listen \[::\]:8686;/d' "$file"
}

copanel_ensure_nginx_package() {
    if command_exists nginx && [[ -d /etc/nginx ]]; then
        return 0
    fi
    log_info "Installing nginx..."
    if command_exists apt-get; then
        apt-get install -y nginx
        return $?
    fi
    local mgr
    if mgr="$(copanel_rpm_mgr)"; then
        "$mgr" install -y nginx
        return $?
    fi
    log_error "No supported package manager to install nginx"
    return 1
}

copanel_allow_nginx_selinux() {
    if ! command_exists getenforce; then
        return 0
    fi
    local mode
    mode="$(getenforce 2>/dev/null || true)"
    if [[ "$mode" != "Enforcing" && "$mode" != "Permissive" ]]; then
        return 0
    fi
    log_info "SELinux is ${mode}; allowing nginx to bind :8686 and proxy to the backend..."
    if command_exists setsebool; then
        setsebool -P httpd_can_network_connect 1 \
            || log_warning "Could not set httpd_can_network_connect. API calls through nginx may return 502."
    fi
    if ! command_exists semanage; then
        local mgr
        if mgr="$(copanel_rpm_mgr)"; then
            "$mgr" install -y policycoreutils-python-utils >/dev/null 2>&1 || true
        fi
    fi
    if command_exists semanage; then
        semanage port -a -t http_port_t -p tcp 8686 >/dev/null 2>&1 \
            || semanage port -m -t http_port_t -p tcp 8686 >/dev/null 2>&1 \
            || log_warning "Could not label tcp/8686 as http_port_t. Nginx may fail to bind that port."
    else
        log_warning "semanage is missing; if nginx cannot bind :8686, install policycoreutils-python-utils."
    fi
}

###############################################################################
# Step 1: System Dependencies
###############################################################################

install_dependencies() {
    log_info "Installing system dependencies..."
    
    # Detect package manager
    if command_exists apt-get; then
        apt_update_or_recover || { copanel_remove_apt_timeouts; exit 1; }
        apt-get install -y \
            python3 python3-pip python3-venv \
            nginx cron \
            curl wget git unzip zip rsync \
            build-essential \
            ufw inotify-tools certbot python3-certbot-nginx \
            2>&1 | grep -v "^Reading state\|^Building\|^Setting up" || true
        
    elif mgr="$(copanel_rpm_mgr)"; then
        # Do not pass ufw/certbot here. dnf aborts the entire transaction when
        # any one package name is unknown, which skipped nginx and unzip.
        copanel_rpm_install_required "$mgr" \
            || { log_error "Required packages failed to install."; exit 1; }
        copanel_try_rhel_optional_packages "$mgr"
    fi

    # Cron daemon (required by cron_manager, backup_manager, cloudflare_ddns, etc.)
    if command_exists systemctl; then
        systemctl enable --now cron 2>/dev/null || systemctl enable --now crond 2>/dev/null || true
    fi

    # NodeSource 20 LTS — distro apt npm 9.2 rejects npm: alias overrides.
    if command_exists apt-get || command_exists dnf || command_exists yum; then
        log_info "Installing Node.js 20 LTS via NodeSource..."
        if command_exists apt-get; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || true
            apt-get install -y nodejs || true
        else
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - || true
            if command_exists dnf; then
                dnf install -y nodejs || true
            else
                yum install -y nodejs || true
            fi
        fi
        copanel_ensure_modern_npm
    fi

    copanel_install_docker

    # Install Rclone using official Rclone convenience script if not installed
    if ! command_exists rclone; then
        log_info "Installing Rclone via official installation script..."
        curl https://rclone.org/install.sh | sudo bash || true
    fi

    # Ensure Docker daemon is started & enabled
    if command_exists systemctl && systemctl cat docker.service >/dev/null 2>&1; then
        systemctl enable docker >/dev/null 2>&1 || true
        systemctl start docker >/dev/null 2>&1 || log_warning "Docker service did not start."
    fi

    # Remove CoPanel apt timeout snippet so normal apt behavior returns after install
    copanel_remove_apt_timeouts
    
    log_success "Dependencies installed"
}

###############################################################################
# Sparse checkout: only runtime paths needed to install / run CoPanel on VPS.
# Skips docs (*.md), website/, .github/, and other non-runtime root files.
###############################################################################

# Patterns for git sparse-checkout --no-cone (leading / = repo root).
COPANEL_SPARSE_PATHS=(
    "/backend/"
    "/frontend/"
    "/scripts/"
    "/config/"
    "/VERSION"
    "/.gitignore"
    "/.gitattributes"
)

# Apply sparse-checkout in an existing git worktree under $1.
copanel_apply_sparse_checkout() {
    local repo="$1"
    [[ -d "$repo/.git" ]] || return 0
    (
        cd "$repo" || exit 0
        git sparse-checkout init --no-cone >/dev/null 2>&1 || true
        git sparse-checkout set --no-cone "${COPANEL_SPARSE_PATHS[@]}" >/dev/null 2>&1 \
            || git sparse-checkout set "${COPANEL_SPARSE_PATHS[@]}" >/dev/null 2>&1 \
            || true
    )
}

# Remove leftover docs / non-runtime files that may already be on disk
# (e.g. older full clones, or paths not covered by sparse-checkout).
copanel_prune_nonessential_files() {
    local root="$1"
    [[ -d "$root" ]] || return 0

    # Root-level documentation and report files
    find "$root" -maxdepth 1 -type f \( \
        -name '*.md' -o \
        -name '*.MD' -o \
        -name 'COMPLETION_REPORT.txt' -o \
        -name 'LICENSE*' \
    \) -delete 2>/dev/null || true

    # Non-runtime trees
    rm -rf "$root/website" "$root/.github" 2>/dev/null || true

    # Nested README / architecture notes under backend & frontend
    find "$root/backend" "$root/frontend" "$root/scripts" -type f \( \
        -name 'README.md' -o \
        -name 'README.*.md' -o \
        -name 'ARCHITECTURE_AI.md' -o \
        -name 'DESKTOP_UI.md' -o \
        -name 'NEW_MODULES.md' \
    \) -delete 2>/dev/null || true
}

###############################################################################
# Step 2: Create CoPanel User & Directories
###############################################################################

setup_user_and_dirs() {
    log_info "Setting up user and directories..."
    
    # Create user if doesn't exist
    if ! id "$CoPanel_USER" &>/dev/null; then
        useradd -r -s /bin/bash -d "$CoPanel_HOME" -m "$CoPanel_USER"
        log_success "Created user: $CoPanel_USER"
    else
        log_success "User exists: $CoPanel_USER"
    fi
    
    # Resolve project root and source directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_DIR="$(dirname "$SCRIPT_DIR")"
    
    # Check if running via one-liner (curl/wget), clone from GitHub directly
    if [[ ! -d "$REPO_DIR/backend" ]] || [[ ! -f "$REPO_DIR/backend/main.py" ]]; then
        if [[ -d "$CoPanel_HOME/.git" ]]; then
            log_info "CoPanel already exists with Git repository. Updating codebase (branch: ${COPANEL_GIT_BRANCH})..."
            cd "$CoPanel_HOME"
            git config --global --add safe.directory '*' || true
            git config --system --add safe.directory '*' || true
            # Limit worktree to install/runtime paths before fetch/pull
            copanel_apply_sparse_checkout "$CoPanel_HOME"
            git fetch --all || true
            git checkout -f "${COPANEL_GIT_BRANCH}" 2>/dev/null \
                || git checkout -B "${COPANEL_GIT_BRANCH}" "origin/${COPANEL_GIT_BRANCH}" || true
            git reset --hard "origin/${COPANEL_GIT_BRANCH}" || true
            git clean -fd --exclude=config || true
            git pull origin "${COPANEL_GIT_BRANCH}" --force || true
            git reset --hard "origin/${COPANEL_GIT_BRANCH}" || true
            copanel_apply_sparse_checkout "$CoPanel_HOME"
            copanel_prune_nonessential_files "$CoPanel_HOME"
            REPO_DIR="$CoPanel_HOME"
        else
            log_info "No local project directory found. Cloning CoPanel directly from GitHub..."
            # Let's preserve specific data directories/files if they exist
            TEMP_BACKUP=$(mktemp -d)
            if [[ -d "$CoPanel_HOME/backend/data" ]]; then
                cp -a "$CoPanel_HOME/backend/data" "$TEMP_BACKUP/" || true
            fi
            if [[ -d "$CoPanel_HOME/config" ]]; then
                cp -a "$CoPanel_HOME/config" "$TEMP_BACKUP/" || true
            fi
            if [[ -f "$CoPanel_HOME/backend/users.json" ]]; then
                cp -a "$CoPanel_HOME/backend/users.json" "$TEMP_BACKUP/" || true
            fi
            # Add any other potential db files
            for db in "$CoPanel_HOME"/backend/*.db; do
                if [[ -f "$db" ]]; then
                    cp -a "$db" "$TEMP_BACKUP/" || true
                fi
            done
            
            rm -rf "$CoPanel_HOME"
            # Sparse clone: only backend/frontend/scripts/config + VERSION (no README/.md/website)
            if git clone -b "${COPANEL_GIT_BRANCH}" --depth 1 --filter=blob:none --sparse \
                "${COPANEL_GIT_REMOTE}" "$CoPanel_HOME" 2>/dev/null; then
                copanel_apply_sparse_checkout "$CoPanel_HOME"
            else
                # Fallback for older git without sparse clone support
                log_warning "Sparse clone unavailable; falling back to full clone + prune."
                git clone -b "${COPANEL_GIT_BRANCH}" --depth 1 "${COPANEL_GIT_REMOTE}" "$CoPanel_HOME"
                copanel_apply_sparse_checkout "$CoPanel_HOME"
            fi
            copanel_prune_nonessential_files "$CoPanel_HOME"
            REPO_DIR="$CoPanel_HOME"
            
            # Restore the backed up data if any
            if [[ -d "$TEMP_BACKUP/data" ]]; then
                mkdir -p "$CoPanel_HOME/backend/data"
                cp -a "$TEMP_BACKUP/data"/. "$CoPanel_HOME/backend/data/" || true
            fi
            if [[ -d "$TEMP_BACKUP/config" ]]; then
                mkdir -p "$CoPanel_HOME/config"
                cp -a "$TEMP_BACKUP/config"/. "$CoPanel_HOME/config/" || true
            fi
            if [[ -f "$TEMP_BACKUP/users.json" ]]; then
                cp -a "$TEMP_BACKUP/users.json" "$CoPanel_HOME/backend/" || true
            fi
            for db in "$TEMP_BACKUP"/*.db; do
                if [[ -f "$db" ]]; then
                    cp -a "$db" "$CoPanel_HOME/backend/" || true
                fi
            done
            rm -rf "$TEMP_BACKUP"
        fi
    fi

    # Ensure directory exists with correct permissions
    if [[ ! -d "$CoPanel_HOME" ]]; then
        mkdir -p "$CoPanel_HOME"
    fi
    
    # Stop service if it's currently running to prevent text file busy errors
    if systemctl is-active --quiet copanel; then
        if [[ -n "$COPANEL_ENV" ]] || systemctl status copanel 2>/dev/null | grep -E -q "($$|$PPID)"; then
            log_warning "Installation running inside the CoPanel service tree. Skipping immediate service stop to avoid killing the script."
        else
            log_info "Stopping active CoPanel service for installation..."
            systemctl stop copanel || true
        fi
    fi


    # Sync files from REPO_DIR to CoPanel_HOME if different
    if [[ "$REPO_DIR" != "$CoPanel_HOME" ]]; then
        log_info "Syncing project files from $REPO_DIR to $CoPanel_HOME..."
        if command -v rsync &> /dev/null; then
            rsync -a --delete \
                --exclude "venv" \
                --exclude "node_modules" \
                --exclude ".git" \
                --exclude "config" \
                --exclude "backend/data" \
                --exclude "website" \
                --exclude ".github" \
                --exclude "*.md" \
                --exclude "*.MD" \
                --exclude "COMPLETION_REPORT.txt" \
                "$REPO_DIR/" "$CoPanel_HOME/"
        else
            cp -an "$REPO_DIR"/. "$CoPanel_HOME"/
        fi
        copanel_prune_nonessential_files "$CoPanel_HOME"
    fi

    # Secure permissions and ownership
    chown -R "$CoPanel_USER:$CoPanel_USER" "$CoPanel_HOME"
    chmod -R u+rwX,go+rX "$CoPanel_HOME"
    
    log_success "Directories ready"
}

###############################################################################
# Step 3: Backend Setup
###############################################################################

setup_backend() {
    log_info "Setting up Python backend..."
    
    # Create virtual environment
    if [[ ! -d "$VENV_PATH" ]]; then
        python3 -m venv "$VENV_PATH"
        log_success "Virtual environment created"
    else
        log_success "Virtual environment exists"
    fi
    
    # CoPanel's Python stack runs only inside this venv ($VENV_PATH). system-site-packages is not used;
    # all `pip` commands below install into the venv, and systemd runs uvicorn with $VENV_PATH/bin/python.
    # shellcheck disable=SC1091
    source "$VENV_PATH/bin/activate"

    export PIP_DEFAULT_TIMEOUT="${PIP_DEFAULT_TIMEOUT:-120}"
    
    log_info "Upgrading pip, setuptools, wheel..."
    if ! pip install --upgrade pip setuptools wheel; then
        log_error "Failed to upgrade pip inside $VENV_PATH"
        deactivate 2>/dev/null || true
        exit 1
    fi
    
    if [[ -f "$CoPanel_HOME/backend/requirements.txt" ]]; then
        log_info "Installing Python packages from requirements.txt (may take several minutes on first run)..."
        if ! pip install -r "$CoPanel_HOME/backend/requirements.txt"; then
            log_error "pip install -r requirements.txt failed. Check network, disk space, and compiler packages (build-essential)."
            deactivate 2>/dev/null || true
            exit 1
        fi
    else
        log_warning "requirements.txt not found at $CoPanel_HOME/backend/requirements.txt"
    fi
    log_success "Python dependencies installed"

    log_info "Initializing CoPanel database..."
    chown -R "$CoPanel_USER:$CoPanel_USER" "$CoPanel_HOME"
    if ! sudo -u "$CoPanel_USER" ADMIN_PASSWORD="${ADMIN_PASSWORD:-}" "$VENV_PATH/bin/python3" -c "import sys; sys.path.append('$CoPanel_HOME/backend'); from core.user_model import init_db; init_db()"; then
        log_error "Database initialization failed (core.user_model.init_db)."
        deactivate 2>/dev/null || true
        exit 1
    fi
    log_success "Database initialized"
    
    # Final ownership check
    chown -R "$CoPanel_USER:$CoPanel_USER" "$CoPanel_HOME"
    chmod -R u+rwX,go+rX "$CoPanel_HOME"
    
    deactivate 2>/dev/null || true
}

###############################################################################
# Step 4: Frontend Setup
###############################################################################

copanel_npm_major_version() {
    if ! command -v npm &>/dev/null; then
        echo 0
        return
    fi
    npm -v 2>/dev/null | cut -d. -f1 | tr -cd '0-9'
}

copanel_ensure_modern_npm() {
    if ! command -v npm &>/dev/null; then
        return 0
    fi
    local major
    major="$(copanel_npm_major_version)"
    # npm 9.2 (Ubuntu apt) rejects overrides like npm:esbuild-wasm@x — need npm 10+.
    if [[ -z "$major" || "$major" -lt 10 ]]; then
        log_info "Upgrading npm (current: $(npm -v 2>/dev/null || echo unknown)) → 10.x..."
        if ! npm install -g npm@10; then
            log_warning "npm upgrade failed — WASM override path may break on no-AVX hosts."
        fi
    fi
}

copanel_cpu_has_avx() {
    [[ -r /proc/cpuinfo ]] || return 0
    grep -q avx /proc/cpuinfo 2>/dev/null
}

copanel_strip_wasm_overrides() {
    local pkg="$1"
    [[ -f "$pkg" ]] || return 0
    node -e '
const fs = require("fs");
const pkg = process.argv[1];
const data = JSON.parse(fs.readFileSync(pkg, "utf8"));
if (!data.overrides) process.exit(0);
const o = data.overrides;
const wasm = String(o.rollup || "").includes("wasm") || String(o.esbuild || "").includes("wasm");
if (!wasm) process.exit(0);
delete o.rollup;
delete o.esbuild;
if (Object.keys(o).length === 0) delete data.overrides;
fs.writeFileSync(pkg, JSON.stringify(data, null, 2) + "\n");
' "$pkg"
}

copanel_maybe_apply_rollup_wasm_override() {
    local pkg="$1"
    [[ -f "$pkg" ]] || return 0
    if copanel_cpu_has_avx; then
        copanel_strip_wasm_overrides "$pkg"
        return 0
    fi
    local major
    major="$(copanel_npm_major_version)"
    if [[ -z "$major" || "$major" -lt 10 ]]; then
        log_warning "CPU without AVX and npm < 10 — WASM overrides skipped (upgrade npm first)."
        return 0
    fi
    log_info "CPU without AVX — configuring Rollup + esbuild WASM overrides..."
    node -e '
const fs = require("fs");
const pkg = process.argv[1];
const data = JSON.parse(fs.readFileSync(pkg, "utf8"));
data.overrides = data.overrides || {};
let changed = false;
if (!String(data.overrides.rollup || "").includes("wasm")) {
  data.overrides.rollup = "npm:@rollup/wasm-node@4.60.2";
  changed = true;
}
if (!String(data.overrides.esbuild || "").includes("wasm")) {
  data.overrides.esbuild = "npm:esbuild-wasm@0.21.5";
  changed = true;
}
if (changed) {
  fs.writeFileSync(pkg, JSON.stringify(data, null, 2) + "\n");
  process.stdout.write("changed");
}
' "$pkg"
}

copanel_frontend_npm_install_wasm() {
    log_info "Reinstalling node_modules with WASM Rollup/esbuild (no native AVX binaries)..."
    rm -rf node_modules
    npm install --legacy-peer-deps || npm install --legacy-peer-deps
}

copanel_run_vite_build_noavx() {
    local log heap_default
    log="$(mktemp)"
    local code=0
    heap_default=2048
    if copanel_is_low_memory; then
        heap_default="${COPANEL_NODE_HEAP_MB:-1536}"
    fi
    set +e
    NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=${heap_default}}" \
        VITE_BUILD_LOW_MEMORY=1 npm run build:appstore 2>&1 | tee "$log"
    code="${PIPESTATUS[0]}"
    set -e
    if grep -qiE 'segmentation fault|segfault|core dumped' "$log"; then
        code=139
    fi
    if [[ ! -f dist/index.html ]]; then
        code=1
    fi
    rm -f "$log"
    return "$code"
}

copanel_frontend_build_noavx() {
    local attempt
    for attempt in 1 2 3; do
        rm -rf dist node_modules/.vite
        copanel_run_vite_build_noavx
        local code=$?
        if [[ "$code" -eq 0 ]]; then
            return 0
        fi
        if grep -qi avx /proc/cpuinfo 2>/dev/null; then
            :
        elif [[ "$code" -eq 139 ]]; then
            log_warning "Frontend build segfault (native esbuild/rollup). Forcing WASM reinstall..."
        else
            log_warning "Frontend build attempt ${attempt}/3 failed (exit ${code})."
        fi
        if [[ "$attempt" -lt 3 ]]; then
            log_info "Retrying with fresh WASM node_modules..."
            copanel_maybe_apply_rollup_wasm_override "$CoPanel_HOME/frontend/package.json"
            copanel_frontend_npm_install_wasm
            sleep 2
        fi
    done
    return 1
}

setup_frontend() {
    log_info "Setting up React frontend..."
    
    if [[ -f "$CoPanel_HOME/frontend/package.json" ]]; then
        cd "$CoPanel_HOME/frontend"

        copanel_ensure_modern_npm
        copanel_maybe_apply_rollup_wasm_override "$CoPanel_HOME/frontend/package.json"

        if ! copanel_cpu_has_avx; then
            copanel_frontend_npm_install_wasm
        else
            log_info "Installing npm packages..."
            npm install || npm install --legacy-peer-deps
        fi

        if copanel_is_low_memory; then
            export VITE_BUILD_LOW_MEMORY="${VITE_BUILD_LOW_MEMORY:-1}"
            copanel_ensure_node_heap
            log_info "Low-memory frontend build (NODE_OPTIONS=${NODE_OPTIONS:-unset})"
        fi

        log_info "Building frontend..."
        if ! copanel_cpu_has_avx; then
            if ! copanel_frontend_build_noavx; then
                log_warning "build:appstore failed — last resort: vite only (low-memory, WASM deps)..."
                rm -rf dist node_modules/.vite
                copanel_frontend_npm_install_wasm
                copanel_run_vite_build_noavx || return 1
            fi
        else
            rm -rf dist
            if ! npm run build; then
                log_error "Frontend build failed. On a 1 GB VPS, confirm swap is active (swapon --show) and re-run install.sh."
                cd - >/dev/null || true
                return 1
            fi
        fi
        
        log_success "Frontend built and ready"
        cd - >/dev/null
    fi
}

copanel_write_ui_track() {
    mkdir -p "$CoPanel_HOME/config"
    local track="classic"
    if [[ "${COPANEL_UI_TRACK:-}" == "desktop" ]]; then
        track="desktop"
    fi
    echo "$track" > "$CoPanel_HOME/config/ui_track"
    if [[ -d "$CoPanel_HOME/frontend/dist" ]]; then
        printf '{"ui_track":"%s"}\n' "$track" > "$CoPanel_HOME/frontend/dist/ui-track.json"
    fi
    log_info "UI track: $track ($(copanel_ui_track_label))"
}

###############################################################################
# Step 5: Nginx Configuration
###############################################################################

setup_nginx() {
    log_info "Configuring Nginx reverse proxy..."

    copanel_ensure_nginx_package || { log_error "nginx is required."; exit 1; }

    # Debian/Ubuntu: sites-available + sites-enabled.
    # Alma/RHEL/Rocky: nginx only includes /etc/nginx/conf.d/*.conf.
    NGINX_CONF="$(copanel_nginx_conf_path)"
    if [[ "$NGINX_CONF" == /etc/nginx/sites-available/* ]]; then
        NGINX_ENABLED="/etc/nginx/sites-enabled/copanel"
        mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
    else
        NGINX_ENABLED=""
        mkdir -p /etc/nginx/conf.d
    fi
    log_info "Nginx site file: ${NGINX_CONF}"
    
    # Create Nginx configuration
    cat > "$NGINX_CONF" << 'EOF'
upstream copanel_backend {
    server 127.0.0.1:8000;
}

upstream php_fpm {
    server unix:/run/php-fpm/www.sock max_fails=1 fail_timeout=1s;
    server unix:/run/php/php8.3-fpm.sock max_fails=1 fail_timeout=1s;
    server unix:/run/php/php8.2-fpm.sock max_fails=1 fail_timeout=1s;
    server unix:/run/php/php8.1-fpm.sock max_fails=1 fail_timeout=1s;
    server unix:/run/php/php8.0-fpm.sock max_fails=1 fail_timeout=1s;
    server unix:/run/php/php7.4-fpm.sock max_fails=1 fail_timeout=1s;
}

server {
    listen 8686;
    listen [::]:8686;
    
    server_name _;
    
    client_max_body_size 100M;
    
    # Frontend (static files)
    location / {
        root /opt/copanel/frontend/dist;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
    }
    
    # phpMyAdmin direct configuration
    location /phpmyadmin {
        root /usr/share/;
        index index.php index.html index.htm;
        location ~ ^/phpmyadmin/(.+\.php)$ {
            try_files $uri =404;
            root /usr/share/;
            fastcgi_pass php_fpm;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        }
        location ~* ^/phpmyadmin/(.+\.(jpg|jpeg|gif|css|png|js|ico|html|xml|txt))$ {
            root /usr/share/;
        }
    }
    
    # API endpoints
    location /api/ {
        proxy_pass http://copanel_backend;
        proxy_intercept_errors off;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Health check
    location /health {
        proxy_pass http://copanel_backend;
    }
}
EOF

    copanel_strip_nginx_ipv6_if_needed "$NGINX_CONF"
    
    # Enable site (Debian layout only; conf.d is included by nginx.conf)
    if [[ -n "$NGINX_ENABLED" && ! -L "$NGINX_ENABLED" ]]; then
        ln -s "$NGINX_CONF" "$NGINX_ENABLED"
    fi

    copanel_allow_nginx_selinux
    
    # Test configuration
    if nginx -t >/dev/null 2>&1; then
        systemctl enable nginx || true
        if ! systemctl restart nginx; then
            log_error "Nginx failed to start"
            systemctl status nginx --no-pager || true
            journalctl -u nginx -n 40 --no-pager || true
            exit 1
        fi
        log_success "Nginx configured, enabled, and restarted"
    else
        log_error "Nginx configuration error"
        nginx -t
        exit 1
    fi

    # Re-apply HTTP access gate if Settings previously enabled it.
    # setup_nginx overwrites sites-available/copanel with a clean template that
    # does not include # BEGIN COPANEL NGINX GATE — without this, gate is lost
    # until the admin re-saves Settings (or until copanel startup auto-repair).
    restore_nginx_gate_from_settings

    # UFW alone does not open the panel on Oracle Cloud Ubuntu: UFW is often
    # inactive, and iptables REJECTs new connections to 8686/80/443.
    copanel_configure_firewall
}

###############################################################################
# Restore nginx HTTP gate from panel_settings.json after template overwrite
###############################################################################

restore_nginx_gate_from_settings() {
    local settings_file="${CoPanel_HOME}/config/panel_settings.json"
    local htpasswd_file="${CoPanel_HOME}/config/panel_access.htpasswd"
    local py="${CoPanel_HOME}/venv/bin/python"
    local out=""

    if [[ ! -f "$settings_file" ]] || [[ ! -f "$htpasswd_file" ]]; then
        return 0
    fi
    if [[ ! -x "$py" ]]; then
        log_info "Skipping nginx gate restore (venv python not ready yet); will restore on service start"
        return 0
    fi

    log_info "Checking whether to restore nginx access gate from saved settings..."
    # NOTE: do not put `|| true` on the same line as `<<'PY'` inside $(...);
    # bash misparses that as a syntax error near `||` (command substitution).
    out="$(
        cd "${CoPanel_HOME}/backend" && "$py" - <<'PY' 2>/dev/null
from modules.panel_settings.logic import maybe_auto_repair_nginx_gate, nginx_gate_needs_auto_repair

if not nginx_gate_needs_auto_repair():
    print("skip")
else:
    result = maybe_auto_repair_nginx_gate()
    print("ok" if result else "fail")
PY
    )" || true

    case "$out" in
        *ok*)
            log_success "Nginx access gate restored from panel settings"
            ;;
        *skip*)
            log_info "Nginx access gate already applied or not enabled"
            ;;
        *)
            log_info "Nginx access gate restore deferred to CoPanel service startup"
            ;;
    esac
}

###############################################################################
# Step 6: Systemd Service
###############################################################################

setup_systemd_service() {
    log_info "Creating Systemd service..."
    
    cat > /etc/systemd/system/copanel.service << 'EOF'
[Unit]
Description=CoPanel - Linux VPS Management Panel
After=network.target network-online.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/copanel/backend

Environment="PATH=/opt/copanel/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
ExecStart=/opt/copanel/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000

# Allow slow first boot (module scan) without blocking forever on nginx hooks.
TimeoutStartSec=120
TimeoutStopSec=30

# Restart policy
Restart=always
RestartSec=5

# Resource limits
LimitNOFILE=65536
LimitNPROC=65536

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd and enable service
    systemctl daemon-reload
    systemctl enable copanel.service
    
    log_success "Systemd service created and enabled"
}

###############################################################################
# Step 7: Start Services
###############################################################################

start_services() {
    log_info "Starting services..."
    
    systemctl restart copanel.service
    
    if systemctl is-active --quiet copanel; then
        log_success "CoPanel service started"
    else
        log_error "Failed to start CoPanel service"
        systemctl status copanel.service
        exit 1
    fi
    
    if systemctl is-active --quiet nginx; then
        log_success "Nginx is running"
    fi
}

###############################################################################
# Step 8: Verification
###############################################################################

verify_installation() {
    log_info "Verifying installation..."
    
    sleep 2
    
    # Check backend health
    if curl -s http://localhost:8000/health | grep -q "healthy"; then
        log_success "Backend health check passed"
    else
        log_warning "Could not verify backend health"
    fi
    
    # Check Nginx
    if curl -s http://localhost:8686/health | grep -q "healthy"; then
        log_success "Nginx reverse proxy working"
    else
        log_warning "Could not verify Nginx proxy"
    fi
}

###############################################################################
# Summary
###############################################################################

print_summary() {
    ADMIN_PWD="admin (or previously generated)"
    if [[ -f "${CoPanel_HOME}/config/admin_password.txt" ]]; then
        ADMIN_PWD=$(cat "${CoPanel_HOME}/config/admin_password.txt")
    fi
    LOWMEM_SUMMARY=""
    if [[ "${COPANEL_LOWMEM_ACTIVE:-}" == "1" ]]; then
        LOWMEM_SUMMARY="🧠 Low-memory mode:  ${COPANEL_SWAP_SIZE_MB:-2048} MB swap, Node heap ${COPANEL_NODE_HEAP_MB:-1536} MB"
    fi

    cat <<EOF

${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}
${GREEN}║          CoPanel Installation Complete! ✓                    ║${NC}
${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}

${BLUE}Installation Summary:${NC}

📦 Panel version:    ${GREEN}v${COPANEL_VER:-?}${NC}
🖥  Interface:        ${GREEN}$(copanel_ui_track_label)${NC} ${YELLOW}(toggle anytime in panel)${NC}
📍 Admin Password:   ${GREEN}${ADMIN_PWD}${NC}
📍 Location:          ${CoPanel_HOME}
👤 Service User:      ${CoPanel_USER}
🌐 Access URL:        http://localhost:${NGINX_PORT}
📊 Backend API:       http://localhost:${BACKEND_PORT}
📜 phpMyAdmin:        http://localhost:${NGINX_PORT}/phpmyadmin
   ${YELLOW}(Install MariaDB + phpMyAdmin via Package Manager inside CoPanel)${NC}
${LOWMEM_SUMMARY}
${BLUE}Useful Commands:${NC}

Start service:        systemctl start copanel
Stop service:         systemctl stop copanel
Restart service:      systemctl restart copanel
View logs:            journalctl -u copanel -f
Service status:       systemctl status copanel

${BLUE}Adding New Modules:${NC}

1. Create folder in:  ${CoPanel_HOME}/backend/modules/{module_name}/
2. Add router.py      (Backend API routes)
3. Restart service:   systemctl restart copanel

Frontend modules:     ${CoPanel_HOME}/frontend/src/modules/

${YELLOW}Next Steps:${NC}

1. Open browser: http://localhost:${NGINX_PORT}
2. Go to Package Manager to install MariaDB / PostgreSQL / phpMyAdmin
3. Review logs: journalctl -u copanel -f

EOF
}

###############################################################################
# Main Execution
###############################################################################

main() {
    copanel_parse_install_args "$@"

    # When the panel streams this script (COPANEL_NONINTERACTIVE=1), skip `clear`
    # so the browser log view is not wiped by ANSI.
    if [[ -z "${COPANEL_NONINTERACTIVE:-}" ]]; then
        clear
    fi

    COPANEL_VER="$(copanel_resolve_panel_version)"
    
    echo -e "${PURPLE}${BOLD}"
    cat << 'EOF'
   ______      ____                   __
  / ____/___  / __ \____ _____  ___  / /
 / /   / __ \/ /_/ / __ `/ __ \/ _ \/ / 
/ /___/ /_/ / ____/ /_/ / / / /  __/ /  
\____/\____/_/    \__,_/_/ /_/\___/_/   
EOF
    echo -e "${NC}"
    echo -e "   ${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "   ${CYAN}${BOLD}CoPanel - Advanced Linux VPS Management System${NC}"
    echo -e "   ${BOLD}v${COPANEL_VER} - Premium Pluggable Architecture${NC}"
    echo -e "   ${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    check_root
    check_os
    copanel_prompt_ui_mode

    log_step "Check memory and swap"
    prepare_low_memory_host
    
    log_step "Step 1: Check & Install Dependencies"
    install_dependencies
    
    log_step "Step 2: Setup System Users & Workspaces"
    setup_user_and_dirs
    
    log_step "Step 3: Build & Provision Backend"
    setup_backend

    log_step "Step 4: Build & Provision Frontend"
    setup_frontend
    copanel_write_ui_track

    log_step "Step 5: Configure Nginx & Firewall"
    setup_nginx

    log_step "Step 6: Register Systemd Daemon"
    setup_systemd_service

    log_step "Step 7: Launch Panel Engine"
    start_services

    log_step "Step 8: System Readiness Checklist"
    verify_installation
    
    echo ""
    # Re-read after clone/rsync so summary matches on-disk VERSION / git.
    COPANEL_VER="$(copanel_resolve_panel_version)"
    print_summary
}

# Run main installation when executed. Tests source this file and call helpers.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi