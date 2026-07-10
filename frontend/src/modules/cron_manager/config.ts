import CronManager from './index';

export default {
  name: 'Cron Manager',
  icon: 'Clock',
  path: '/cron-manager',
  component: CronManager,
  description: 'Schedule recurring system tasks via crontab.',
  windowMode: true,
  defaultWindowSize: { width: 960, height: 640 },
  singleton: true,
};
