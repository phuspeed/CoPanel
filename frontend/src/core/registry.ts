/**
 * CoPanel Frontend Module Registry
 * Core modules: Vite glob at build time.
 * AppStore extensions: runtime load from /extensions/ (no full panel rebuild).
 */

import React from 'react';

export interface ModuleConfig {
  name: string;
  icon: string;
  path: string;
  component: React.ComponentType<any>;
  description?: string;
  windowMode?: boolean;
  defaultWindowSize?: { width: number; height: number };
  singleton?: boolean;
  pinned?: boolean;
  minWindowSize?: { width: number; height: number };
  adminOnly?: boolean;
  /** AppStore extension module id */
  extensionId?: string;
}

export interface ExtensionManifest {
  schema: number;
  id: string;
  name: string;
  path: string;
  icon?: string;
  description?: string;
  windowMode?: boolean;
  defaultWindowSize?: { width: number; height: number };
  pinned?: boolean;
  core_ui?: string;
  version?: string;
}

interface ExtensionIndexEntry {
  id: string;
  path?: string;
  name?: string;
  manifest_url?: string;
  module_url?: string;
}

class ModuleRegistry {
  private modules: Map<string, ModuleConfig> = new Map();
  private extensionsLoaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    this.loadCoreModules();
  }

  private loadCoreModules(): void {
    const moduleConfigs = (import.meta as any).glob('../modules/*/config.ts', {
      eager: true,
    }) as Record<string, any>;

    for (const [filePath, module] of Object.entries(moduleConfigs)) {
      try {
        const config = module.default || module;
        if (!config.name || !config.path || !config.component) {
          console.warn(`Invalid module config in ${filePath}: missing required fields`);
          continue;
        }
        this.registerModule(config);
        console.log(`✓ Registered core module: ${config.name}`);
      } catch (error) {
        console.error(`Failed to load module from ${filePath}:`, error);
      }
    }
  }

  private registerModule(config: Partial<ModuleConfig> & Pick<ModuleConfig, 'name' | 'path' | 'component'>) {
    const moduleKey = config.name.toLowerCase();
    this.modules.set(moduleKey, {
      name: config.name,
      icon: config.icon || 'Grid',
      path: config.path,
      component: config.component,
      description: config.description || '',
      windowMode: config.windowMode === true,
      defaultWindowSize: config.defaultWindowSize,
      singleton: config.singleton,
      pinned: config.pinned === true,
      minWindowSize: config.minWindowSize,
      adminOnly: config.adminOnly === true,
      extensionId: config.extensionId,
    });
  }

  private registerExtension(manifest: ExtensionManifest, component: React.ComponentType<any>) {
    this.registerModule({
      name: manifest.name,
      icon: manifest.icon || 'Grid',
      path: manifest.path,
      component,
      description: manifest.description || '',
      windowMode: manifest.windowMode === true,
      defaultWindowSize: manifest.defaultWindowSize,
      pinned: manifest.pinned === true,
      extensionId: manifest.id,
    });
    console.log(`✓ Registered extension: ${manifest.name} (${manifest.id})`);
  }

  /** Load AppStore extensions (API with JWT, static index.json fallback). */
  async loadExtensions(): Promise<void> {
    if (this.extensionsLoaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.fetchAndRegisterExtensions();
    }
    await this.loadPromise;
  }

  private authHeaders(): HeadersInit {
    const token = localStorage.getItem('copanel_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async fetchExtensionIndex(): Promise<ExtensionIndexEntry[]> {
    const token = localStorage.getItem('copanel_token');
    if (token) {
      try {
        const res = await fetch('/api/platform/extensions', {
          headers: this.authHeaders(),
          cache: 'no-store',
        });
        if (res.ok) {
          const body = await res.json();
          const data = body?.data ?? body;
          if (Array.isArray(data?.extensions)) {
            return data.extensions;
          }
        }
      } catch {
        // fall through to static index
      }
    }

    const res = await fetch('/extensions/index.json', { cache: 'no-store' });
    if (!res.ok) {
      return [];
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return [];
    }
    const body = await res.json();
    return body.extensions || [];
  }

  private async fetchAndRegisterExtensions(): Promise<void> {
    try {
      const entries = await this.fetchExtensionIndex();
      for (const entry of entries) {
        try {
          const manifestUrl = entry.manifest_url || `/extensions/${entry.id}/manifest.json`;
          const moduleUrl = entry.module_url || `/extensions/${entry.id}/module.js`;
          const manifestRes = await fetch(manifestUrl, { cache: 'no-store' });
          if (!manifestRes.ok) continue;
          const manifest: ExtensionManifest = await manifestRes.json();
          const mod = await import(/* @vite-ignore */ moduleUrl);
          const component = mod.default || mod;
          if (typeof component !== 'function' && typeof component !== 'object') {
            console.warn(`Extension ${entry.id} has no default export`);
            continue;
          }
          this.registerExtension(manifest, component);
        } catch (err) {
          console.error(`Failed to load extension ${entry.id}:`, err);
        }
      }
    } catch (err) {
      console.warn('Extension index not available:', err);
    } finally {
      this.extensionsLoaded = true;
    }
  }

  getAll(): ModuleConfig[] {
    return Array.from(this.modules.values());
  }

  getByName(name: string): ModuleConfig | undefined {
    return this.modules.get(name.toLowerCase());
  }

  getByPath(path: string): ModuleConfig | undefined {
    for (const module of this.modules.values()) {
      if (module.path === path) return module;
    }
    return undefined;
  }

  exists(name: string): boolean {
    return this.modules.has(name.toLowerCase());
  }

  count(): number {
    return this.modules.size;
  }
}

export const moduleRegistry = new ModuleRegistry();
