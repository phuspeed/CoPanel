import PanelSettings from './index';

export default {
  name: 'Settings',
  icon: 'Settings',
  path: '/settings',
  description: 'Date & time, user accounts, SSH, security, network, and branding.',
  component: PanelSettings,
  windowMode: true,
  defaultWindowSize: { width: 980, height: 680 },
  singleton: true,
  pinned: true,
  adminOnly: true,
};
