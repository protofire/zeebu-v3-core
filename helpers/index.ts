export * from './constants';
export * from './types';
export * from './contracts-helpers';

import { loadTasks } from './load-tasks';

const TASK_FOLDERS = ['../tasks/misc'];
(async () => {
  for (const folder of TASK_FOLDERS) {
    await loadTasks(folder);
  }
})();
