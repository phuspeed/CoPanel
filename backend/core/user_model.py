"""
CoPanel Users & Security - SQLite Persistence Layer
Handles roles, permissions, and folder isolation for users.
"""
import sqlite3
import json
from typing import Optional, List, Dict, Any
from .paths import config_dir, write_private_text
from .security import hash_password, verify_password


def db_path():
    """SQLite user database. Honors ``COPANEL_TEST_CONFIG_DIR``."""
    return config_dir() / "copanel.db"


def pwd_path():
    """Plaintext superadmin password file written for the installer."""
    return config_dir() / "admin_password.txt"


def get_db_connection():
    """Establishes and returns a connection to the SQLite database."""
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Creates the users table and seeds a SuperAdmin account if empty."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        permitted_modules TEXT NOT NULL DEFAULT '[]',
        permitted_folders TEXT NOT NULL DEFAULT '[]'
    );
    """)
    conn.commit()
    _migrate_user_totp_columns(conn)
    _migrate_user_token_version(conn)

    import os
    env_admin_pass = os.environ.get("ADMIN_PASSWORD")
    if env_admin_pass:
        cursor.execute("SELECT id, password_hash FROM users WHERE username = 'admin' OR role = 'superadmin';")
        admin_row = cursor.fetchone()
        if admin_row:
            if not verify_password(env_admin_pass, admin_row["password_hash"]):
                admin_pass_hash = hash_password(env_admin_pass)
                cursor.execute(
                    "UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?",
                    (admin_pass_hash, admin_row["id"])
                )
                conn.commit()
                write_private_text(pwd_path(), env_admin_pass)
        else:
            admin_pass_hash = hash_password(env_admin_pass)
            cursor.execute(
                "INSERT INTO users (username, password_hash, role, permitted_modules, permitted_folders) VALUES (?, ?, ?, ?, ?)",
                ("admin", admin_pass_hash, "superadmin", "[\"all\"]", "[\"/\"]")
            )
            conn.commit()
            write_private_text(pwd_path(), env_admin_pass)
        conn.close()
        return

    # Seed default superadmin
    cursor.execute("SELECT id, username, password_hash FROM users WHERE role = 'superadmin';")
    rows = cursor.fetchall()
    
    import secrets
    import string
    alphabet = string.ascii_letters + string.digits
    
    if len(rows) == 0:
        random_pass = ''.join(secrets.choice(alphabet) for i in range(12))
        admin_pass_hash = hash_password(random_pass)
        cursor.execute(
            "INSERT INTO users (username, password_hash, role, permitted_modules, permitted_folders) VALUES (?, ?, ?, ?, ?)",
            ("admin", admin_pass_hash, "superadmin", "[\"all\"]", "[\"/\"]")
        )
        conn.commit()
        
        # Write plaintext password to file for installer/admin usage
        write_private_text(pwd_path(), random_pass)
    else:
        admin_row = rows[0]
        p_hash = admin_row["password_hash"]
        # If legacy passlib or invalid, reset it to random and update password file
        if not (p_hash.startswith("$2b$") or p_hash.startswith("$2a$")):
            random_pass = ''.join(secrets.choice(alphabet) for i in range(12))
            admin_pass_hash = hash_password(random_pass)
            cursor.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (admin_pass_hash, admin_row["id"])
            )
            conn.commit()
            
            write_private_text(pwd_path(), random_pass)
    conn.close()


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """Fetches a user profile from the database by username."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Fetches a user profile from the database by user ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def get_all_users() -> List[Dict[str, Any]]:
    """Returns a list of all user profiles."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, role, permitted_modules, permitted_folders FROM users")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_user(username: str, password_plain: str, role: str, permitted_modules: str, permitted_folders: str) -> int:
    """Creates and inserts a new user into the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    pwd_hash = hash_password(password_plain)
    try:
        cursor.execute(
            "INSERT INTO users (username, password_hash, role, permitted_modules, permitted_folders) VALUES (?, ?, ?, ?, ?)",
            (username, pwd_hash, role, permitted_modules, permitted_folders)
        )
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id
    except sqlite3.IntegrityError:
        conn.close()
        raise ValueError(f"Username '{username}' already exists.")


def update_user(user_id: int, role: str, permitted_modules: str, permitted_folders: str) -> bool:
    """Updates the permissions and role for a user."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET role = ?, permitted_modules = ?, permitted_folders = ? WHERE id = ?",
        (role, permitted_modules, permitted_folders, user_id)
    )
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0


def change_password(user_id: int, new_password_plain: str) -> bool:
    """Updates the password hash for a user and invalidates existing tokens."""
    user = get_user_by_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    pwd_hash = hash_password(new_password_plain)
    cursor.execute(
        "UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?",
        (pwd_hash, user_id)
    )
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    if rows_affected > 0 and user and user.get("role") == "superadmin":
        write_private_text(pwd_path(), new_password_plain)
    return rows_affected > 0


def bump_token_version(user_id: int) -> bool:
    """Invalidate every JWT issued for this user (logout-all)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?",
        (user_id,),
    )
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0


def delete_user(user_id: int) -> bool:
    """Removes a user from the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0


def _migrate_user_token_version(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in cursor.fetchall()}
    if "token_version" not in cols:
        cursor.execute(
            "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"
        )
    conn.commit()


def _migrate_user_totp_columns(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in cursor.fetchall()}
    if "totp_secret" not in cols:
        cursor.execute("ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT ''")
    if "totp_pending" not in cols:
        cursor.execute("ALTER TABLE users ADD COLUMN totp_pending TEXT NOT NULL DEFAULT ''")
    if "totp_enabled" not in cols:
        cursor.execute("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def set_totp_pending(user_id: int, secret: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET totp_pending = ? WHERE id = ?",
        (secret, user_id),
    )
    conn.commit()
    ok = cursor.rowcount > 0
    conn.close()
    return ok


def enable_totp(user_id: int, secret: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET totp_secret = ?, totp_pending = '', totp_enabled = 1 WHERE id = ?",
        (secret, user_id),
    )
    conn.commit()
    ok = cursor.rowcount > 0
    conn.close()
    return ok


def disable_totp(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET totp_secret = '', totp_pending = '', totp_enabled = 0 WHERE id = ?",
        (user_id,),
    )
    conn.commit()
    ok = cursor.rowcount > 0
    conn.close()
    return ok


def change_admin_password(new_password: str) -> bool:
    """Changes the superadmin password directly in the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    pwd_hash = hash_password(new_password)
    cursor.execute(
        "UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 "
        "WHERE username = 'admin' OR role = 'superadmin'",
        (pwd_hash,),
    )
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()

    write_private_text(pwd_path(), new_password)
    return rows_affected > 0


# Call DB Initialization on load
init_db()
