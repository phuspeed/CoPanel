import DnsManager from './index';

export default {
  name: 'DNS Manager',
  icon: 'Network',
  path: '/dns-manager',
  component: DnsManager,
  description: 'Edit DNS zones and records (local or BIND backend).',
};
