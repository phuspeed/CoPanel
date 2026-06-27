import PanelSettings from './index';

export default {
  name: 'Settings',
  icon: 'Settings',
  path: '/settings',
  description: 'SSH port, root password, panel access gate, and 2FA.',
  component: PanelSettings,
  pinned: true,
  adminOnly: true,
};
