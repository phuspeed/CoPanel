#!/bin/bash
# Installer entrypoints for plain HTTP on 8686 and removal of the secret entrance.
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
mkdir -p "$CoPanel_HOME/config"
export COPANEL_SKIP_PUBLIC_IP=1
export COPANEL_PANEL_IP="203.0.113.10"

token_file="${CoPanel_HOME}/config/security_entrance.json"
printf '%s\n' '{"token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","enabled":true}' > "$token_file"
copanel_entrance_cli ensure
if [[ -f "$token_file" ]]; then
    printf 'FAIL %s\n' "ensure removes the token file" >&2
    FAILS=$((FAILS + 1))
else
    printf 'ok  %s\n' "ensure removes the token file"
fi
copanel_entrance_cli ensure

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
# BEGIN COPANEL SECURITY ENTRANCE
map $uri $copanel_entrance_pass {
    default 0;
}
# END COPANEL SECURITY ENTRANCE
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
    # BEGIN COPANEL SECURITY ENTRANCE SERVER
    location = /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa {
        return 302 /;
    }
    if ($copanel_entrance_pass != 1) {
        return 404;
    }
    # END COPANEL SECURITY ENTRANCE SERVER
}
# BEGIN COPANEL TUNNEL ORIGIN
server {
    listen 127.0.0.1:8687;
    server_name _;
}
# END COPANEL TUNNEL ORIGIN
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
if grep -q 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$nginx_file" || grep -q 'copanel_entrance_pass' "$nginx_file"; then
    printf 'FAIL %s\n' "apply-nginx removes the secret path" >&2
    FAILS=$((FAILS + 1))
else
    printf 'ok  %s\n' "apply-nginx removes the secret path"
fi
if grep -q 'error_page 497' "$nginx_file" || grep -q 'ssl_certificate' "$nginx_file" || grep -q 'ssl' "$nginx_file"; then
    printf 'FAIL %s\n' "apply-nginx restores plain http" >&2
    FAILS=$((FAILS + 1))
else
    printf 'ok  %s\n' "apply-nginx restores plain http"
fi
grep -q "location /phpmyadmin" "$nginx_file"
grep -q 'proxy_set_header Upgrade' "$nginx_file"
grep -q 'listen 8686;' "$nginx_file"
if grep -q '8687' "$nginx_file" || grep -q 'COPANEL TUNNEL ORIGIN' "$nginx_file"; then
    printf 'FAIL %s\n' "apply-nginx removes the loopback tunnel origin" >&2
    FAILS=$((FAILS + 1))
else
    printf 'ok  %s\n' "apply-nginx removes the loopback tunnel origin"
fi

url="$(copanel_entrance_cli --host 203.0.113.10 show --url-only)"
assert_eq "show prints the http panel url" "http://203.0.113.10:8686/" "$url"

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
printf 'panel http installer checks passed\n'
