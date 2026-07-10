import PanelSettings from './index';

export default {
  name: 'Settings',
  icon: 'Settings',
  path: '/settings',
  description: 'SSH port, root password, panel access gate, 2FA, and network configuration.',
  component: PanelSettings,
  windowMode: true,
  defaultWindowSize: { width: 980, height: 680 },
  singleton: true,
  pinned: true,
  adminOnly: true,
};
