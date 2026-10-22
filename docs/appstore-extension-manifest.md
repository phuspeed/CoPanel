# AppStore runtime extension manifest

Prebuilt and extension install modes copy `manifest.json` and `module.js` under `frontend/dist/extensions/<id>/` and register the module in `extensions/index.json`. The panel shell loads these at runtime (no Vite rebuild).

## Required fields

| Field | Type | Description |
|-------|------|-------------|
| `schema` | number | Manifest version (use `1`). |
| `id` | string | Module id (must match package id / folder name). |
| `name` | string | Default display name. |
| `path` | string | React Router path (e.g. `/file-manager`). |

## Recommended fields

| Field | Type | Description |
|-------|------|-------------|
| `icon` | string | Lucide icon name (e.g. `Folder`). Falls back to `Grid`. |
| `description` | string | Short subtitle in launcher. |
| `order` | number | Sidebar/launcher sort order (lower first; default ~1000). |
| `labels` | object | Locale → label, e.g. `{ "en": "File Manager", "vi": "Quản lý tệp" }`. |

## Optional UI behavior

| Field | Type | Description |
|-------|------|-------------|
| `windowMode` | boolean | Open in desktop window shell. |
| `backgroundPolicy` | `"default"` \| `"keep-running"` | Keep module mounted when hidden. |
| `keepMountedOnMinimize` | boolean | Same as `keep-running` when true. |
| `pinned` | boolean | Show on dock when window mode is enabled. |
| `defaultWindowSize` | `{ width, height }` | Initial window size. |
| `version` | string | Package version (informational). |

## `module.js`

ES module with a default export of the module root React component. Bare imports (`react`, `react-dom`, `react-router-dom`, `lucide-react`) are resolved via the panel `importmap` in `index.html`.

Build with:

```bash
node scripts/build-extension.mjs <module_id> --out path/to/frontend/dist
```
