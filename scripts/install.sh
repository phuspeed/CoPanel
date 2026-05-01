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

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
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
            2>&1 | grep -v "^Reading state\|^Building\|^Setting up" || true
        
    elif command_exists yum; then
        yum install -y \
            python3 python3-pip \
            nginx \
            curl wget git \
            gcc gcc-c++ make \
            nodejs npm \
            2>&1 | grep -v "^Loaded plugins\|^Resolving\|^Running" || true
    else
        log_error "Unsupported package manager"
        exit 1
    fi
    
    log_success "Dependencies installed"
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
    
    # Ensure directory exists with correct permissions
    if [[ ! -d "$CoPanel_HOME" ]]; then
        mkdir -p "$CoPanel_HOME"
    fi
    
    # Stop service if it's currently running to prevent text file busy errors
    if systemctl is-active --quiet copanel; then
        log_info "Stopping active CoPanel service for installation..."
        systemctl stop copanel || true
    fi

    # Sync files from REPO_DIR to CoPanel_HOME if different
    if [[ "$REPO_DIR" != "$CoPanel_HOME" ]]; then
        log_info "Copying project files from $REPO_DIR to $CoPanel_HOME..."
        cp -a "$REPO_DIR"/. "