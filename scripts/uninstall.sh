#!/bin/bash

###############################################################################
# CoPanel Uninstallation Script
# Removes CoPanel, Nginx configuration, and Systemd service.
#
# Usage: sudo bash uninstall.sh
###############################################################################

set -e

# Colors for output
RED=$(echo -e '\033[0;31m')
GREEN=$(echo -e '\033[0;32m')
YELLOW=$(echo -e '\033[1;33m')
BLUE=$(echo -e '\033[0;34m')
NC=$(echo -e '\033[0m') # No Color

# Configuration
CoPanel_USER="copanel"
CoPanel_HOME="/opt/copanel"
NGINX_CONF="/etc/nginx/sites-available/copanel"
NGINX_ENABLED="/etc/nginx/sites-enabled/copanel"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[ OK ]${NC} $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Ensure script is run as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root. Please use sudo." 
   exit 1
fi

echo ""
echo "    ╔═══════════════════════════════════════════════════════════════╗"
echo "    ║   CoPanel - Uninstallation Script                             ║"
echo "    ╚═══════════════════════════════════════════════════════════════╝"
echo ""

echo -e "${YELLOW}Please select uninstallation mode:${NC}"
echo "1) Safe Uninstall (Only remove CoPanel and its UI - Keeps websites, Nginx, Docker & user data intact) [Recommended]"
echo "2) Complete Purge (Remove everything - CoPanel, system-wide Nginx, Docker, and all associated user files)"
echo ""
read -p "Enter your choice (1 or 2, default: 1): " UNINSTALL_MODE < /dev/tty
UNINSTALL_MODE=${UNINSTALL_MODE:-1}

echo ""

if [[ "$UNINSTALL_MODE" == "2" ]]; then
    log_warning "CAUTION: This mode will completely purge Nginx, Docker, and delete all user data."
    read -p "Are you absolutely sure you want to completely wipe out everything? (yes/no): " CONFIRM_PURGE < /dev/tty
    if [[ "$CONFIRM_PURGE" != "yes" ]]; then
        log_info "Reverting back to Safe Uninstall mode."
        UNINSTALL_MODE=1
    fi
fi

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
    
    # Reload Nginx if it still exists
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

# 5. Full purge: purge OS packages if requested
if [[ "$UNINSTALL_MODE" == "2" ]]; then
    log_info "Purging OS packages (Nginx, Docker)..."
    
    if command -v apt-get &>/dev/null; then
        apt-get purge -y nginx docker-ce docker-ce-cli containerd.io || true
        apt-get autoremove -y || true
        log_success "System-wide packages (Nginx, Docker) purged successfully"
    elif command -v yum &>/dev/null; then
        yum remove -y nginx docker-ce docker-ce-cli containerd.io || true
        log_success "System-wide packages (Nginx, Docker) purged successfully"
    fi
fi

echo ""
log_success "CoPanel has been successfully uninstalled from this server! ✓"
echo ""
