/**
 * React Router configuration with Login & dynamic access control
 */
import { useState, useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { moduleRegistry, ModuleConfig } from './registry';
import Layout from './Layout';
import Dashboard from './Dashboard';
import Login from './Login';

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
    return <Login onLoginSuccess={handleLoginSuccess} />;
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
        <Route element={<Layout user={user} onLogout={handleLogout} />}>
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
