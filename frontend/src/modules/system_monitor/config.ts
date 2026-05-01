/**
 * System Monitor Module - Configuration
 * This file is automatically discovered and loaded by the module registry
 */
import SystemMonitorDashboard from './index';

export default {
  name: 'System Monitor',
  icon: 'Activity',
  path: '/system-monitor',
  description: 'Real-time system resource monitoring',
  component: SystemMonitorDashboard,
};
