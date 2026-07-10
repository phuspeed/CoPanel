/**
 * Theme/language for modules in Outlet or desktop windows.
 */
import { useOutletContext } from 'react-router-dom';
import { ShellContextValue, useShellContext } from '../shell/ShellContext';

const FALLBACK: ShellContextValue = {
  theme: (localStorage.getItem('copanel_theme') as 'dark' | 'light') || 'light',
  setTheme: () => {},
  language: (localStorage.getItem('copanel_lang') as 'en' | 'vi') || 'en',
  setLanguage: () => {},
};

export function useAppShellContext(): ShellContextValue {
  const shell = useShellContext();
  const outlet = useOutletContext<Partial<ShellContextValue> | null>();
  if (shell) return shell;
  if (outlet?.theme) {
    return {
      theme: outlet.theme,
      setTheme: outlet.setTheme ?? (() => {}),
      language: outlet.language ?? 'en',
      setLanguage: outlet.setLanguage ?? (() => {}),
    };
  }
  return FALLBACK;
}
