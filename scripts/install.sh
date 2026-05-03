#!/bin/bash

###############################################################################
# CoPanel Installation Script
# One-click setup for Linux VPS Management Panel
# 
# Usage: sudo bash install.sh
# 
# Features:
# - Python virtual environment setup
# - Nginx reverse proxy configuration (port 8686)
# - Systemd service installation
# - Idempotent (safe to run multiple times)
###############################################################################

set -e  # Exit on error

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

command_exists() {
    command -v "$1" &> /dev/null
}

###############################################################################
# Step 1: System Dependencies
###############################################################################

install_dependencies() {
    log_info "Installing system dependencies..."
    
    # Detect package manager
    if command_exists apt-get; then
        apt-get update
        apt-get install -y \
            python3 python3-pip python3-venv \
            nginx \
            curl wget git \
            build-essential \
            nodejs npm \
            ufw inotify-tools certbot python3-certbot-nginx \
            2>&1 | grep -v "^Reading state\|^Building\|^Setting up" || true
        
    elif command_exists yum; then
        yum install -y \
            python3 python3-pip \
            nginx \
            curl wget git unzip zip \
            gcc gcc-c++ make \
            nodejs npm \
            ufw inotify-tools certbot \
            2>&1 | grep -v "^Loaded plugins\|^Resolving\|^Running" || true
    fi

    # Install Node.js 20 LTS if not installed or older than 18
    if ! command_exists node || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
        log_info "Node.js is missing or version is too old. Installing Node.js 20 LTS via NodeSource..."
        if command_exists apt-get; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || true
            apt-get install -y nodejs || true
        elif command_exists yum; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - || true
            yum install -y nodejs || true
        fi
    fi

    # Install Docker using official Docker convenience script if not installed
    if ! command_e