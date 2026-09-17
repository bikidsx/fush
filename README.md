# fush

**Free the port. Take the L.**

A tiny terminal tool that stops whatever is hogging your port, tells a terrible
joke, roasts your development habits, and showers your terminal in confetti.
Zero npm dependencies. No network calls. Just a little developer humiliation.

```sh
npm install --global fush
fush 3000
```

Or, after publication, run it without a global install:

```sh
npx fush 3000
```

```text
  fush
  free the port. take the L.

  › Checking TCP port 3000…
  ✓ :3000 is free. You may now pretend you fixed it.
    Listener PID: 48291

  DAD JOKE  I told a TCP joke. Let me know if you got it.
  SKILL ISSUE  Ctrl+C was right there. But sure, bring in the confetti cannon.
```

In an interactive terminal, you get a colorful logo and a brief confetti shower.
Want a preview? `fush --demo` never looks up or stops any process.

## Commands

```sh
fush 3000                  # Stop TCP listeners on port 3000
fush 5173 --force          # Force-stop a stubborn process
fush 8080 --no-confetti    # Skip the animation
fush 3000 --no-roast       # Keep the dad joke, skip the roast
fush 3000 --no-color       # Plain text
fush 3000 --quiet          # Silent on success, errors on stderr
fush --demo               # Harmless visual preview
fush --help
fush --version
```

## How it works

- **macOS / Linux / BSD:** finds TCP listeners with `lsof`, sends `SIGTERM`,
  and checks that the port is free. If a process refuses to exit within about
  1.5 seconds (plus lookup time), it tells you to retry with `--force` (`SIGKILL`).
- **Windows:** finds TCP listeners with `netstat.exe` and stops them with
  `taskkill.exe /PID <pid> /F`. Windows termination is always forced.
- Handles IPv4, IPv6, and multiple listeners. Does not target UDP sockets,
  outgoing connections, or process trees.
- A port that is already free exits successfully. Errors exit with code `1`.
- If a watcher starts a new listener during the operation, fush reports it;
  it does not chase and kill the replacement.

Stopping a process closes **all** its ports and can discard its in-memory work.
Use this for processes you intend to stop. fush runs with your current permissions;
it never elevates itself. Port inspection is limited to what your account can see.

Requires **Node.js 20+**. macOS typically includes `lsof`; Linux/BSD users may
need to install it through their system package manager. Windows uses built-in
commands. Actual integration tests have been run on macOS; Windows parsing and
termination selection are covered by unit tests, with native CI for each OS.

## Terminal manners

Piped output is plain and animation-free. `NO_COLOR=1` disables colors and
animation; `FORCE_COLOR=1` enables colors for captured output. `--no-confetti`
disables motion while retaining colors. Animation also stays off in CI, dumb
terminals, and very small terminal windows. Ctrl+C restores the cursor.

## Local development

```sh
npm test
npm run demo
node bin/fush.js 3000
npm link                  # Optional: install your local fush command globally
```

Tests stop only disposable servers they create, on OS-assigned ports.

## Publish to npm

This repository is prepared for publication as `fush`; it has not been published
by this setup. Registry lookup returned no existing package on September 17,
2026. Availability is not reserved until publication succeeds.

```sh
npm test
npm pack --dry-run         # Review exactly what will ship
npm login
npm publish --access public
```

Only `bin/`, `src/`, the package metadata, README, and license are shipped.
The prepublish hook runs the tests. If npm rejects the name, use a scoped package
name such as `@your-handle/fush`; the installed command can still be `fush`.

## License

MIT
