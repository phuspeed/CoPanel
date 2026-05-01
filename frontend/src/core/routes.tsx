/**
 * React Router configuration with Login & dynamic access control
 */
import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { moduleRegistry, ModuleConfig } from './registry';
import Layout from './Layout';
import Dashboard from './Dashboard';
import Login from './Login';

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

          {/* Render allowed modules */}
          {filteredModules.map((module: ModuleConfig) => (
            <Route
              key={module.path}
              path={module.path}
              element={<module.component />}
            />
          ))}

          {/* 404 fallback */}
          <Route path="*" element={<div className="p-8">Module not found or Restricted.</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
