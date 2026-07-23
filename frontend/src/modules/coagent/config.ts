/**
 * CoAgent Module - Configuration
 */
import { lazy } from 'react';

const CoAgentDashboard = lazy(() => import('./index'));

export default {
  name: 'CoAgent',
  icon: 'Bot',
  path: '/coagent',
  description: 'AI SysAdmin assistant for diagnosing and managing your VPS',
  component: CoAgentDashboard,
  windowMode: true,
  defaultWindowSize: { width: 980, height: 700 },
  singleton: true,
};
