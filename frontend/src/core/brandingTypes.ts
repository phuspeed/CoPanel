/** Shared branding types and helpers (panel settings + shell). */

export interface WallpaperItem {
  id: string;
  label?: string | null;
  data_url: string;
}

export interface BrandingSettings {
  site_title: string;
  site_subtitle: string;
  favicon_data_url: string | null;
  logo_data_url: string | null;
  wallpapers: WallpaperItem[];
  selected_wallpaper_id: string | null;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  site_title: 'CoPanel',
  site_subtitle: 'Lightweight VPS Management',
  favicon_data_url: null,
  logo_data_url: null,
  wallpapers: [],
  selected_wallpaper_id: null,
};

export const MAX_WALLPAPERS = 12;

/** Dispatched after branding is saved so the shell refreshes without manual F5. */
export const BRANDING_UPDATED_EVENT = 'copanel:branding-updated';

export function notifyBrandingUpdated(branding?: BrandingSettings) {
  window.dispatchEvent(new CustomEvent(BRANDING_UPDATED_EVENT, { detail: branding }));
}

export async function fetchPublicBranding(): Promise<BrandingSettings> {
  const res = await fetch('/api/panel_settings/branding/public');
  const body = await res.json();
  const next = body?.status === 'success' && body.data ? body.data : body;
  return normalizeBranding(next);
}

export function normalizeBranding(raw: Partial<BrandingSettings> | null | undefined): BrandingSettings {
  const wallpapers = Array.isArray(raw?.wallpapers)
    ? raw!.wallpapers
        .filter((w) => w && w.id && w.data_url)
        .map((w) => ({
          id: String(w.id),
          label: w.label ? String(w.label) : null,
          data_url: String(w.data_url),
        }))
        .slice(0, MAX_WALLPAPERS)
    : [];
  let selected = raw?.selected_wallpaper_id ? String(raw.selected_wallpaper_id) : null;
  if (selected && !wallpapers.some((w) => w.id === selected)) {
    selected = null;
  }
  return {
    site_title: raw?.site_title?.trim() || DEFAULT_BRANDING.site_title,
    site_subtitle: raw?.site_subtitle?.trim() || DEFAULT_BRANDING.site_subtitle,
    favicon_data_url: raw?.favicon_data_url || null,
    logo_data_url: raw?.logo_data_url || null,
    wallpapers,
    selected_wallpaper_id: selected,
  };
}

export function activeWallpaperDataUrl(branding: Partial<BrandingSettings> | null | undefined): string | null {
  const id = branding?.selected_wallpaper_id;
  if (!id) return null;
  return branding?.wallpapers?.find((w) => w.id === id)?.data_url ?? null;
}

export function newWallpaperId(): string {
  return `wp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}
