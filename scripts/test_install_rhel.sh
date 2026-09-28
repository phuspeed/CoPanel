#!/bin/bash
# Alma/RHEL installer decisions: nginx conf.d, RPM package names, Docker repo.
# Does not install packages or write /etc/nginx.
# shellcheck disable=SC2034
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/install.sh"

FAILS=0

reset_env() {
    unset COPANEL_OS_ID COPANEL_OS_ID_LIKE COPANEL_NGINX_LAYOUT \
        COPANEL_NGINX_FORCE_NO_IPV6 COPANEL_NGINX_FORCE_IPV6 \
        COPANEL_ASSUME_FIREWALLD COPANEL_SKIP_FIREWALLD \
        COPANEL_UFW_BIN COPANEL_IPTABLES_BIN COPANEL_IP6TABLES_BIN \
        COPANEL_IPTABLES_RULES_V4 COPANEL_IPTABLES_RULES_V6 \
        COPANEL_SKIP_FIREWALL_PERSIST || true
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
COPANEL_OS_ID=almalinux
COPANEL_OS_ID_LIKE="rhel centos fedora"
assert_true "almalinux is a rhel-family distro" copanel_is_rhel_family
assert_eq "almalinux nginx file is conf.d" "/etc/nginx/conf.d/copanel.conf" "$(copanel_nginx_conf_path)"
assert_eq "almalinux docker method" "rocky-repo" "$(copanel_docker_install_method)"

reset_env
COPANEL_OS_ID=ubuntu
COPANEL_OS_ID_LIKE=debian
assert_false "ubuntu is not rhel-family" copanel_is_rhel_family
assert_eq "ubuntu nginx file is sites-available" "/etc/nginx/sites-available/copanel" "$(copanel_nginx_conf_path)"
assert_eq "ubuntu docker method" "convenience-script" "$(copanel_docker_install_method)"

reset_env
COPANEL_NGINX_LAYOUT=conf.d
assert_eq "layout override conf.d" "/etc/nginx/conf.d/copanel.conf" "$(copanel_nginx_conf_path)"
COPANEL_NGINX_LAYOUT=sites
assert_eq "layout override sites" "/etc/nginx/sites-available/copanel" "$(copanel_nginx_conf_path)"

reset_env
pkgs="$(copanel_rpm_required_packages)"
assert_true "rpm list includes nginx" grep -qx nginx <<<"$pkgs"
assert_true "rpm list includes unzip" grep -qx unzip <<<"$pkgs"
assert_false "rpm list does not include ufw" grep -qx ufw <<<"$pkgs"
assert_false "rpm list does not include certbot" grep -qx certbot <<<"$pkgs"

reset_env
conf="$(mktemp)"
printf '%s\n' '    listen 8686;' '    listen [::]:8686;' > "$conf"
COPANEL_NGINX_FORCE_NO_IPV6=1
copanel_strip_nginx_ipv6_if_needed "$conf"
assert_false "ipv6 listen removed when ipv6 is off" grep -q '\[::\]' "$conf"
assert_true "ipv4 listen kept" grep -q 'listen 8686;' "$conf"
rm -f "$conf"

reset_env
tmpdir="$(mktemp -d)"
mock_log="$tmpdir/calls"
: > "$mock_log"
cat > "$tmpdir/iptables" << EOF
#!/bin/bash
echo "iptables \$*" >> "$mock_log"
exit 0
EOF
chmod +x "$tmpdir/iptables"
COPANEL_ASSUME_FIREWALLD=1
COPANEL_SKIP_FIREWALLD=1
COPANEL_IPTABLES_BIN="$tmpdir/iptables"
COPANEL_IP6TABLES_BIN="$tmpdir/iptables"
COPANEL_UFW_BIN="$tmpdir/iptables"
copanel_configure_firewall
assert_eq "firewalld path does not insert iptables rules" "0" "$(grep -c . "$mock_log" || true)"
rm -rf "$tmpdir"

if [[ "$FAILS" -ne 0 ]]; then
    printf '%s failed\n' "$FAILS" >&2
    exit 1
fi
printf 'all rhel installer checks passed\n'
