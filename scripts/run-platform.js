#!/usr/bin/env node
// Dispatches a named task to the platform-appropriate command so the pnpm
// scripts in package.json work on both Windows and Linux/macOS. Windows keeps
// the PowerShell wrappers (they resolve Git Bash for the shared bash core);
// everywhere else the bash twins run natively.
const { spawnSync } = require('node:child_process');

const isWindows = process.platform === 'win32';
const ps1 = (file) => ['powershell', ['-ExecutionPolicy', 'Bypass', '-File', file]];
const sh = (file) => ['bash', [file]];

const tasks = {
  doctor: isWindows ? ps1('scripts/doctor.ps1') : sh('scripts/doctor.sh'),
  'fabric:bootstrap': isWindows ? ps1('network/bootstrap.ps1') : sh('network/bootstrap.sh'),
  'fabric:up': isWindows ? ps1('network/start.ps1') : sh('network/up.sh'),
  'fabric:down': isWindows ? ps1('network/stop.ps1') : sh('network/stop-fabric.sh'),
  'test:fabric': isWindows ? ps1('scripts/test-fabric.ps1') : sh('scripts/test-fabric.sh'),
  'check-go-format': isWindows
    ? ps1('scripts/check-go-format.ps1')
    : sh('scripts/check-go-format.sh'),
};

const [task] = process.argv.slice(2);
const target = tasks[task];
if (!target) {
  console.error(`Unknown task "${task ?? ''}". Available: ${Object.keys(tasks).join(', ')}`);
  process.exit(1);
}

const [command, args] = target;
const result = spawnSync(command, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
