/**
 * User Management Module - Configuration
 */
import UsersDashboard from './index';

export default {
  name: 'Users',
  icon: 'Users',
  path: '/users',
  description: 'Manage users, assign roles, set isolated home directories, and set dynamic module permissions.',
  component: UsersDashboard,
};
