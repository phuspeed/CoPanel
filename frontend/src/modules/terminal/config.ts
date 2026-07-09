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
};
