/**
 * Docker Manager Module - Configuration
 */
import DockerManagerDashboard from './index';

export default {
  name: 'Docker Manager',
  icon: 'Box',
  path: '/docker-manager',
  description: 'Manage containers and status metrics',
  component: DockerManagerDashboard,
};
