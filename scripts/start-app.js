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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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

console.log(`${colors.bright}${colors.cyan}
===========================================================
  🚀  Google Drive Uploader — Local Dev Server
===========================================================
${colors.reset}`);

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
const npx = isWindows ? 'npx.cmd' : 'npx';

console.log(`${colors.bright}${colors.green}Starting services:${colors.reset}`);
console.log(` • Backend (API / D1 / R2 / Workflows): ${colors.cyan}http://localhost:8787${colors.reset}`);
console.log(` • Frontend (React 18 SPA):           ${colors.magenta}http://localhost:5173${colors.reset}\n`);

const workerProcess = spawn(npx, ['wrangler', 'dev', '--port', '8787'], {
  cwd: rootDir,
  shell: true,
  env: { ...process.env, FORCE_COLOR: '1' },
});

const viteProcess = spawn(npx, ['vite', '--port', '5173', '--open'], {
  cwd: rootDir,
  shell: true,
  env: { ...process.env, FORCE_COLOR: '1' },
});

// Stream Worker logs
workerProcess.stdout.on('data', (data) => log('API', colors.cyan, data));
workerProcess.stderr.on('data', (data) => log('API', colors.red, data));

// Stream Vite logs
viteProcess.stdout.on('data', (data) => log('WEB', colors.magenta, data));
viteProcess.stderr.on('data', (data) => log('WEB', colors.red, data));

// Handle exit
function cleanup() {
  console.log(`\n${colors.yellow}Shutting down servers...${colors.reset}`);
  try {
    if (isWindows) {
      if (workerProcess.pid) execSync(`taskkill /PID ${workerProcess.pid} /T /F`, { stdio: 'ignore' });
      if (viteProcess.pid) execSync(`taskkill /PID ${viteProcess.pid} /T /F`, { stdio: 'ignore' });
    } else {
      workerProcess.kill('SIGTERM');
      viteProcess.kill('SIGTERM');
    }
  } catch {
    // Ignore error if process already exited
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
