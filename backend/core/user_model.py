"""
CoPanel Users & Security - SQLite Persistence Layer
Handles roles, permissions, and folder isolation for users.
"""
import sqlite3
import json
from pathlib import Path
from typing import Optional, List, Dict, Any
from .security import hash_password

if Path("/opt/copanel").exists():
    DB_PATH = Path("/opt/copanel/config/copanel.db")
    PWD_PATH = Path("/opt/copanel/config/admin_password.txt")
else:
    DB_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "copanel.db"
    PWD_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "admin_password.txt"


def get_db_connection():
    """Establishes and returns a connection to the SQLite database."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
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
        PWD_PATH.parent.mkdir(parents=True, exist_ok=True)
        PWD_PATH.write_text(random_pass)
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
            
            PWD_PATH.parent.mkdir(parents=True, exist_ok=True)
            PWD_PATH.write_text(random_pass)
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
    """Updates the password hash for a user."""
    conn = get_db_connection()
    cursor = conn.cursor()
    pwd_hash = hash_password(new_password_plain)
    cursor.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (pwd_hash, user_id)
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


# Call DB Initialization on load
init_db()
