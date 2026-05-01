"""
CoPanel Dynamic Module Loader
Automatically discovers and registers API routes from the modules directory.
"""
import importlib.util
from pathlib import Path
from typing import Optional
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
            if module_path.is_dir() and not module_path.name.startswith('_'):
                router = self._load_module_router(module_path)
                if router:
                    self._register_router(app, module_path.name, router)
                    self.loaded_modules[module_path.name] = router
                    logger.info(f"✓ Loaded module: {module_path.name}")
        
        return self.loaded_modules
    
    def _load_module_router(self, module_path: Path) -> Optional:
        """Dynamically import router from module's router.py."""
        try:
            router_file = module_path / "router.py"
            if not router_file.exists():
                logger.debug(f"No router.py found in {module_path.name}")
                return None
            
            # Dynamically load the module
            spec = importlib.util.spec_from_file_location(
                f"modules.{module_path.name}.router",
                router_file
            )
            if spec is None or spec.loader is None:
                return None
            
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            if not hasattr(module, 'router'):
                logger.warning(f"{module_path.name}/router.py does not export 'router' variable")
                return None
            
            return module.router
            
        except Exception as e:
            logger.error(f"Failed to load module {module_path.name}: {e}")
            return None
    
    def _register_router(self, app: FastAPI, module_name: str, router):
        """Register router to FastAPI app with module prefix."""
        prefix = f"/api/{module_name}"
        tags = [module_name.replace('_', ' ').title()]
        app.include_router(router, prefix=prefix, tags=tags)
        logger.info(f"  Registered at: {prefix}")
