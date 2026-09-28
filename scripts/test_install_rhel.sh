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
    unset COPANEL_OS_ID COPANEL_OS_ID_LIKE COPANEL_OS_VERSION_ID COPANEL_NGINX_LAYOUT \
        COPANEL_NGINX_FORCE_NO_IPV6 COPANEL_NGINX_FORCE_IPV6 \
        COPANEL_ASSUME_FIREWALLD COPANEL_SKIP_FIREWALLD \
        COPANEL_UFW_BIN COPANEL_IPTABLES_BIN COPANEL_IP6TABLES_BIN \
        COPANEL_IPTABLES_RULES_V4 COPANEL_IPTABLES_RULES_V6 \
        COPANEL_SKIP_FIREWALL_PERSIST \
        COPANEL_KERNEL_RELEASE COPANEL_RPM_MGR COPANEL_RPM_QUERY_BIN \
        COPANEL_MODPROBE_BIN COPANEL_MODULES_LOAD_FILE || true
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
assert_eq "almalinux docker method" "el-repo" "$(copanel_docker_install_method)"

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

reset_env
COPANEL_OS_VERSION_ID=10.2
assert_eq "Alma 10.2 major is 10" "10" "$(copanel_el_major)"
repo="$(mktemp)"
copanel_write_docker_el_repo centos "$repo"
assert_true "docker repo uses CentOS EL10" grep -Fq 'https://download.docker.com/linux/centos/10/$basearch/stable' "$repo"
assert_false "docker repo does not use the empty Rocky 10 path" grep -q '/rocky/' "$repo"
rm -f "$repo"

reset_env
nomatch="$(mktemp)"
cat > "$nomatch" << 'EOF'
#!/bin/bash
echo "No match for argument: docker-ce" >&2
echo "Error: Unable to find a match: docker-ce docker-ce-cli" >&2
exit 1
EOF
chmod +x "$nomatch"
rc=0
copanel_install_docker_pkgs "$nomatch" || rc=$?
assert_eq "missing docker-ce is not a package conflict" "2" "$rc"
rm -f "$nomatch"

reset_env
conflict_log="$(mktemp)"
conflict="$(mktemp)"
cat > "$conflict" << EOF
#!/bin/bash
if [[ "\$*" == *allowerasing* ]]; then
  echo allowerasing >> "$conflict_log"
  exit 0
fi
echo "package docker-ce conflicts with podman-docker" >&2
exit 1
EOF
chmod +x "$conflict"
rc=0
copanel_install_docker_pkgs "$conflict" || rc=$?
assert_eq "real conflict retries and succeeds" "0" "$rc"
assert_true "conflict path uses allowerasing" grep -qx allowerasing "$conflict_log"
rm -f "$conflict" "$conflict_log"

reset_env
moddir="$(mktemp -d)"
dnf_log="$moddir/dnf"
probe_log="$moddir/modprobe"
: > "$dnf_log"
: > "$probe_log"
cat > "$moddir/dnf" << EOF
#!/bin/bash
printf '%s\n' "\$*" >> "$dnf_log"
exit 0
EOF
cat > "$moddir/modprobe" << EOF
#!/bin/bash
printf '%s\n' "\$*" >> "$probe_log"
exit 0
EOF
cat > "$moddir/rpmq" << 'EOF'
#!/bin/bash
exit 1
EOF
chmod +x "$moddir/dnf" "$moddir/modprobe" "$moddir/rpmq"
COPANEL_OS_ID=almalinux
COPANEL_OS_ID_LIKE="rhel centos fedora"
COPANEL_KERNEL_RELEASE="6.12.0-55.el10_2.x86_64"
COPANEL_RPM_MGR="$moddir/dnf"
COPANEL_RPM_QUERY_BIN="$moddir/rpmq"
COPANEL_MODPROBE_BIN="$moddir/modprobe"
COPANEL_MODULES_LOAD_FILE="$moddir/copanel-docker.conf"
copanel_prepare_docker_network_modules
assert_true "installs kernel-modules-extra for the running kernel" grep -qx 'install -y kernel-modules-extra-6.12.0-55.el10_2.x86_64' "$dnf_log"
assert_false "unversioned kernel-modules-extra is not requested" grep -qx 'install -y kernel-modules-extra' "$dnf_log"
assert_true "module list contains xt_addrtype" grep -qx xt_addrtype "$moddir/copanel-docker.conf"
assert_true "loads xt_addrtype" grep -qx xt_addrtype "$probe_log"
rm -rf "$moddir"

reset_env
moddir="$(mktemp -d)"
dnf_log="$moddir/dnf"
: > "$dnf_log"
cat > "$moddir/dnf" << EOF
#!/bin/bash
printf '%s\n' "\$*" >> "$dnf_log"
if [[ "\$*" == *kernel-modules-extra* ]]; then
  echo "No match for argument: \$*" >&2
  exit 1
fi
exit 0
EOF
chmod +x "$moddir/dnf"
COPANEL_OS_ID=almalinux
COPANEL_KERNEL_RELEASE="6.12.0-55.el10_2.x86_64"
COPANEL_RPM_MGR="$moddir/dnf"
COPANEL_RPM_QUERY_BIN="$moddir/rpmq"
COPANEL_MODULES_LOAD_FILE="$moddir/copanel-docker.conf"
# rpmq from the previous case was removed; missing query means "not installed"
cat > "$moddir/rpmq" << 'EOF'
#!/bin/bash
exit 1
EOF
chmod +x "$moddir/rpmq"
warn="$(copanel_prepare_docker_network_modules 2>&1 || true)"
assert_true "missing running-kernel modules ask for a reboot" grep -q 'Reboot onto a kernel' <<<"$warn"
rm -rf "$moddir"

reset_env
moddir="$(mktemp -d)"
cat > "$moddir/rpmq" << 'EOF'
#!/bin/bash
[[ "$1" == kernel-modules-extra-* ]]
EOF
chmod +x "$moddir/rpmq"
COPANEL_OS_ID=almalinux
COPANEL_KERNEL_RELEASE="6.12.0-55.el10_2.x86_64"
COPANEL_RPM_QUERY_BIN="$moddir/rpmq"
argv_line=""
copanel_docker_pkg_argv _docker_argv
argv_line="${_docker_argv[*]}"
assert_true "docker install excludes a newer kernel" grep -q -- '--exclude=kernel-core' <<<"$argv_line"
rm -rf "$moddir"
unset _docker_argv

reset_env
COPANEL_OS_ID=ubuntu
COPANEL_OS_ID_LIKE=debian
COPANEL_KERNEL_RELEASE="6.8.0-generic"
copanel_docker_pkg_argv _docker_argv
argv_line="${_docker_argv[*]}"
assert_false "ubuntu docker install does not exclude kernel packages" grep -q -- '--exclude=kernel' <<<"$argv_line"
unset _docker_argv

reset_env
saved_command_exists="$(declare -f command_exists)"
command_exists() {
    case "$1" in
        runuser|sudo) return 1 ;;
        *) return 1 ;;
    esac
}
assert_eq "debian without sudo uses su" "su" "$(copanel_run_as_tool)"
command_exists() {
    [[ "$1" == "sudo" ]]
}
assert_eq "sudo is the fallback when runuser is missing" "sudo" "$(copanel_run_as_tool)"
eval "$saved_command_exists"

reset_env
asdir="$(mktemp -d)"
cat > "$asdir/runuser" << 'EOF'
#!/bin/bash
printf '%s\n' "$*" > "$COPANEL_RUN_AS_LOG"
exit 0
EOF
chmod +x "$asdir/runuser"
export COPANEL_RUN_AS_LOG="$asdir/log"
COPANEL_RUN_AS_TOOL=runuser
PATH="$asdir:$PATH" copanel_run_as copanel env ADMIN_PASSWORD=secret /usr/bin/python3 -c 'init'
assert_eq "runuser keeps the password env assignment" "-u copanel -- env ADMIN_PASSWORD=secret /usr/bin/python3 -c init" "$(cat "$COPANEL_RUN_AS_LOG")"
unset COPANEL_RUN_AS_TOOL COPANEL_RUN_AS_LOG
rm -rf "$asdir"

reset_env
nodedir="$(mktemp -d)"
cat > "$nodedir/node" << 'EOF'
#!/bin/bash
[[ "$1" == "-p" ]] && printf '18\n'
EOF
chmod +x "$nodedir/node"
assert_eq "node 18 major" "18" "$(PATH="$nodedir:$PATH" copanel_node_major)"
if PATH="$nodedir:$PATH" copanel_node_meets_lts; then
    printf 'FAIL node 18 should not count as Node 20\n' >&2
    FAILS=$((FAILS + 1))
else
    printf 'ok  node 18 is not Node 20 LTS\n'
fi
rm -rf "$nodedir"

reset_env
pipe_help="$(bash -s -- --help < "$ROOT/scripts/install.sh" 2>/dev/null || true)"
assert_true "curl | bash still runs the installer" grep -q 'Usage:' <<<"$pipe_help"
assert_true "help documents the AlmaLinux file install" grep -q 'AlmaLinux' <<<"$pipe_help"
assert_true "help documents Debian without sudo" grep -q 'apt install -y curl ca-certificates' <<<"$pipe_help"

if [[ "$FAILS" -ne 0 ]]; then
    printf '%s failed\n' "$FAILS" >&2
    exit 1
fi
printf 'all rhel installer checks passed\n'
