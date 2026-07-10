import DatabaseManager from './index';

export default {
  name: 'Database Manager',
  icon: 'Database',
  path: '/database-manager',
  description: 'Manage MySQL and PostgreSQL databases, users, and credentials.',
  component: DatabaseManager,
  windowMode: true,
  defaultWindowSize: { width: 1000, height: 680 },
  singleton: true,
};
