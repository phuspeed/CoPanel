#!/usr/bin/env python3
"""Migrate module index.tsx from useOutletContext to dual-UI compat layer."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "modules"

COMPAT_IMPORT = """import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
"""

FILES = [
    "ssl_manager/index.tsx",
    "firewall/index.tsx",
    "package_manager/index.tsx",
    "system_cleaner/index.tsx",
    "docker_manager/index.tsx",
    "panel_settings/index.tsx",
    "web_manager/index.tsx",
    "backup_manager/index.tsx",
    "terminal/index.tsx",
    "system_monitor/index.tsx",
]


def strip_outlet_import(text: str) -> str:
    text = re.sub(
        r"import \{useOutletContext\} from 'react-router-dom';\n",
        "",
        text,
    )
    text = re.sub(
        r"import \{useOutletContext,\s*([^}]+)\} from 'react-router-dom';",
        r"import {\1} from 'react-router-dom';",
        text,
    )
    text = re.sub(
        r"import \{([^,]+),\s*useOutletContext\} from 'react-router-dom';",
        r"import {\1} from 'react-router-dom';",
        text,
    )
    return text


def add_compat_import(text: str) -> str:
    if "useAppShellContext" in text:
        return text
    first = text.find("import ")
    if first < 0:
        return text
    line_end = text.find("\n", first)
    return text[: line_end + 1] + COMPAT_IMPORT + text[line_end + 1 :]


def replace_hooks(text: str) -> str:
    text = text.replace(
        "const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();",
        "const { theme, language } = useAppShellContext();",
    )
    text = text.replace(
        "const { theme, language } = useOutletContext<{ theme: 'dark'|'light'; language: 'en'|'vi' }>();",
        "const { theme, language } = useAppShellContext();",
    )
    text = re.sub(
        r"const context = useOutletContext<\{[^}]+\}\>\(\);",
        "const context = useAppShellContext();",
        text,
    )
    text = re.sub(
        r"const outlet = useOutletContext<\{ language\?: Language; theme\?: ThemeMode \} \| null>\(\);",
        "const { theme: outletTheme, language: outletLanguage } = useAppShellContext();",
        text,
    )
    text = text.replace("outlet?.language", "outletLanguage")
    text = text.replace("outlet?.theme", "outletTheme")
    return text


def wrap_return(text: str) -> str:
    if "<ModuleViewport" in text:
        return text
    m = re.search(r"\n  return \(\n    <", text)
    if not m:
        return text
    insert_at = m.end() - 1
    text = text[:insert_at] + "<ModuleViewport constrained>\n    <" + text[insert_at + 1 :]
    text = re.sub(
        r"\n    </div>\n  \);\n\}\s*$",
        "\n    </div>\n    </ModuleViewport>\n  );\n}\n",
        text,
        count=1,
    )
    return text


def migrate_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "useAppShellContext" in text and "<ModuleViewport" in text:
        print(f"skip {path.parent.name}: already migrated")
        return False
    orig = text
    text = strip_outlet_import(text)
    text = add_compat_import(text)
    text = replace_hooks(text)
    text = wrap_return(text)
    if text == orig:
        print(f"warn {path.parent.name}: no changes")
        return False
    path.write_text(text, encoding="utf-8")
    print(f"ok {path.parent.name}")
    return True


def main() -> None:
    n = 0
    for rel in FILES:
        p = ROOT / rel
        if not p.is_file():
            print(f"missing {rel}")
            continue
        if migrate_file(p):
            n += 1
    print(f"migrated {n} files")


if __name__ == "__main__":
    main()
