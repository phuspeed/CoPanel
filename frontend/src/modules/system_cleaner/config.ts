import React from 'react';
import { Trash2 } from 'lucide-react';

const SystemCleanerDashboard = React.lazy(() => import('./index'));

export default {
  id: 'system_cleaner',
  name: 'System Cleaner',
  icon: Trash2,
  path: '/system-cleaner',
  component: SystemCleanerDashboard,
};
