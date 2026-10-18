#!/bin/bash
# Installer entrypoints for the security entrance and panel certificate.
# Does not install packages or write /etc/nginx.
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

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

CoPanel_HOME="$tmpdir/opt"
mkdir -p "$CoPanel_HOME"
export COPANEL_SKIP_PUBLIC_IP=1
export COPANEL_PANEL_IP="203.0.113.10"

copanel_entrance_cli ensure
copanel_entrance_cli ensure
token_file="${CoPanel_HOME}/config/security_entrance.json"
token1="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$token_file")"
enabled1="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["enabled"])' "$token_file")"
copanel_entrance_cli ensure
token2="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$token_file")"
assert_eq "ensure keeps the token" "$token1" "$token2"
assert_eq "ensure starts enabled" "True" "$enabled1"
mode="$(stat -c '%a' "$token_file")"
assert_eq "token file is mode 0600" "600" "$mode"

copanel_entrance_cli ensure-cert
key_file="${CoPanel_HOME}/config/ssl/panel.key"
crt_file="${CoPanel_HOME}/config/ssl/panel.crt"
sum1="$(sha256sum "$key_file" | awk '{print $1}')"
copanel_entrance_cli ensure-cert
sum2="$(sha256sum "$key_file" | awk '{print $1}')"
assert_eq "certificate key is kept on reinstall" "$sum1" "$sum2"
key_mode="$(stat -c '%a' "$key_file")"
assert_eq "panel key is mode 0600" "600" "$key_mode"
test -s "$crt_file"

nginx_file="$tmpdir/copanel.conf"
cat > "$nginx_file" << 'EOF'
server {
    listen 8686 ssl;
    listen [::]:8686 ssl;
    server_name _;
    ssl_certificate     /tmp/panel.crt;
    ssl_certificate_key /tmp/panel.key;
    error_page 497 =301 https://$host:$server_port$request_uri;
    location / {
        root /opt/copanel/frontend/dist;
    }
    location /api/ {
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location /phpmyadmin {
        root /usr/share/;
    }
    location /health {
        proxy_pass http://127.0.0.1:8000;
    }
}
EOF

copanel_entrance_cli apply-nginx "$nginx_file"
cp "$nginx_file" "$tmpdir/once.conf"
copanel_entrance_cli apply-nginx "$nginx_file"
if cmp -s "$nginx_file" "$tmpdir/once.conf"; then
    printf 'ok  %s\n' "apply-nginx is idempotent"
else
    printf 'FAIL %s\n' "apply-nginx is idempotent" >&2
    FAILS=$((FAILS + 1))
fi
grep -q "$token1" "$nginx_file"
grep -q "error_page 497" "$nginx_file"
grep -q "location /phpmyadmin" "$nginx_file"
grep -q 'proxy_set_header Upgrade' "$nginx_file"

# Disable must not require the host nginx, and a later ensure must not turn it back on.
copanel_entrance_cli disable --nginx "$nginx_file" --no-reload
enabled_off="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["enabled"])' "$token_file")"
assert_eq "disable keeps the file but turns enforcement off" "False" "$enabled_off"
token_off="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$token_file")"
assert_eq "disable keeps the token" "$token1" "$token_off"
copanel_entrance_cli ensure
token_after="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$token_file")"
enabled_after="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["enabled"])' "$token_file")"
assert_eq "reinstall ensure keeps a disabled entrance" "False" "$enabled_after"
assert_eq "reinstall ensure keeps the disabled token" "$token_off" "$token_after"

url="$(copanel_entrance_cli --host 203.0.113.10 show --url-only)"
assert_eq "show prints the full https entrance url" "https://203.0.113.10:8686/${token_after}/" "$url"

conf="$(mktemp)"
printf '%s\n' '    listen 8686 ssl;' '    listen [::]:8686 ssl;' > "$conf"
COPANEL_NGINX_FORCE_NO_IPV6=1
copanel_strip_nginx_ipv6_if_needed "$conf"
if grep -q '\[::\]' "$conf"; then
    printf 'FAIL %s\n' "ipv6 ssl listen removed" >&2
    FAILS=$((FAILS + 1))
else
    printf 'ok  %s\n' "ipv6 ssl listen removed"
fi
if grep -q 'listen 8686 ssl;' "$conf"; then
    printf 'ok  %s\n' "ipv4 ssl listen kept"
else
    printf 'FAIL %s\n' "ipv4 ssl listen kept" >&2
    FAILS=$((FAILS + 1))
fi
rm -f "$conf"

if [[ "$FAILS" -ne 0 ]]; then
    printf '%s failure(s)\n' "$FAILS" >&2
    exit 1
fi
printf 'security entrance installer checks passed\n'
