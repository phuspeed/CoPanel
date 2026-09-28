#!/bin/bash
# Decision-logic tests for low-RAM swap, Node heap, and Oracle iptables rules.
# Sources install.sh. Does not create swap, change UFW, or touch live iptables.
# Configuration variables are read by the sourced installer, not by this file.
# shellcheck disable=SC2034
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/install.sh"

FAILS=0

reset_env() {
    unset COPANEL_MEM_TOTAL_MB COPANEL_SWAP_TOTAL_MB COPANEL_DISK_FREE_MB \
        COPANEL_SWAPFILE COPANEL_SKIP_SWAP COPANEL_SKIP_NODE_HEAP \
        COPANEL_LOW_MEM_MB COPANEL_SWAP_SIZE_MB COPANEL_NODE_HEAP_MB \
        COPANEL_FORCE_ORACLE COPANEL_ENVIRONMENT_FILE COPANEL_FSTAB_FILE \
        COPANEL_SKIP_FIREWALL_PERSIST COPANEL_IPTABLES_RULES_V4 \
        COPANEL_IPTABLES_RULES_V6         COPANEL_UFW_BIN COPANEL_IPTABLES_BIN \
        COPANEL_IP6TABLES_BIN COPANEL_SKIP_FIREWALLD COPANEL_ASSUME_FIREWALLD \
        NODE_OPTIONS VITE_BUILD_LOW_MEMORY COPANEL_LOWMEM_ACTIVE || true
}

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

reset_env
mem="$(copanel_mem_total_mb)"
assert_true "meminfo is a positive integer" bash -c "[[ '$mem' =~ ^[0-9]+$ && '$mem' -gt 0 ]]"

reset_env
COPANEL_MEM_TOTAL_MB=1024
assert_true "1 GB is low memory" copanel_is_low_memory
COPANEL_MEM_TOTAL_MB=2048
assert_true "2048 MB is low memory" copanel_is_low_memory
COPANEL_MEM_TOTAL_MB=2049
assert_false "2049 MB is not low memory" copanel_is_low_memory
COPANEL_MEM_TOTAL_MB=0
assert_false "unreadable memory is not treated as low" copanel_is_low_memory
COPANEL_MEM_TOTAL_MB=1024
COPANEL_LOW_MEM_MB=512
assert_false "threshold override can exclude a 1 GB host" copanel_is_low_memory

reset_env
COPANEL_FORCE_ORACLE=1
assert_true "oracle force flag" copanel_is_oracle_cloud
COPANEL_FORCE_ORACLE=0
assert_false "oracle force off" copanel_is_oracle_cloud

reset_env
sparse="$(mktemp)"
dense="$(mktemp)"
truncate -s 1M "$sparse"
dd if=/dev/zero of="$dense" bs=1K count=4 status=none
assert_true "truncate file is sparse" copanel_swapfile_is_sparse "$sparse"
assert_false "dd file is not sparse" copanel_swapfile_is_sparse "$dense"
rm -f "$sparse" "$dense"

reset_env
missing="/tmp/copanel-nosuch-swap-$$"
COPANEL_SWAP_TOTAL_MB=0
COPANEL_DISK_FREE_MB=10000
COPANEL_SWAPFILE="$missing"
assert_eq "plan creates swap when ram-sized host has none" "create" "$(copanel_swap_plan)"
COPANEL_DISK_FREE_MB=100
assert_eq "plan skips swap when disk is too small" "skip-nospace" "$(copanel_swap_plan)"
COPANEL_SWAP_TOTAL_MB=2048
COPANEL_DISK_FREE_MB=10000
assert_eq "plan skips when 2 GB swap already exists" "skip-enough" "$(copanel_swap_plan)"
COPANEL_SKIP_SWAP=1
COPANEL_SWAP_TOTAL_MB=0
assert_eq "plan honors COPANEL_SKIP_SWAP" "skip-disabled" "$(copanel_swap_plan)"
reset_env
existing="$(mktemp)"
COPANEL_SWAP_TOTAL_MB=0
COPANEL_DISK_FREE_MB=10000
COPANEL_SWAPFILE="$existing"
assert_eq "plan activates an existing swap file" "activate" "$(copanel_swap_plan)"
rm -f "$existing"

reset_env
fstab="$(mktemp)"
printf '%s\n' 'UUID=abc / ext4 defaults 0 1' > "$fstab"
copanel_persist_swap_fstab /swapfile "$fstab"
copanel_persist_swap_fstab /swapfile "$fstab"
assert_eq "fstab swap entry is written once" "1" "$(grep -c '^/swapfile ' "$fstab")"
assert_eq "fstab swap line" "/swapfile swap swap defaults 0 0" "$(grep '^/swapfile ' "$fstab")"
rm -f "$fstab"

reset_env
envfile="$(mktemp)"
printf '%s\n' 'PATH="/usr/bin"' 'export NODE_OPTIONS="--max-old-space-size=1536"' > "$envfile"
copanel_persist_node_options 1536 "$envfile"
assert_false "pam_env file has no shell export keyword" grep -q '^export ' "$envfile"
assert_eq "node options line" 'NODE_OPTIONS="--max-old-space-size=1536"' "$(grep '^NODE_OPTIONS=' "$envfile")"
assert_eq "PATH line kept" 'PATH="/usr/bin"' "$(grep '^PATH=' "$envfile")"
copanel_persist_node_options 2048 "$envfile"
assert_eq "existing NODE_OPTIONS is not duplicated or overwritten" "1" "$(grep -c '^NODE_OPTIONS=' "$envfile")"
assert_true "original heap is kept" grep -q 'max-old-space-size=1536' "$envfile"
rm -f "$envfile"

reset_env
envfile="$(mktemp)"
printf '%s\n' 'NODE_OPTIONS="--max-old-space-size=768"' > "$envfile"
copanel_persist_node_options 1536 "$envfile"
assert_true "pre-set heap is left alone" grep -qx 'NODE_OPTIONS="--max-old-space-size=768"' "$envfile"
rm -f "$envfile"

reset_env
(
    unset NODE_OPTIONS || true
    export COPANEL_MEM_TOTAL_MB=1024
    export COPANEL_SKIP_SWAP=1
    export COPANEL_SWAP_TOTAL_MB=0
    export COPANEL_ENVIRONMENT_FILE
    COPANEL_ENVIRONMENT_FILE="$(mktemp)"
    prepare_low_memory_host
    [[ "${COPANEL_LOWMEM_ACTIVE:-}" == "1" ]]
    [[ "$NODE_OPTIONS" == "--max-old-space-size=1536" ]]
    [[ "${VITE_BUILD_LOW_MEMORY:-}" == "1" ]]
    grep -qx 'NODE_OPTIONS="--max-old-space-size=1536"' "$COPANEL_ENVIRONMENT_FILE"
    rm -f "$COPANEL_ENVIRONMENT_FILE"
)
printf 'ok  prepare_low_memory_host sets heap, vite flag, and environment file\n'

reset_env
(
    unset NODE_OPTIONS || true
    export COPANEL_MEM_TOTAL_MB=8192
    export COPANEL_ENVIRONMENT_FILE
    COPANEL_ENVIRONMENT_FILE="$(mktemp)"
    : > "$COPANEL_ENVIRONMENT_FILE"
    copanel_ensure_node_heap
    [[ ! -s "$COPANEL_ENVIRONMENT_FILE" ]]
    [[ -z "${NODE_OPTIONS:-}" ]]
    rm -f "$COPANEL_ENVIRONMENT_FILE"
)
printf 'ok  high-memory host does not cap Node heap\n'

reset_env
port80="$(mktemp)"
printf '%s\n' '-A INPUT -p tcp --dport 8080 -j ACCEPT' 'COMMIT' > "$port80"
copanel_insert_iptables_dport "$port80" 80
assert_eq "port 80 is not confused with 8080" "1" "$(grep -c -- '--dport 80 ' "$port80")"
assert_true "8080 rule kept" grep -q -- '--dport 8080 ' "$port80"
rm -f "$port80"

oracle_rules() {
    cat <<'EOF'
*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
-A INPUT -p icmp -j ACCEPT
-A INPUT -i lo -j ACCEPT
-A INPUT -p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT
-A INPUT -j REJECT --reject-with icmp-host-prohibited
-A FORWARD -j REJECT --reject-with icmp-host-prohibited
COMMIT
EOF
}

reset_env
rules="$(mktemp)"
oracle_rules > "$rules"
copanel_insert_iptables_dport "$rules" 8686
copanel_insert_iptables_dport "$rules" 80
copanel_insert_iptables_dport "$rules" 443
copanel_insert_iptables_dport "$rules" 8686
assert_eq "8686 rule inserted once" "1" "$(grep -c -- '--dport 8686 ' "$rules")"
assert_eq "80 rule inserted once" "1" "$(grep -c -- '--dport 80 ' "$rules")"
assert_eq "443 rule inserted once" "1" "$(grep -c -- '--dport 443 ' "$rules")"
assert_true "ssh rule kept" grep -q -- '--dport 22 ' "$rules"
panel_line="$(grep -n -- '--dport 8686 ' "$rules" | head -1 | cut -d: -f1)"
reject_line="$(grep -n -- '-A INPUT -j REJECT' "$rules" | head -1 | cut -d: -f1)"
if [[ "$panel_line" -lt "$reject_line" ]]; then
    printf 'ok  panel port is accepted before INPUT REJECT\n'
else
    printf 'FAIL panel rule is not before INPUT REJECT (%s vs %s)\n' "$panel_line" "$reject_line" >&2
    FAILS=$((FAILS + 1))
fi
last="$(tail -n 1 "$rules" | tr -d '[:space:]')"
assert_eq "COMMIT stays last" "COMMIT" "$last"
rm -f "$rules"

reset_env
tmpdir="$(mktemp -d)"
mock_log="$tmpdir/calls"
: > "$mock_log"
cat > "$tmpdir/iptables" << EOF
#!/bin/bash
bin="\$(basename "\$0")"
echo "\$bin \$*" >> "$mock_log"
present="$tmpdir/present.\$bin"
if [[ "\$1" == "-C" ]]; then
    if grep -q -- "--dport \$6" "\$present" 2>/dev/null; then
        exit 0
    fi
    exit 1
fi
if [[ "\$1" == "-I" ]]; then
    echo "--dport \$6" >> "\$present"
    exit 0
fi
if [[ "\$1" == "-L" ]]; then
    exit 0
fi
exit 0
EOF
cp "$tmpdir/iptables" "$tmpdir/ip6tables"
cat > "$tmpdir/ufw" << EOF
#!/bin/bash
echo "ufw \$*" >> "$mock_log"
exit 0
EOF
chmod +x "$tmpdir/iptables" "$tmpdir/ip6tables" "$tmpdir/ufw"
oracle_rules > "$tmpdir/rules.v4"
oracle_rules > "$tmpdir/rules.v6"
COPANEL_UFW_BIN="$tmpdir/ufw"
COPANEL_IPTABLES_BIN="$tmpdir/iptables"
COPANEL_IP6TABLES_BIN="$tmpdir/ip6tables"
COPANEL_IPTABLES_RULES_V4="$tmpdir/rules.v4"
COPANEL_IPTABLES_RULES_V6="$tmpdir/rules.v6"
COPANEL_SKIP_FIREWALLD=1
COPANEL_ASSUME_FIREWALLD=0
copanel_configure_firewall
assert_eq "ufw allow 8686" "1" "$(grep -c 'ufw allow 8686/tcp' "$mock_log")"
assert_eq "ufw allow 80" "1" "$(grep -c 'ufw allow 80/tcp' "$mock_log")"
assert_eq "ufw allow 443" "1" "$(grep -c 'ufw allow 443/tcp' "$mock_log")"
assert_eq "ufw reloaded once" "1" "$(grep -c 'ufw reload' "$mock_log")"
assert_eq "iptables insert 8686 once" "1" "$(grep -c '^iptables -I INPUT -p tcp --dport 8686 -j ACCEPT$' "$mock_log")"
assert_eq "iptables insert 80 once" "1" "$(grep -c '^iptables -I INPUT -p tcp --dport 80 -j ACCEPT$' "$mock_log")"
assert_eq "iptables insert 443 once" "1" "$(grep -c '^iptables -I INPUT -p tcp --dport 443 -j ACCEPT$' "$mock_log")"
assert_eq "ip6tables insert 8686 once" "1" "$(grep -c '^ip6tables -I INPUT -p tcp --dport 8686 -j ACCEPT$' "$mock_log")"
assert_true "rules.v4 has 8686 before reboot" grep -q -- '--dport 8686 ' "$tmpdir/rules.v4"
assert_true "rules.v6 has 443" grep -q -- '--dport 443 ' "$tmpdir/rules.v6"
# Second run must not insert another live rule.
copanel_configure_firewall
assert_eq "second run does not insert 8686 again" "1" "$(grep -c '^iptables -I INPUT -p tcp --dport 8686 -j ACCEPT$' "$mock_log")"
assert_eq "second run does not insert ip6 8686 again" "1" "$(grep -c '^ip6tables -I INPUT -p tcp --dport 8686 -j ACCEPT$' "$mock_log")"
rm -rf "$tmpdir"

if [[ "$FAILS" -ne 0 ]]; then
    printf '%s failed\n' "$FAILS" >&2
    exit 1
fi
printf 'all install low-memory checks passed\n'
