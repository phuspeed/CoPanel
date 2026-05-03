import os
import subprocess
from typing import List, Dict, Any

IS_WINDOWS = os.name == 'nt'

# Define standard PHP versions and modules
PHP_VERSIONS = ["8.3", "8.2", "8.1", "8.0", "7.4"]
DEFAULT_MODULES = ["mysqli", "curl", "mbstring", "gd", "zip", "xml", "redis", "intl", "soap", "bcmath"]

def get_php_versions() -> List[str]:
    """Retrieves supported PHP versions on this server."""
    if IS_WINDOWS:
        return PHP_VERSIONS
    
    installed = []
    for v in PHP_VERSIONS:
        if os.path.exists(f"/run/php/php{v}-fpm.sock") or os.path.exists(f"/var/run/php/php{v}-fpm.sock"):
            installed.append(v)
    
    return installed if installed else PHP_VERSIONS

def get_php_modules() -> List[str]:
    """Retrieves all standard PHP modules."""
    return DEFAULT_MODULES
