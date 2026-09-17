import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const execute = promisify(execFile);
const commandOptions = { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true };

export function parsePort(value) {
  if (!/^\d{1,5}$/.test(value ?? '') || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('Give me a port from 1 to 65535. Try: fush 3000');
  }
  return Number(value);
}

export function parseNetstat(output, port) {
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const [protocol, local, , state, pid] = line.trim().split(/\s+/);
    if (protocol === 'TCP' && state === 'LISTENING' &&
        local?.slice(local.lastIndexOf(':') + 1) === String(port) && /^\d+$/.test(pid)) {
      pids.add(Number(pid));
    }
  }
  return [...pids];
}

export async function findListeners(port, { platform = process.platform, exec = execute } = {}) {
  parsePort(String(port));
  if (platform === 'win32') {
    const { stdout } = await exec('netstat.exe', ['-ano', '-p', 'tcp'], commandOptions);
    return parseNetstat(stdout, port);
  }
  if (!['darwin', 'linux', 'freebsd', 'openbsd'].includes(platform)) {
    throw new Error(`The ${platform} platform is not supported yet.`);
  }
  try {
    const { stdout } = await exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], commandOptions);
    return [...new Set(stdout.trim().split(/\s+/).filter((pid) => /^\d+$/.test(pid)).map(Number))];
  } catch (error) {
    // lsof uses exit status 1 when no matching sockets exist.
    if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return [];
    if (error.code === 'ENOENT') {
      throw new Error('Port lookup needs lsof. Install it with your system package manager, then try again.');
    }
    throw new Error(`Could not inspect port ${port}. Check that lsof can run and that you have permission to inspect the listener.`);
  }
}

async function terminate(pid, force, platform) {
  try {
    if (platform === 'win32') {
      // No /T: unrelated child processes are outside the requested scope.
      await execute('taskkill.exe', ['/PID', String(pid), '/F'], commandOptions);
    } else {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    }
  } catch (error) {
    if (error.code === 'ESRCH') return; // Exited between lookup and signal.
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      throw new Error(`No permission to stop PID ${pid}. Run as its owner or use an administrator terminal.`);
    }
    throw new Error(`Could not stop PID ${pid}. It may have exited already, or need administrator permissions.`);
  }
}

export async function freePort(port, {
  force = false,
  find = findListeners,
  stop = terminate,
  platform = process.platform,
  wait = sleep,
} = {}) {
  parsePort(String(port));
  const pids = await find(port);
  if (!pids.length) return { status: 'empty', pids: [] };
  const protectedPids = new Set([0, 1, process.pid, process.ppid]);
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid < 1 || protectedPids.has(pid))) {
    throw new Error('This port belongs to a protected process or the current terminal. Stop it manually.');
  }

  const failures = [];
  for (const pid of pids) {
    // Recheck before every signal; a listener may have exited during lookup.
    if (!(await find(port)).includes(pid)) continue;
    try { await stop(pid, force, platform); }
    catch (error) { failures.push(error.message); }
  }

  for (let attempt = 0; attempt < 16; attempt++) {
    const remaining = await find(port);
    if (!remaining.length) return { status: 'freed', pids };
    if (failures.length) throw new Error(failures.join(' '));
    if (remaining.some((pid) => !pids.includes(pid))) {
      throw new Error(`Port ${port} has a new listener. A watcher may be restarting it; stop the watcher and retry.`);
    }
    if (attempt < 15) await wait(100);
  }
  throw new Error(force
    ? `Port ${port} is still occupied. Check its owner or stop the supervising service.`
    : `Port ${port} is still occupied. Retry with fush ${port} --force to force-stop its listener.`);
}
