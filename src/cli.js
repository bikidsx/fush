import { readFileSync } from 'node:fs';
import { freePort, parsePort } from './ports.js';
import { createUI } from './ui.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const help = `fush — free the port. take the L.

Usage
  fush <port> [options]
  fush --demo

Examples
  fush 3000                 Stop the TCP listener, get roasted
  fush 5173 --force         Force-stop a stubborn listener
  fush 8080 --no-confetti   Party quietly
  fush 3000 --quiet         No jokes, no output; useful in scripts
  fush --demo               Preview the party without killing anything

Options
  -f, --force       Send SIGKILL instead of SIGTERM on macOS/Linux
  -q, --quiet       Suppress normal output (errors still go to stderr)
  --no-confetti    Skip animation
  --no-color       Plain text; also respects NO_COLOR
  --no-roast       Keep the joke, spare your ego
  -h, --help        Show this help
  -v, --version     Print version

Stops all visible TCP listeners on the specified port, including IPv6.
Windows uses taskkill /F. A free port is a successful no-op.
Stopping a process also closes its other ports. Node.js 20+ required.
`;

export function parseArgs(args) {
  const options = {};
  const ports = [];
  const flags = {
    '--force': 'force', '-f': 'force', '--quiet': 'quiet', '-q': 'quiet',
    '--no-confetti': 'noConfetti', '--no-color': 'noColor', '--no-roast': 'noRoast',
    '--demo': 'demo', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version',
  };
  for (const arg of args) {
    if (Object.hasOwn(flags, arg)) options[flags[arg]] = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}. Run fush --help for usage.`);
    else ports.push(arg);
  }
  if (options.help || options.version) return options;
  if (ports.length > 1) throw new Error('One port at a time. Try: fush 3000');
  if (!ports.length && !options.demo) {
    if (!args.length) return { help: true };
    throw new Error('Missing port. Try: fush 3000');
  }
  options.port = parsePort(ports[0] ?? '3000');
  return options;
}

export async function run(args, {
  out = process.stdout,
  err = process.stderr,
  env = process.env,
  free = freePort,
} = {}) {
  let ui = createUI({ out, env, noColor: args.includes('--no-color') });
  try {
    const options = parseArgs(args);
    ui = createUI({ out, env, noColor: options.noColor });
    if (options.help) { out.write(help); return 0; }
    if (options.version) { out.write(`${version}\n`); return 0; }
    if (!options.quiet) {
      ui.banner();
      if (!options.demo) ui.progress(options.port);
    }
    const result = options.demo
      ? { status: 'freed', pids: [12345] }
      : await free(options.port, { force: options.force });
    if (!options.quiet) {
      ui.success(options.port, result, options);
      if (!options.noConfetti && result.status === 'freed') await ui.confetti();
    }
    return 0;
  } catch (error) {
    // Error output must respect stderr's own TTY rather than stdout's.
    const errorUI = createUI({ out: err, env, noColor: args.includes('--no-color') });
    err.write(errorUI.error(error.message));
    return 1;
  }
}
