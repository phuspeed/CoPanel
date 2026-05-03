/**
 * PHP Manager Module - Configuration
 * Automatically discovered and loaded by the module registry
 */
import PHPManagerDashboard from './index';

export default {
  name: 'PHP Manager',
  icon: 'Cpu',
  path: '/php-manager',
  description: 'Manage and install PHP versions, edit php.ini configuration, and view modules.',
  component: PHPManagerDashboard,
};
