/**
 * Rsync Manager — optional AppStore module (SSH checks + rsync).
 */
import RsyncManager from './index';

export default {
  name: 'Rsync Manager',
  icon: 'RefreshCw',
  path: '/rsync_manager',
  description: 'Check VPS compatibility and sync files to a new server over SSH (rsync).',
  component: RsyncManager,
};
