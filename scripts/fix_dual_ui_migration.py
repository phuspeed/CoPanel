#!/usr/bin/env python3
"""Fix dual-UI migration artifacts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "modules"

for path in ROOT.glob("*/index.tsx"):
    text = path.read_text(encoding="utf-8")
    orig = text
    text = text.replace(
        "    ModuleViewport constrained>\n    <",
        "    <ModuleViewport constrained>\n    <",
    )
    text = text.replace("import { useOutletContext } from 'react-router-dom';\n", "")
    text = text.replace(", useOutletContext", "")
    text = text.replace("useOutletContext, ", "")
    if text != orig:
        path.write_text(text, encoding="utf-8")
        print("fixed", path.parent.name)
