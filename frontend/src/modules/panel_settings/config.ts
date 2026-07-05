import PanelSettings from './index';

export default {
  name: 'Settings',
  icon: 'Settings',
  path: '/settings',
  description: 'SSH port, root password, panel access gate, 2FA, and network configuration.',
  component: PanelSettings,
  pinned: true,
  adminOnly: true,
};
