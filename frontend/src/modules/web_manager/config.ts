/**
 * Web Manager Module - Configuration
 */
import WebManagerDashboard from './index';

export default {
  name: 'Web Manager',
  icon: 'Globe',
  path: '/web-manager',
  description: 'Nginx & Apache vhosts, LEMP/LAMP stack, PHP-FPM overview and database services',
  component: WebManagerDashboard,
  windowMode: true,
  defaultWindowSize: { width: 1024, height: 700 },
  singleton: true,
};
