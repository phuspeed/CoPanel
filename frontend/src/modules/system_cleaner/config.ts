import SystemCleanerDashboard from './index';

export default {
  id: 'system_cleaner',
  name: 'System Cleaner',
  icon: 'Trash2',
  path: '/system-cleaner',
  component: SystemCleanerDashboard,
  windowMode: true,
  defaultWindowSize: { width: 900, height: 600 },
  singleton: true,
};
