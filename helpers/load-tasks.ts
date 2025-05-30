import fs from 'fs';
import path from 'path';

export function loadTasks(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      loadTasks(fullPath); // recurse into subfolder
    } else if (file.endsWith('.ts') || file.endsWith('.js')) {
      require(fullPath);
    }
  }
}

loadTasks(path.join(__dirname, '..', 'tasks'));
