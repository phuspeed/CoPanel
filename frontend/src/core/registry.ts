/**
 * CoPanel Frontend Module Registry
 * Dynamically discovers and registers modules from the modules directory
 */

export interface ModuleConfig {
  name: string;
  icon: string;
  path: string;
  component: React.ComponentType<any>;
  description?: string;
}

class ModuleRegistry {
  private modules: Map<string, ModuleConfig> = new Map();
  private rawModules: Record<string, any> = {};

  constructor() {
    this.loadModules();
  }

  /**
   * Dynamically load all modules using Vite's glob imports
   * Each module must have a config.ts file that exports:
   * - name: string
   * - icon: string
   * - path: string
   * - component: React component
   */
  private loadModules(): void {
    // This uses Vite's import.meta.glob to find all config.ts files
    const moduleConfigs = import.meta.glob<any>(
      '../modules/*/config.ts',
      { eager: true }
    );

    for (const [filePath, module] of Object.entries(moduleConfigs)) {
      try {
        const config = module.default || module;
        
        if (!config.name || !config.path || !config.component) {
          console.warn(`Invalid module config in ${filePath}: missing required fields`);
          continue;
        }

        const moduleKey = config.name.toLowerCase();
        this.modules.set(moduleKey, {
          name: config.name,
          icon: config.icon || 'Grid',
          path: config.path,
          component: config.component,
          description: config.description || '',
        });

        console.log(`✓ Registered module: ${config.name}`);
      } catch (error) {
        console.error(`Failed to load module from ${filePath}:`, error);
      }
    }

    if (this.modules.size === 0) {
      console.warn('No modules found in modules directory');
    }
  }

  /**
   * Get all registered modules
   */
  getAll(): ModuleConfig[] {
    return Array.from(this.modules.values());
  }

  /**
   * Get a specific module by name
   */
  getByName(name: string): ModuleConfig | undefined {
    return this.modules.get(name.toLowerCase());
  }

  /**
   * Get a module by its path
   */
  getByPath(path: string): ModuleConfig | undefined {
    for (const module of this.modules.values()) {
      if (module.path === path) {
        return module;
      }
    }
    return undefined;
  }

  /**
   * Check if a module exists
   */
  exists(name: string): boolean {
    return this.modules.has(name.toLowerCase());
  }

  /**
   * Get module count
   */
  count(): number {
    return this.modules.size;
  }
}

// Export singleton instance
export const moduleRegistry = new ModuleRegistry();
