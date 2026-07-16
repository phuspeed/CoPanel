/** Fixed layout width when user opts into "desktop site" on a phone/tablet browser. */
export const MOBILE_DESKTOP_VIEWPORT_WIDTH = 1280;

export const MOBILE_DESKTOP_SITE_KEY = 'copanel_mobile_desktop_site';

const DEFAULT_VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';

function desktopViewportContent() {
  return `width=${MOBILE_DESKTOP_VIEWPORT_WIDTH}, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes`;
}

export function isMobileDesktopSiteEnabled(): boolean {
  try {
    return localStorage.getItem(MOBILE_DESKTOP_SITE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Apply viewport meta without reload (also used from index.html boot script). */
export function applyMobileDesktopViewport(enabled: boolean) {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  meta.setAttribute('content', enabled ? desktopViewportContent() : DEFAULT_VIEWPORT);
}

/** Persist preference; reload so mobile browsers recalc layout breakpoints. */
export function setMobileDesktopSite(enabled: boolean, reload = true) {
  try {
    localStorage.setItem(MOBILE_DESKTOP_SITE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
  applyMobileDesktopViewport(enabled);
  if (reload) {
    window.location.reload();
  }
}

/** True when layout should use desktop breakpoints (wide monitor or forced mobile desktop site). */
export function isLayoutViewportWide(innerWidth = window.innerWidth): boolean {
  return isMobileDesktopSiteEnabled() || innerWidth >= 1024;
}

/** Show the toggle on narrow physical viewports or when desktop site mode is already on. */
export function shouldOfferMobileDesktopSiteToggle(innerWidth = window.innerWidth): boolean {
  return isMobileDesktopSiteEnabled() || innerWidth < 1024;
}
