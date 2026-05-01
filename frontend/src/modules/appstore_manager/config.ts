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
};
