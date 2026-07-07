/**
 * React Router configuration with Login & dynamic access control
 */
import { useState, useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { moduleRegistry, ModuleConfig } from './registry';
import Layout from './Layout';
import Dashboard from './Dashboard';
import Login from './Login';

interface BrandingSettings {
  site_title: string;
  site_subtitle: string;
  favicon_data_url: string | null;
  logo_data_url: string | null;
}

const DEFAULT_BRANDING: BrandingSettings = {
  site_title: 'CoPanel',
  site_subtitle: 'Lightweight VPS Management',
  favicon_data_url: null,
  logo_data_url: null,
};
const DEFAULT_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231d4ed8'/%3E%3Cpath d='M41 20a16 16 0 1 0 0 24' fill='none' stroke='white' stroke-width='6' stroke-linecap='round'/%3E%3C/svg%3E";

function applyBranding(branding: BrandingSettings) {
  const siteTitle = branding.site_title?.trim() || DEFAULT_BRANDING.site_title;
  document.title = siteTitle;
  const faviconHref = branding.favicon_data_url || DEFAULT_FAVICON;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = faviconHref;
}

/** Fallback shown while a lazy module chunk is loading */
function ModuleLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <svg
        className="w-8 h-8 animate-spin text-blue-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  );
}

export function createRoutes() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('copanel_token'));
  const [user, setUser] = useState<any>(() => {
    try {
      const saved = localStorage.getItem('copanel_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [branding, setBranding] = useState<BrandingSettings>(DEFAULT_BRANDING);

  useEffect(() => {
    fetch('/api/panel_settings/branding/public')
      .then((r) => r.json())
      .then((body) => {
        const next = body?.status === 'success' && body.data ? body.data : body;
        setBranding({
          site_title: next?.site_title || DEFAULT_BRANDING.site_title,
          site_subtitle: next?.site_subtitle || DEFAULT_BRANDING.site_subtitle,
          favicon_data_url: next?.favicon_data_url || null,
          logo_data_url: next?.logo_data_url || null,
        });
      })
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  useEffect(() => {
    applyBranding(branding);
  }, [branding]);

  const handleLoginSuccess = (newToken: string, loggedUser: any) => {
    localStorage.setItem('copanel_token', newToken);
    localStorage.setItem('copanel_user', JSON.stringify(loggedUser));
    setToken(newToken);
    setUser(loggedUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('copanel_token');
    localStorage.removeItem('copanel_user');
    setToken(null);
    setUser(null);
  };

  // Check if session token still valid on load
  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then((r) => {
          if (!r.ok) {
            handleLogout();
          }
        })
        .catch(() => handleLogout());
    }
  }, [token]);

  // If not logged in, render the login view
  if (!token || !user) {
    return <Login onLoginSuccess={handleLoginSuccess} branding={branding} />;
  }

  const modules = moduleRegistry.getAll();

  // Enforce dynamic module access permissions
  const filteredModules = modules.filter((mod: ModuleConfig) => {
    if (mod.path === '/settings') {
      return user.role === 'superadmin';
    }
    if (user.role === 'superadmin') return true;

    // Normal users see permitted modules only
    try {
      const permitted = typeof user.permitted_modules === 'string'
        ? JSON.parse(user.permitted_modules)
        : user.permitted_modules;

      if (Array.isArray(permitted) && permitted.includes('all')) return true;
      if (Array.isArray(permitted)) {
        return permitted.includes(mod.name.toLowerCase().replace(/\s+/g, '_'));
      }
    } catch {
      return false;
    }
    return false;
  });

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout user={user} onLogout={handleLogout} branding={branding} />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Render allowed modules — wrapped in Suspense to support React.lazy() in config.ts */}
          {filteredModules.map((module: ModuleConfig) => (
            <Route
              key={module.path}
              path={module.path}
              element={
                <Suspense fallback={<ModuleLoader />}>
                  <module.component />
                </Suspense>
              }
            />
          ))}

          {/* 404 fallback */}
          <Route path="*" element={<div className="p-8">Module not found or Restricted.</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
