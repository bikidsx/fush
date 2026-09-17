import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parsePort, parseNetstat, findListeners, freePort } from '../src/ports.js';
import { parseArgs, run } from '../src/cli.js';
import { createUI } from '../src/ui.js';

function capture(tty = false) {
  return { isTTY: tty, columns: 80, rows: 24, text: '', write(value) { this.text += value; } };
}

test('ports must be whole decimal numbers within the valid range', () => {
  for (const input of ['1', '3000', '65535', '03000']) assert.equal(parsePort(input), Number(input));
  for (const input of ['', '0', '65536', '-1', '3.5', '3e3', '3000;kill', 'Infinity', '9'.repeat(10000), undefined]) {
    assert.throws(() => parsePort(input), /1 to 65535/);
  }
});

test('arguments are strict, with harmless help and preview paths', () => {
  assert.deepEqual(parseArgs([]), { help: true });
  assert.equal(parseArgs(['--demo']).port, 3000);
  assert.equal(parseArgs(['3000', '-f']).force, true);
  assert.throws(() => parseArgs(['3000', '3001']), /One port/);
  assert.throws(() => parseArgs(['--wat']), /Unknown option/);
  assert.throws(() => parseArgs(['--quiet']), /Missing port/);
});

test('Windows lookup matches the exact local listening port, including IPv6', () => {
  const output = `
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       81111
  TCP    [::]:3000              [::]:0                 LISTENING       81111
  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       82222
  TCP    0.0.0.0:13000          0.0.0.0:0              LISTENING       83333
  TCP    127.0.0.1:55000        127.0.0.1:3000         ESTABLISHED     84444
  UDP    0.0.0.0:3000           *:*                                    85555
  TCP    127.0.0.1:3000         127.0.0.1:55000        TIME_WAIT       0
  `;
  assert.deepEqual(parseNetstat(output, 3000), [81111, 82222]);
});

test('Unix lookup uses shell-free arguments and deduplicates PIDs', async () => {
  const pids = await findListeners(3000, { platform: 'darwin', exec: async (file, args) => {
    assert.equal(file, 'lsof');
    assert.deepEqual(args, ['-nP', '-iTCP:3000', '-sTCP:LISTEN', '-t']);
    return { stdout: '81111\n81111\n82222\n' };
  } });
  assert.deepEqual(pids, [81111, 82222]);
});

test('Windows lookup uses the built-in netstat command', async () => {
  assert.deepEqual(await findListeners(3000, { platform: 'win32', exec: async (file, args) => {
    assert.equal(file, 'netstat.exe');
    assert.deepEqual(args, ['-ano', '-p', 'tcp']);
    return { stdout: 'TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 81111' };
  } }), [81111]);
});

test('empty lookup, missing lsof, and lookup failure are distinct states', async () => {
  const fail = (error) => async () => { throw error; };
  assert.deepEqual(await findListeners(3000, { platform: 'linux', exec: fail({ code: 1, stdout: '', stderr: '' }) }), []);
  await assert.rejects(findListeners(3000, { platform: 'linux', exec: fail({ code: 'ENOENT' }) }), /Install it/);
  await assert.rejects(findListeners(3000, { platform: 'linux', exec: fail({ code: 1, stderr: 'permission denied' }) }), /Could not inspect/);
  await assert.rejects(findListeners(3000, { platform: 'linux', exec: fail({ code: 'ETIMEDOUT' }) }), /Could not inspect/);
});

test('an empty port succeeds without sending signals', async () => {
  const result = await freePort(3000, { find: async () => [], stop: () => assert.fail('unexpected signal') });
  assert.equal(result.status, 'empty');
});

test('all matching listeners are stopped and the port is checked afterward', async () => {
  const live = new Set([81111, 82222]);
  const stopped = [];
  const result = await freePort(3000, {
    force: true, platform: 'win32', find: async () => [...live],
    stop: async (pid, force, platform) => { stopped.push(pid); assert.equal(force, true); assert.equal(platform, 'win32'); live.delete(pid); },
  });
  assert.equal(result.status, 'freed');
  assert.deepEqual(stopped, [81111, 82222]);
});

test('protected PIDs are rejected before any process is stopped', async () => {
  for (const pid of [0, 1, process.pid, process.ppid]) {
    await assert.rejects(freePort(3000, {
      find: async () => [81111, pid], stop: () => assert.fail('unexpected signal'),
    }), /protected process/);
  }
});

test('a disappeared listener is not signaled', async () => {
  let calls = 0;
  const result = await freePort(3000, { find: async () => ++calls === 1 ? [81111] : [], stop: () => assert.fail('unexpected signal') });
  assert.equal(result.status, 'freed');
});

test('a restarted listener is reported without killing the new PID', async () => {
  let live = [81111];
  await assert.rejects(freePort(3000, {
    find: async () => live,
    stop: async (pid) => { assert.equal(pid, 81111); live = [82222]; },
  }), /new listener/);
});

test('refusing termination gives an actionable force command', async () => {
  await assert.rejects(freePort(3000, { find: async () => [81111], stop: async () => {}, wait: async () => {} }), /fush 3000 --force/);
});

test('permission failure does not produce a false success', async () => {
  await assert.rejects(freePort(3000, {
    find: async () => [81111], stop: async () => { throw new Error('No permission to stop PID 81111.'); },
  }), /No permission/);
});

test('preview prints a joke and roast, with no process lookup or ANSI in a pipe', async () => {
  const out = capture();
  const err = capture();
  assert.equal(await run(['--demo'], { out, err, env: {}, free: () => assert.fail('preview must not kill') }), 0);
  assert.match(out.text, /DAD JOKE/);
  assert.match(out.text, /SKILL ISSUE/);
  assert.match(out.text, /No processes were touched/);
  assert.doesNotMatch(out.text, /\x1b/);
  assert.equal(err.text, '');
});

test('quiet mode still frees the port; errors go only to stderr', async () => {
  const out = capture();
  const err = capture();
  let called = false;
  assert.equal(await run(['3000', '--quiet'], { out, err, env: {}, free: async (port) => {
    assert.equal(port, 3000); called = true; return { status: 'empty', pids: [] };
  } }), 0);
  assert.equal(called, true);
  assert.equal(out.text, '');
  assert.equal(await run(['3000', '--quiet'], { out, err, env: {}, free: async () => { throw new Error('Permission denied'); } }), 1);
  assert.equal(out.text, '');
  assert.match(err.text, /Permission denied/);
});

test('invalid input is rejected before any process lookup', async () => {
  const out = capture(); const err = capture();
  assert.equal(await run(['3000;kill'], { out, err, env: {}, free: () => assert.fail('invalid input') }), 1);
  assert.match(err.text, /1 to 65535/);
});

test('NO_COLOR, no-roast, and no-confetti work in interactive output', async () => {
  for (const options of [{ args: ['--demo', '--no-roast'], env: { NO_COLOR: '' } }, { args: ['--demo', '--no-roast', '--no-color'], env: {} }]) {
    const out = capture(true);
    assert.equal(await run(options.args, { out, env: options.env }), 0);
    assert.doesNotMatch(out.text, /\x1b|SKILL ISSUE/);
    assert.match(out.text, /DAD JOKE/);
  }
  const out = capture(true);
  await run(['--demo', '--no-confetti'], { out, env: {} });
  assert.match(out.text, /\x1b\[/);
  assert.doesNotMatch(out.text, /\?25l/);
});

test('confetti restores the cursor and removes signal handlers', async () => {
  const out = capture(true);
  const count = process.listenerCount('SIGINT');
  await createUI({ out, env: {} }).confetti();
  assert.match(out.text, /\x1b\[\?25l/);
  assert.ok(out.text.endsWith('\x1b[0m\x1b[?25h'));
  assert.equal(process.listenerCount('SIGINT'), count);
});

async function server(t, stubborn = false) {
  const child = spawn(process.execPath, ['-e', `
    const net = require('node:net');
    ${stubborn ? "process.on('SIGTERM', () => {});" : ''}
    net.createServer().listen(0, '127.0.0.1', function () {
      process.send(this.address().port);
    });
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  });
  const [port] = await once(child, 'message');
  return { child, port, exited };
}

test('integration: CLI stops only the disposable listener; a second server stays alive', { timeout: 15000 }, async (t) => {
  const target = await server(t);
  const bystander = await server(t);
  const cli = spawn(process.execPath, [new URL('../bin/fush.js', import.meta.url).pathname, String(target.port), '--no-color'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  cli.stdout.on('data', (chunk) => { output += chunk; });
  cli.stderr.on('data', (chunk) => { errors += chunk; });
  const [code] = await once(cli, 'close');
  assert.equal(code, 0, errors);
  assert.match(output, /is free/);
  assert.match(output, /DAD JOKE/);
  await target.exited;
  assert.deepEqual(await findListeners(target.port), []);
  assert.ok((await findListeners(bystander.port)).includes(bystander.child.pid));
});

test('integration: --force stops a server that ignores SIGTERM', { timeout: 15000, skip: process.platform === 'win32' }, async (t) => {
  const target = await server(t, true);
  await assert.rejects(freePort(target.port), /--force/);
  const result = await freePort(target.port, { force: true });
  assert.equal(result.status, 'freed');
  await target.exited;
  assert.equal(target.child.signalCode, 'SIGKILL');
});
