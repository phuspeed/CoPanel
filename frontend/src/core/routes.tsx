/**
 * React Router configuration for dynamic module routes
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { moduleRegistry, ModuleConfig } from './registry';
import Layout from './Layout';

export function createRoutes() {
  const modules = moduleRegistry.getAll();
  
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          
          {/* Dynamic module routes */}
          {modules.map((module: ModuleConfig) => (
            <Route
              key={module.path}
              path={module.path}
              element={<module.component />}
            />
          ))}
          
          {/* 404 fallback */}
          <Route path="*" element={<div className="p-8">Module not found</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
