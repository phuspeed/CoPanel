"""
SSL Manager Logic Layer
Handles Let's Encrypt / Certbot and custom private keys for Nginx virtual hosts.
"""
import os
import shutil
import subprocess
from pathlib import Path
from typing import List, Dict, Any

IS_WINDOWS = os.name == 'nt'

class SSLManager:
    @staticmethod
    def get_cert_expiry(cert_path: Path) -> str:
        """Read fullchain.pem to get expiration date string."""
        if not cert_path.exists():
            return "N/A"
        try:
            # Use openssl command to read expiration date
            res = subprocess.run(["openssl", "x509", "-enddate", "-noout", "-in", str(cert_path)], capture_output=True, text=True)
            if res.returncode == 0:
                line = res.stdout.strip()
                if "notAfter=" in line:
                    return line.split("notAfter=")[1].strip()
        except Exception:
            pass
        return "N/A"

    @staticmethod
    def extract_domains_from_nginx(file_path: Path) -> List[str]:
        """Read Nginx configuration and return list of domain names found in server_name."""
        if not file_path.exists():
            return []
        extracted = []
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            # Extract server_names
            import re
            server_names = re.findall(r'server_name\s+([^;]+);', content)
            for names in server_names:
                for name in names.split():
                    name = name.strip().lower()
                    if name and name not in ["default", "localhost", "copanel"] and not name.startswith("_"):
                        extracted.append(name)
        except Exception:
            pass

        # Fallback: file name without .conf extension
        fname = file_path.name
        if fname.endswith(".conf"):
            fname = fname[:-5]
        if fname not in extracted and fname not in ["default", "copanel"]:
            extracted.append(fname)

        return extracted

    @staticmethod
    def get_certificates() -> List[Dict[str, Any]]:
        """List all domains and their active SSL certificates."""
        domains = set()

        # Find all domains from sites-available
        sites_dir = Path("/etc/nginx/sites-available") if not IS_WINDOWS else Path("./test_nginx/sites-available")
        if sites_dir.exists():
            for file in sites_dir.iterdir():
                if file.is_file() and file.name not in ["default", "copanel"]:
                    for d in SSLManager.extract_domains_from_nginx(file):
                        domains.add(d)

        # Find all domains from /etc/letsencrypt/live
        le_dir = Path("/etc/letsencrypt/live") if not IS_WINDOWS else Path("./test_nginx/letsencrypt/live")
        if le_dir.exists():
            for d_dir in le_dir.iterdir():
                if d_dir.is_dir() and d_dir.name not in ["README", ".git"]:
                    domains.add(d_dir.name.strip().lower())

        results = []
        for domain in domains:
            cert_path_letsencrypt = Path(f"/etc/letsencrypt/live/{domain}/fullchain.pem") if not IS_WINDOWS else Path(f"./test_nginx/letsencrypt/live/{domain}/fullchain.pem")
            cert_path_custom = Path(f"/etc/nginx/ssl/{domain}/fullchain.pem") if not IS_WINDOWS else Path(f"./test_nginx/ssl/{domain}/fullchain.pem")

            ssl_active = False
            ssl_type = "None"
            expiry = "N/A"

            # Check LetsEncrypt
            if cert_path_letsencrypt.exists():
                ssl_active = True
                ssl_type = "Let's Encrypt"
                expiry = SSLManager.get_cert_expiry(cert_path_letsencrypt)
            # Check Custom
            elif cert_path_custom.exists():
                ssl_active = True
                ssl_type = "Custom"
                expiry = SSLManager.get_cert_expiry(cert_path_custom)

            results.append({
                "domain": domain,
                "active": ssl_active,
                "type": ssl_type,
                "expiry": expiry
            })

        return results

    @staticmethod
    def renew_certificates() -> dict:
        """Renew all Let's Encrypt certificates using Certbot renew."""
        if IS_WINDOWS:
            return {"status": "success", "message": "All Let's Encrypt certificates successfully renewed (Mock Mode)."}

        if not shutil.which("certbot"):
            return {"status": "error", "message": "Certbot CLI is not installed on this server."}

        try:
            # Run certbot renew
            res = subprocess.run(["sudo", "certbot", "renew", "--non-interactive"], capture_output=True, text=True)
            if res.returncode != 0:
                return {"status": "error", "message": f"Certbot renewal failed: {res.stderr or res.stdout}"}

            # Reload Nginx after a successful renewal
            if shutil.which("nginx"):
                subprocess.run(["nginx", "-t"], shell=False, capture_output=True)
                subprocess.run(["systemctl", "reload", "nginx"], shell=False, capture_output=True)

            return {"status": "success", "message": "All Let's Encrypt certificates successfully renewed and Nginx reloaded."}
        except Exception as e:
            return {"status": "error", "message": str(e)}


    @staticmethod
    def issue_certbot(domain: str, email: str) -> dict:
        """Runs certbot CLI to issue a Let's Encrypt certificate for the target domain."""
        if IS_WINDOWS:
            return {"status": "success", "message": f"Issued Let's Encrypt SSL for {domain} (Mock Mode)."}

        # 1. Ensure certbot is installed
        if not shutil.which("certbot"):
            return {"status": "error", "message": "Certbot CLI is not installed on this server."}

        try:
            # Generate cert via certbot
            cmd = [
                "sudo", "certbot", "certonly", "--nginx",
                "-d", domain,
                "-m", email,
                "--agree-tos", "--non-interactive"
            ]
            res = subprocess.run(cmd, shell=False, capture_output=True, text=True)
            if res.returncode != 0:
                return {"status": "error", "message": f"Certbot execution failed: {res.stderr or res.stdout}"}

            # 2. Add to Nginx vhost
            cert_path = f"/etc/letsencrypt/live/{domain}/fullchain.pem"
            key_path = f"/etc/letsencrypt/live/{domain}/privkey.pem"
            SSLManager.enable_ssl_in_nginx_vhost(domain, cert_path, key_path)

            return {"status": "success", "message": f"Certbot issued certificate for {domain} and configured Nginx successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def install_custom_ssl(domain: str, private_key: str, certificate: str) -> dict:
        """Saves custom pasted certificates and private key files and updates Nginx configuration."""
        if not domain or not private_key or not certificate:
            return {"status": "error", "message": "Domain, Private Key, and Certificate are required fields."}

        ssl_dir = Path(f"/etc/nginx/ssl/{domain}") if not IS_WINDOWS else Path(f"./test_nginx/ssl/{domain}")
        ssl_dir.mkdir(parents=True, exist_ok=True)

        try:
            fullchain_file = ssl_dir / "fullchain.pem"
            privkey_file = ssl_dir / "privkey.pem"

            fullchain_file.write_text(certificate.strip(), encoding="utf-8")
            privkey_file.write_text(private_key.strip(), encoding="utf-8")

            # Update Nginx
            SSLManager.enable_ssl_in_nginx_vhost(domain, str(fullchain_file), str(privkey_file))

            return {"status": "success", "message": f"Custom SSL installed successfully for {domain}."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def enable_ssl_in_nginx_vhost(domain: str, cert_path: str, key_path: str):
        vhost_path = Path(f"/etc/nginx/sites-available/{domain}") if not IS_WINDOWS else Path(f"./test_nginx/sites-available/{domain}")
        if not vhost_path.exists():
            return

        content = vhost_path.read_text(encoding="utf-8")

        # If already has 443 ssl listener, don't duplicate
        if "listen 443 ssl;" in content:
            return

        import re
        ssl_directives = f"listen 443 ssl;\n    ssl_certificate {cert_path};\n    ssl_certificate_key {key_path};\n    ssl_protocols TLSv1.2 TLSv1.3;\n    ssl_prefer_server_ciphers on;"

        # Replace 'listen 80;' or similar listen directive
        if re.search(r'listen\s+[^;]+;', content):
            content = re.sub(r'listen\s+[^;]+;', ssl_directives, content, count=1)
        else:
            if f"server_name {domain};" in content:
                content = content.replace(f"server_name {domain};", f"server_name {domain};\n    {ssl_directives}")
            elif "server_name" in content:
                lines = content.splitlines()
                for idx, line in enumerate(lines):
                    if "server_name" in line:
                        lines[idx] = line + "\n    " + ssl_directives
                        break
                content = "\n".join(lines)

        # Now append the HTTP redirect block to the file
        redirect_block = f"\n\nserver {{\n    listen 80;\n    server_name {domain};\n    return 301 https://$host$request_uri;\n}}\n"
        content += redirect_block

        vhost_path.write_text(content, encoding="utf-8")

        if not IS_WINDOWS:
            # Reload Nginx
            if shutil.which("nginx"):
                subprocess.run(["nginx", "-t"], shell=False, capture_output=True)
                subprocess.run(["systemctl", "reload", "nginx"], shell=False, capture_output=True)
