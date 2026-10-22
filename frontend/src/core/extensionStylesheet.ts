const STYLESHEET_ATTR = 'data-copanel-extension-stylesheet';

/** Load extension module.css when the bundle ships one (optional). */
export function mountExtensionStylesheet(extensionId: string, moduleUrl: string): void {
  if (document.querySelector(`link[${STYLESHEET_ATTR}="${extensionId}"]`)) return;

  const cssHref = moduleUrl.replace(/\/module\.js(\?.*)?$/, '/module.css');
  void fetch(cssHref, { method: 'HEAD', cache: 'no-store' })
    .then((res) => {
      if (!res.ok) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      link.setAttribute(STYLESHEET_ATTR, extensionId);
      document.head.appendChild(link);
    })
    .catch(() => {});
}
