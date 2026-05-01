/**
 * File Manager Module - Configuration
 * This file is automatically discovered and loaded by the module registry
 */
import FileManagerDashboard from './index';

export default {
  name: 'File Manager',
  icon: 'Folder',
  path: '/file-manager',
  description: 'Manage VPS files starting from /var/www or /root',
  component: FileManagerDashboard,
};
