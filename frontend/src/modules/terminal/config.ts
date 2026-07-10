/**
 * Terminal Module - Configuration
 */
import { lazy } from 'react';

const TerminalDashboard = lazy(() => import('./index'));

export default {
  name: 'Terminal',
  icon: 'Terminal',
  path: '/terminal',
  description: 'Interactive web terminal directly to your VPS server',
  component: TerminalDashboard,
  windowMode: true,
  defaultWindowSize: { width: 920, height: 580 },
  singleton: true,
};
