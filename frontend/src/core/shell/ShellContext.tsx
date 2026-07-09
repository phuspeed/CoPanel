/**
 * Shell context for modules rendered outside React Router Outlet (desktop windows).
 */
import { createContext, useContext } from 'react';

export interface ShellContextValue {
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  language: 'en' | 'vi';
  setLanguage: (l: 'en' | 'vi') => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellContextProvider({
  value,
  children,
}: {
  value: ShellContextValue;
  children: React.ReactNode;
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShellContext(): ShellContextValue | null {
  return useContext(ShellContext);
}
