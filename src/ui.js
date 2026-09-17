import { setTimeout as sleep } from 'node:timers/promises';

const jokes = [
  'Why did the port go to therapy? Too many unresolved connections.',
  'I told a TCP joke. Let me know if you got it.',
  'Why did the server break up with the client? It needed some space to process.',
  'A socket walks into a bar. The bartender says: you look well connected.',
  'I would tell you a UDP joke, but you might not get it.',
  'Why was the developer cold? They left all their ports open.',
];
const roasts = [
  'You have 47 terminal tabs and somehow none of them is the right one.',
  'Your process management strategy is apparently "hope it goes away".',
  'Another abandoned dev server. Your laptop is a foster home for Node processes.',
  'You can center a div, but you cannot find the terminal you started.',
  'Ctrl+C was right there. But sure, bring in the confetti cannon.',
  'You called this debugging. Your port called it an eviction.',
];
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const palette = [205, 81, 154, 221, 141];

export function createUI({ out = process.stdout, env = process.env, noColor = false } = {}) {
  const color = !noColor && !('NO_COLOR' in env) && env.TERM !== 'dumb' &&
    (Boolean(out.isTTY) || ('FORCE_COLOR' in env && env.FORCE_COLOR !== '0'));
  const paint = (text, code) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
  const line = (text = '') => out.write(`${text}\n`);

  function banner() {
    line();
    if (out.isTTY && (out.columns ?? 80) >= 42) {
      [
        '  █▀▀ █ █ █▀▀ █ █',
        '  █▀  █ █ ▀▀█ █▀█',
        '  ▀   ▀▀▀ ▀▀▀ ▀ ▀',
      ].forEach((row, i) => line(paint(row, `1;38;5;${palette[i]}`)));
    } else line(paint('  fush', '1;38;5;205'));
    line(paint('  free the port. take the L.', '2'));
    line();
  }

  async function confetti() {
    if (!out.isTTY || !color || env.CI || (out.columns ?? 80) < 24 || (out.rows ?? 24) < 14) return;
    const height = 6;
    const width = Math.min(out.columns ?? 80, 76) - 2;
    const pieces = Array.from({ length: 40 }, () => ({
      x: Math.floor(Math.random() * width),
      y: -Math.floor(Math.random() * height * 2),
      speed: Math.random() > 0.5 ? 1 : 0.65,
      symbol: pick(['*', '+', '.', '◆', '▪']),
      color: pick(palette),
    }));
    const restore = () => out.write('\x1b[0m\x1b[?25h');
    const interrupt = () => { restore(); process.exit(130); };
    const terminate = () => { restore(); process.exit(143); };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    out.write('\x1b[?25l' + '\n'.repeat(height));
    try {
      for (let frame = 0; frame < 17; frame++) {
        // Stop drawing on resize, avoiding wrapped lines and cursor drift.
        if ((out.columns ?? 80) < width + 2) break;
        const grid = Array.from({ length: height }, () => Array(width).fill(' '));
        for (const piece of pieces) {
          const y = Math.floor(piece.y + frame * piece.speed);
          if (y >= 0 && y < height) grid[y][piece.x] = paint(piece.symbol, `38;5;${piece.color}`);
        }
        out.write(`\x1b[${height}A` + grid.map((row) => `\r\x1b[2K ${row.join('')}\n`).join(''));
        await sleep(45);
      }
      out.write(`\x1b[${height}A` + '\r\x1b[2K\n'.repeat(height) + `\x1b[${height}A`);
    } finally {
      restore();
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    }
  }

  return {
    banner, confetti, line,
    progress: (port) => line(paint(`  › Checking TCP port ${port}…`, '2')),
    success(port, result, { noRoast = false, demo = false } = {}) {
      line(paint(`  ${result.status === 'empty' ? '○' : '✓'} :${port} ${result.status === 'empty' ? 'is already free.' : 'is free. You may now pretend you fixed it.'}`, '1;38;5;154'));
      if (result.pids.length) line(paint(`    ${demo ? 'Preview only · example' : 'Listener'} PID${result.pids.length > 1 ? 's' : ''}: ${result.pids.join(', ')}`, '2'));
      if (demo) line(paint('    Demo mode. No processes were touched.', '2'));
      line();
      line(`  ${paint('DAD JOKE', '1;38;5;81')}  ${pick(jokes)}`);
      if (!noRoast) line(`  ${paint('SKILL ISSUE', '1;38;5;205')}  ${pick(roasts)}`);
      line();
    },
    error: (message) => paint(`  ✗ ${message}\n`, '31'),
  };
}
