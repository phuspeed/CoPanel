/**
 * Package Manager Module - Configuration
 */
import PackageManagerDashboard from './index';

export default {
  name: 'Packages',
  icon: 'Package',
  path: '/package-manager',
  description: 'Manage and install system packages & dynamic modules.',
  component: PackageManagerDashboard,
  windowMode: true,
  defaultWindowSize: { width: 1024, height: 700 },
  minWindowSize: { width: 420, height: 360 },
  singleton: true,
  pinned: true,
};
