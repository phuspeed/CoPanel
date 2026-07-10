/**
 * AppStore Manager Module - Configuration
 * This file is automatically discovered and loaded by the module registry
 */
import AppStoreDashboard from './index';

export default {
  name: 'App Store',
  icon: 'Package',
  path: '/appstore-manager',
  description: 'Manage and download public extensions from GitHub.',
  component: AppStoreDashboard,
  windowMode: true,
  defaultWindowSize: { width: 1100, height: 720 },
  singleton: true,
  pinned: true,
};
