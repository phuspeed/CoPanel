"""Test bootstrap: ensure ``backend/`` is on sys.path and isolate the SQLite
database so tests do not touch ``/opt/copanel`` or ``config/copanel.db``.
"""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TMP_CONFIG = Path(tempfile.mkdtemp(prefix="copanel-tests-"))
os.environ.setdefault("COPANEL_DISABLE_AUTH", "1")
os.environ["COPANEL_TEST_CONFIG_DIR"] = str(_TMP_CONFIG)
