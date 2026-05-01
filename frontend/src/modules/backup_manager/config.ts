/**
 * Backup Manager Module - Configuration
 * This file is automatically discovered and loaded by the module registry
 */
import BackupAndSyncDashboard from './index';

export default {
  name: 'Backup Manager',
  icon: 'Cloud',
  path: '/backup-manager',
  description: 'Manage cron automated folder backups and Rclone cloud syncing.',
  component: BackupAndSyncDashboard,
};
