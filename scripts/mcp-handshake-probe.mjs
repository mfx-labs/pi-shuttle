#!/usr/bin/env node
/**
 * PS-6 Lane B MCP handshake probe (test/CI evidence only — not part of the
 * product). Spawns the installed `pi-shuttle start` operator surface with
 * piped stdio (the Gateway child inherits the same pipes), performs the MCP
 * initialize + tools/list exchange through the REAL installed Gateway,
 * EOF-shuts down, and verifies: clean exit 0, exactly the closed nine-tool
 * surface, and byte-clean protocol stdout (every stdout line is a JSON-RPC
 * line — no pi-shuttle banner/prefix). The PS-5 Linux harness, adapted to
 * the direct-executable CLI (PS5-LINUX-001 closure) and parameterized for
 * CI lanes.
 *
 * Usage (env):
 *   HOME       = isolated operator home (with runtime.json + receipt)
 *   PATH       = operator PATH (node/git/pi as required)
 *   PSHUTTLE   = absolute path to the installed pi-shuttle executable
 *
 * Exit: 0 = handshake green; 1 = assertion failed; 2 = usage error.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const home = process.env.HOME;
const pathEnv = process.env.PATH;
const cli = process.env.PSHUTTLE;
if (!home || !pathEnv || !cli) {
  console.error('HOME / PATH / PSHUTTLE are required');
  process.exit(2);
}

const child = spawn(cli, ['start'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, HOME: home, PATH: pathEnv },
});
child.stdin.on('error', () => {});
const stderrChunks = [];
child.stderr.on('data', (d) => stderrChunks.push(d.toString('utf8')));

const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
const lines = [];
const pending = new Map();
let nextId = 1;
let failed = false;

function send(method, params) {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  child.stdin.write(msg + '\n');
  return new Promise((resolve) => pending.set(id, resolve));
}

function fail(reason) {
  failed = true;
  console.error(`HANDSHAKE FAIL: ${reason}`);
}

rl.on('line', (line) => {
  lines.push(line);
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    fail(`NON-JSON stdout line: ${JSON.stringify(line)}`);
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const resolve = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

function waitFor(fn, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    fn().then((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}

const childExit = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));

// 1. initialize
const init = await waitFor(() => send('initialize', {
  protocolVersion: '2026-07-28',
  capabilities: {},
  clientInfo: { name: 'ps6-handshake-probe', version: '0.1.0' },
}), 15_000);
if (init === null) fail('initialize timed out');
else if (init.error !== undefined) fail(`initialize error: ${JSON.stringify(init.error)}`);
else {
  const serverInfo = init.result?.serverInfo;
  if (serverInfo?.name !== '@project-gateway/artifact-core' || serverInfo?.version !== '0.1.0') {
    fail(`unexpected serverInfo: ${JSON.stringify(serverInfo)}`);
  }
}
child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}\n');

// 2. tools/list — exactly the closed nine-tool surface, no authority tools.
let toolCount = 0;
const tools = await waitFor(() => send('tools/list', {}), 15_000);
if (tools === null) fail('tools/list timed out');
else {
  const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
  toolCount = names.length;
  const expected = ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class', 'draft-artifact', 'persist-artifact', 'inspect-changes'].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail(`tool surface mismatch: ${JSON.stringify(names)}`);
  }
}

// 3. EOF shutdown + clean exit.
child.stdin.end();
const { code, signal } = await childExit;
if (signal !== null) fail(`gateway exited by signal ${signal}`);
if (code !== 0) fail(`gateway exit ${code}: ${stderrChunks.join('').slice(0, 400)}`);

// 4. Byte-clean protocol stdout: every line must be JSON-RPC.
for (const line of lines) {
  if (!line.startsWith('{')) fail(`non-protocol stdout line: ${JSON.stringify(line)}`);
}
if (stderrChunks.join('').trim().length > 0) {
  console.log('stderr (bounded diagnostics only):', stderrChunks.join('').trim().slice(0, 400));
}

if (failed) process.exit(1);
console.log(`MCP handshake OK: initialize + exactly ${toolCount}/9 tools verified, clean EOF exit 0`);
process.exit(0);
