/**
 * Firewall Module - Configuration
 */
import FirewallDashboard from './index';

export default {
  name: 'Firewall',
  icon: 'Shield',
  path: '/firewall',
  description: 'Firewall rules and ufw management',
  component: FirewallDashboard,
  windowMode: true,
  defaultWindowSize: { width: 960, height: 640 },
  singleton: true,
};
