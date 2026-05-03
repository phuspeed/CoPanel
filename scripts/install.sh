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
    else
        log_error "Unsupported package manager"
        exit 1
    fi

    # Install Docker using official Docker convenience script if not installed
    if ! command_exists docker; then
        log_info "Installing Docker via official installation script..."
        curl -fsSL https://get.docker.com -o install-docker.sh || true
        if [[ -f install-docker.sh ]]; then
            sh install-docker.sh || true
            rm -f install-docker.sh
        fi
    fi

    # Install Rclone using official Rclone convenience script if not installed
    if ! command_exists rclone; then
        log_info "Installing Rclone via official installation script..."
        curl https://rclone.org/install.sh | sudo bash || true
    fi

    # Ensure Docker daemon is started & enabled
    if command_exists systemctl; then
        systemctl start docker || true
        systemctl enable docker || true
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
    
    # Check if running via one-liner (curl/wget), clone from GitHub directly
    if [[ ! -d "$REPO_DIR/backend" ]] || [[ ! -f "$REPO_DIR/backend/main.py" ]]; then
        if [[ -d "$CoPanel_HOME/.git" ]]; then
            log_info "CoPanel already exists with Git repository. Updating codebase..."
            cd "$CoPanel_HOME"
            git fetch --all || true
            git reset --hard origin/main || true
            REPO_DIR="$CoPanel_HOME"
        else
            log_info "No local project directory found. Cloning CoPanel directly from GitHub..."
            # Let's preserve specific data directories/files if they exist
            TEMP_BACKUP=$(mktemp -d)
            if [[ -d "$CoPanel_HOME/backend/data" ]]; then
                cp -a "$CoPanel_HOME/backend/data" "$TEMP_BACKUP/" || true
            fi
            if [[ -f "$CoPanel_HOME/backend/users.json" ]]; then
                cp -a "$CoPanel_HOME/backend/users.json" "$TEMP_BACKUP/" || true
            fi
            if [[ -f "$CoPanel_HOME/config/backup_config.json" ]]; then
                cp -a "$CoPanel_HOME/config/backup_config.json" "$TEMP_BACKUP/" || true
            fi
            # Add any other potential db files
            for db in "$CoPanel_HOME"/backend/*.db; do
                if [[ -f "$db" ]]; then
                    cp -a "$db" "$TEMP_BACKUP/" || true
                fi
            done
            
            rm -rf "$CoPanel_HOME"
            git clone https://github.com/phuspeed/CoPanel.git "$CoPanel_HOME"
            REPO_DIR="$CoPanel_HOME"
            
            # Restore the backed up data if any
            if [[ -d "$TEMP_BACKUP/data" ]]; then
                mkdir -p "$CoPanel_HOME/backend/data"
                cp -a "$TEMP_BACKUP/data"/. "$CoPanel_HOME/backend/data/" || true
            fi
            if [[ -f "$TEMP_BACKUP/users.json" ]]; then
                cp -a "$TEMP_BACKUP/users.json" "$CoPanel_HOME/backend/" || true
            fi
            if [[ -f "$TEMP_BACKUP/backup_config.json" ]]; then
                mkdir -p "$CoPanel_HOME/config"
                cp -a "$TEMP_BACKUP/backup_config.json" "$CoPanel_HOME/config/" || true
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
                "$REPO_DIR/" "$CoPanel_HOME/"
        else
            cp -a "$REPO_DIR"/. "$CoPanel_HOME"/
        fi
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
    
    # Activate venv and install dependencies
    source "$VENV_PATH/bin/activate"
    
    pip install --upgrade pip setuptools wheel >/dev/null 2>&1
    
    if [[ -f "$CoPanel_HOME/backend/requirements.txt" ]]; then
        pip install -r "$CoPanel_HOME/backend/requirements.txt" >/dev/null 2>&1
        log_success "Python dependencies installed"
    fi

    # Pre-initialize database to immediately create initial admin user & password file
    python3 -c "import sys; sys.path.append('$CoPanel_HOME/backend'); from core.user_model import init_db; init_db()"
    
    deactivate
}

###############################################################################
# Step 4: Frontend Setup
###############################################################################

setup_frontend() {
    log_info "Setting up React frontend..."
    
    if [[ -f "$CoPanel_HOME/frontend/package.json" ]]; then
        cd "$CoPanel_HOME/frontend"
        
        # Install dependencies
        log_info "Installing npm packages..."
        npm install
        
        # Build frontend
        log_info "Building frontend..."
        npm run build
        
        log_success "Frontend built and ready"
        cd - >/dev/null
    fi
}

###############################################################################
# Step 5: Nginx Configuration
###############################################################################

setup_nginx() {
    log_info "Configuring Nginx reverse proxy..."
    
    # Create Nginx configuration
    cat > "$NGINX_CONF" << 'EOF'
upstream copanel_backend {
    server 127.0.0.1:8000;
}

upstream php_fpm {
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
    
    # Enable site
    if [[ ! -L "$NGINX_ENABLED" ]]; then
        ln -s "$NGINX_CONF" "$NGINX_ENABLED"
    fi
    
    # Test configuration
    if nginx -t >/dev/null 2>&1; then
        systemctl enable nginx || true
        systemctl restart nginx
        log_success "Nginx configured, enabled, and restarted"
    else
        log_error "Nginx configuration error"
        nginx -t
        exit 1
    fi

    # Open necessary ports if UFW is installed
    if command_v ufw &> /dev/null || command -v ufw &> /dev/null; then
        log_info "Configuring UFW rules for CoPanel..."
        ufw allow 8686/tcp || true
        ufw allow 8000/tcp || true
        ufw allow 22/tcp || true
        ufw allow 80/tcp || true
        ufw allow 443/tcp || true
    fi
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

    cat << EOF

${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}
${GREEN}║          CoPanel Installation Complete! ✓                    ║${NC}
${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}

${BLUE}Installation Summary:${NC}

📍 Initial Admin Password: ${GREEN}${ADMIN_PWD}${NC}
📍 Location:          ${CoPanel_HOME}
👤 Service User:      ${CoPanel_USER}
🌐 Access URL:        http://localhost:${NGINX_PORT}
📊 Backend API:       http://localhost:${BACKEND_PORT}
🔧 Frontend Dev:      http://localhost:${FRONTEND_PORT}

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
2. Access API docs: http://localhost:${BACKEND_PORT}/docs
3. Review logs: journalctl -u copanel -f

${BLUE}Documentation:${NC}

Architecture:         ${CoPanel_HOME}/README.md
Backend Setup:        ${CoPanel_HOME}/backend/README.md
Frontend Setup:       ${CoPanel_HOME}/frontend/README.md

EOF
}

###############################################################################
# Main Execution
###############################################################################

main() {
    clear
    
    echo -e "${PURPLE}${BOLD}"
    cat << 'EOF'
   ______      ____                        __
  / ____/___  / __ \____ _____  ___  / /
 / /   / __ \/ /_/ / __ `/ __ \/ _ \/ / 
/ /___/ /_/ / ____/ /_/ / / / /  __/ /  
\____/\____/_/    \__,_/_/ /_/\___/_/   
EOF
    echo -e "${NC}"
    echo -e "   ${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "   ${CYAN}${BOLD}CoPanel - Advanced Linux VPS Management System${NC}"
    echo -e "   ${BOLD}v1.0.0 - Premium Pluggable Architecture${NC}"
    echo -e "   ${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    check_root
    check_os
    
    log_step "Step 1: Check & Install Dependencies"
    install_dependencies
    
    log_step "Step 2: Setup System Users & Workspaces"
    setup_user_and_dirs
    
    log_step "Step 3: Build & Provision Backend"
    setup_backend
    
    log_step "Step 4: Build & Provision Frontend"
    setup_frontend
    
    log_step "Step 5: Configure Nginx & Firewall"
    setup_nginx
    
    log_step "Step 6: Register Systemd Daemon"
    setup_systemd_service
    
    log_step "Step 7: Launch Panel Engine"
    start_services
    
    log_step "Step 8: System Readiness Checklist"
    verify_installation
    
    echo ""
    print_summary
}

# Run main installation
main "$@"