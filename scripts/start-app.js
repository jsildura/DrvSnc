#!/usr/bin/env node

/**
 * Google Drive Uploader - Unified Local Dev Server Runner
 *
 * This script:
 * 1. Verifies local .dev.vars configuration
 * 2. Runs local D1 SQLite database migrations
 * 3. Starts Cloudflare Worker backend (API, D1, R2, Workflows) on port 8787
 * 4. Starts Vite React SPA frontend on port 5173
 * 5. Manages unified logging and graceful shutdown
 */

import { spawn, execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// wrangler dev binds workerd to IPv4 loopback only, so probe that exact address.
const API_HOST = '127.0.0.1';
const API_PORT = 8787;
const WEB_PORT = 5173;
const API_READY_TIMEOUT_MS = 90_000;

// ANSI Color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

function log(prefix, color, message) {
  const lines = message.toString().split('\n');
  for (const line of lines) {
    if (line.trim().length > 0) {
      console.log(`${color}[${prefix}]${colors.reset} ${line}`);
    }
  }
}

/** Resolve true as soon as something accepts a TCP connection on host:port. */
function probePort(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** Poll host:port until it accepts a connection, the timeout elapses, or shouldAbort() goes true. */
async function waitForPort(port, host, timeoutMs, shouldAbort) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldAbort?.()) return false;
    if (await probePort(port, host)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

console.log(`${colors.bright}${colors.cyan}
===========================================================
  🚀  Google Drive Uploader — Local Dev Server
===========================================================
${colors.reset}`);

// 0. Refuse to start a second stack.
// On Windows two `wrangler dev` instances can BOTH bind 127.0.0.1:8787 rather
// than the second one failing. That produces a split brain: Vite proxies /api to
// whichever workerd wins each connection, so requests land on an instance that
// doesn't hold your session. It surfaces as intermittent 502s and spurious
// "Reconnect Google Drive" errors, and both instances write the same local D1.
if (await probePort(API_PORT, API_HOST)) {
  console.log(
    `${colors.red}❌ Port ${API_PORT} is already in use — a dev stack is very likely already running.${colors.reset}\n` +
      `${colors.yellow}   Starting a second one would let two workers share the port, which causes\n` +
      `   random 502s and "Reconnect Google Drive" errors. Refusing to start.${colors.reset}\n\n` +
      `${colors.dim}   Reuse the running stack, or stop it first:${colors.reset}\n` +
      `${colors.dim}     netstat -ano | findstr :${API_PORT}${colors.reset}\n` +
      `${colors.dim}     taskkill /PID <pid> /T /F${colors.reset}\n`
  );
  process.exit(1);
}

// Vite silently falls back to 5174+ when 5173 is taken, which desyncs the URL the
// browser opens from the one printed below. Worth a warning even though the API
// check above catches a full duplicate stack.
if (await probePort(WEB_PORT, 'localhost')) {
  console.log(
    `${colors.yellow}⚠️  Port ${WEB_PORT} is already in use. Vite will fall back to ${WEB_PORT + 1}, ` +
      `so the URL printed below may not match the one that opens.${colors.reset}\n`
  );
}

// 1. Check .dev.vars
const devVarsPath = path.join(rootDir, '.dev.vars');
const devVarsExamplePath = path.join(rootDir, '.dev.vars.example');

if (!fs.existsSync(devVarsPath)) {
  if (fs.existsSync(devVarsExamplePath)) {
    console.log(`${colors.yellow}⚠️  .dev.vars not found. Creating from .dev.vars.example...${colors.reset}`);
    fs.copyFileSync(devVarsExamplePath, devVarsPath);
    console.log(`${colors.green}✅ Created .dev.vars${colors.reset}`);
  }
}

// 2. Run Local Migrations
console.log(`${colors.cyan}📦 Applying local D1 database migrations...${colors.reset}`);
try {
  const isWindows = process.platform === 'win32';
  const npxCmd = isWindows ? 'npx.cmd' : 'npx';
  execSync(`${npxCmd} wrangler d1 migrations apply DB --local`, {
    cwd: rootDir,
    stdio: 'pipe',
  });
  console.log(`${colors.green}✅ Local database schema up to date!${colors.reset}\n`);
} catch (err) {
  console.log(`${colors.yellow}⚠️  Note on D1 migration: ${err.message}${colors.reset}\n`);
}

// 3. Spawn Backend (Wrangler) & Frontend (Vite)
const isWindows = process.platform === 'win32';

console.log(`${colors.bright}${colors.green}Starting services:${colors.reset}`);
console.log(` • Backend (API / D1 / R2 / Workflows): ${colors.cyan}http://${API_HOST}:${API_PORT}${colors.reset}`);
console.log(` • Frontend (React 18 SPA):           ${colors.magenta}http://localhost:${WEB_PORT}${colors.reset}\n`);

const workerProcess = isWindows
  ? spawn(`npx.cmd wrangler dev --port ${API_PORT}`, { cwd: rootDir, shell: true, env: { ...process.env, FORCE_COLOR: '1' } })
  : spawn('npx', ['wrangler', 'dev', '--port', String(API_PORT)], { cwd: rootDir, shell: false, env: { ...process.env, FORCE_COLOR: '1' } });

let viteProcess = null;
let workerExit = null;

// Stream Worker logs
workerProcess.stdout.on('data', (data) => log('API', colors.cyan, data));
workerProcess.stderr.on('data', (data) => log('API', colors.red, data));
workerProcess.on('exit', (code, signal) => {
  workerExit = { code, signal };
});

// Vite proxies /api to the worker but does not retry a refused upstream: it
// returns 502 instead. Starting Vite with --open while workerd is still booting
// therefore opens the browser into a window where every /api call 502s. Wait for
// the worker to accept connections first.
console.log(`${colors.dim}Waiting for the API on ${API_HOST}:${API_PORT} before starting the frontend...${colors.reset}`);
const apiReady = await waitForPort(API_PORT, API_HOST, API_READY_TIMEOUT_MS, () => workerExit !== null);

if (apiReady) {
  console.log(`${colors.green}✅ API is accepting connections.${colors.reset}\n`);
} else if (workerExit) {
  // Don't open a browser onto a frontend whose every /api call is guaranteed to 502.
  console.log(
    `\n${colors.red}❌ The API process exited (code ${workerExit.code ?? workerExit.signal}) before it started ` +
      `listening on ${API_HOST}:${API_PORT}. Fix the error logged above, then re-run.${colors.reset}\n`
  );
  process.exit(1);
} else {
  console.log(
    `${colors.yellow}⚠️  API was not reachable within ${API_READY_TIMEOUT_MS / 1000}s. ` +
      `Starting the frontend anyway — /api calls will return 502 until the worker finishes booting.${colors.reset}\n`
  );
}

viteProcess = isWindows
  ? spawn(`npx.cmd vite --port ${WEB_PORT} --open`, { cwd: rootDir, shell: true, env: { ...process.env, FORCE_COLOR: '1' } })
  : spawn('npx', ['vite', '--port', String(WEB_PORT), '--open'], { cwd: rootDir, shell: false, env: { ...process.env, FORCE_COLOR: '1' } });

// Stream Vite logs
viteProcess.stdout.on('data', (data) => log('WEB', colors.magenta, data));
viteProcess.stderr.on('data', (data) => log('WEB', colors.red, data));

// Handle exit
let shuttingDown = false;

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${colors.yellow}Shutting down servers...${colors.reset}`);
  try {
    if (isWindows) {
      if (workerProcess.pid) execSync(`taskkill /PID ${workerProcess.pid} /T /F`, { stdio: 'ignore' });
      if (viteProcess?.pid) execSync(`taskkill /PID ${viteProcess.pid} /T /F`, { stdio: 'ignore' });
    } else {
      workerProcess.kill('SIGTERM');
      viteProcess?.kill('SIGTERM');
    }
  } catch {
    // Ignore error if process already exited
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
// Final safety net; must not call process.exit() from inside an exit handler.
process.on('exit', cleanup);
