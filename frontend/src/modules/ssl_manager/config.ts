/**
 * SSL Manager Module - Configuration
 * This file is automatically discovered and loaded by the module registry
 */
import SSLManagerDashboard from './index';

export default {
  name: 'SSL Manager',
  icon: 'Shield',
  path: '/ssl-manager',
  description: 'Issue Let\'s Encrypt certificates and upload custom private keys.',
  component: SSLManagerDashboard,
};
