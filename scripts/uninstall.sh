#!/bin/bash

###############################################################################
# CoPanel Uninstallation Script
# Removes CoPanel, Nginx configuration, and Systemd service.
#
# Usage: sudo bash uninstall.sh
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CoPanel_USER="copanel"
CoPanel_HOME="/opt/copanel"
NGINX_CONF="/etc/nginx/sites-available/copanel"
NGINX_ENABLED="/etc/nginx/sites-enabled/copanel"

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Ensure script is run as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root. Please use sudo." 
   exit 1
fi

echo ""
echo "    ╔═══════════════════════════════════════════════════════════════╗"
echo "    ║   CoPanel - Complete Uninstallation Script                    ║"
echo "    ╚═══════════════════════════════════════════════════════════════╝"
echo ""

# 1. Stopping and disabling Systemd service
if systemctl is-active --quiet copanel; then
    log_info "Stopping CoPanel service..."
    systemctl stop copanel
fi

if systemctl is-enabled --quiet copanel; then
    log_info "Disabling CoPanel service..."
    systemctl disable copanel
fi

if [[ -f /etc/systemd/system/copanel.service ]]; then
    log_info "Removing Systemd service file..."
    rm -f /etc/systemd/system/copanel.service
    systemctl daemon-reload
    log_success "Systemd service removed"
fi

# 2. Removing Nginx configuration
if [[ -f "$NGINX_ENABLED" ]]; then
    log_info "Removing Nginx symlink from sites-enabled..."
    rm -f "$NGINX_ENABLED"
fi

if [[ -f "$NGINX_CONF" ]]; then
    log_info "Removing Nginx configuration file..."
    rm -f "$NGINX_CONF"
    
    # Reload Nginx
    if command -v nginx &>/dev/null; then
        nginx -t &>/dev/null && systemctl reload nginx
        log_success "Nginx proxy configuration removed and reloaded"
    fi
fi

# 3. Removing directories
if [[ -d "$CoPanel_HOME" ]]; then
    log_info "Deleting installation folder: $CoPanel_HOME..."
    rm -rf "$CoPanel_HOME"
    log_success "Installation folder deleted"
fi

# 4. Deleting service user
if id "$CoPanel_USER" &>/dev/null; then
    log_info "Removing user: $CoPanel_USER..."
    userdel "$CoPanel_USER" || true
    log_success "User removed"
fi

echo ""
log_success "CoPanel has been completely uninstalled from this server! ✓"
echo ""
