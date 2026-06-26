"""
CoPanel Dynamic Module Loader
Automatically discovers and registers API routes from the modules directory.
"""
import importlib.util
import sys
from pathlib import Path
from typing import Optional, Tuple
from fastapi import FastAPI
import logging

logger = logging.getLogger(__name__)


class ModuleLoader:
    """Dynamically loads and registers FastAPI routers from module folders."""

    def __init__(self, modules_dir: Path):
        self.modules_dir = modules_dir
        self.loaded_modules = {}

    def load_modules(self, app: FastAPI) -> dict:
        """
        Scan modules directory and register routers.

        Expected structure:
        modules/
        ├── module_name/
        │   ├── __init__.py
        │   └── router.py (must export 'router' variable)
        """
        if not self.modules_dir.exists():
            logger.warning(f"Modules directory not found: {self.modules_dir}")
            return {}

        for module_path in self.modules_dir.iterdir():
            if module_path.is_dir() and not module_path.name.startswith("_"):
                router = self._load_module_router(module_path)
                if router:
                    self._register_router(app, module_path.name, router)
                    self.loaded_modules[module_path.name] = router
                    logger.info(f"✓ Loaded module: {module_path.name}")

        return self.loaded_modules

    def reload_module(self, app: FastAPI, module_name: str) -> Tuple[bool, str]:
        """Drop and re-register routes for one module from disk (hot reload)."""
        module_path = self.modules_dir / module_name
        if not module_path.is_dir():
            return False, f"Module directory not found: {module_name}"

        self._unregister_module_routes(app, module_name)
        self._purge_module_cache(module_name)
        self._clear_pycache(module_path)

        router = self._load_module_router(module_path)
        if router is None:
            return False, f"Failed to import router for {module_name}"

        self._register_router(app, module_name, router)
        self.loaded_modules[module_name] = router
        logger.info("Reloaded module: %s", module_name)
        return True, f"Reloaded {module_name}"

    def _unregister_module_routes(self, app: FastAPI, module_name: str) -> None:
        prefix = f"/api/{module_name}"
        kept = []
        removed = 0
        for route in app.routes:
            path = getattr(route, "path", None) or ""
            if path == prefix or path.startswith(prefix + "/"):
                removed += 1
                continue
            kept.append(route)
        app.router.routes = kept
        if removed:
            logger.info("Removed %d route(s) for %s", removed, module_name)

    def _purge_module_cache(self, module_name: str) -> None:
        prefix = f"modules.{module_name}"
        for key in list(sys.modules.keys()):
            if key == prefix or key.startswith(prefix + "."):
                del sys.modules[key]

    def _clear_pycache(self, module_path: Path) -> None:
        import shutil

        cache = module_path / "__pycache__"
        if cache.is_dir():
            shutil.rmtree(cache, ignore_errors=True)

    def _ensure_module_package(self, module_path: Path, module_name: str) -> None:
        """Register parent package so ``from . import logic`` works when hot-reloading."""
        pkg_name = f"modules.{module_name}"
        if pkg_name in sys.modules:
            return

        init_py = module_path / "__init__.py"
        if init_py.is_file():
            spec = importlib.util.spec_from_file_location(
                pkg_name,
                init_py,
                submodule_search_locations=[str(module_path)],
            )
            if spec and spec.loader:
                pkg = importlib.util.module_from_spec(spec)
                sys.modules[pkg_name] = pkg
                spec.loader.exec_module(pkg)
                return

        from importlib.machinery import ModuleSpec

        spec = ModuleSpec(pkg_name, loader=None, is_package=True)
        spec.submodule_search_locations = [str(module_path)]
        pkg = importlib.util.module_from_spec(spec)
        sys.modules[pkg_name] = pkg

    def _load_module_router(self, module_path: Path) -> Optional:
        """Dynamically import router from module's router.py."""
        try:
            router_file = module_path / "router.py"
            if not router_file.exists():
                logger.debug(f"No router.py found in {module_path.name}")
                return None

            self._ensure_module_package(module_path, module_path.name)

            spec = importlib.util.spec_from_file_location(
                f"modules.{module_path.name}.router",
                router_file,
                submodule_search_locations=[str(module_path)],
            )
            if spec is None or spec.loader is None:
                return None

            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)

            if not hasattr(module, "router"):
                logger.warning(f"{module_path.name}/router.py does not export 'router' variable")
                return None

            return module.router

        except Exception as e:
            logger.error(f"Failed to load module {module_path.name}: {e}")
            return None

    def _register_router(self, app: FastAPI, module_name: str, router):
        """Register router to FastAPI app with module prefix."""
        prefix = f"/api/{module_name}"
        tags = [module_name.replace("_", " ").title()]
        app.include_router(router, prefix=prefix, tags=tags)
        logger.info(f"  Registered at: {prefix}")
