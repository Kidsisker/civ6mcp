#!/usr/bin/env node
// Driver for the civ6mcp stdio MCP server.
// Spawns `node dist/index.js` and speaks newline-delimited JSON-RPC (MCP).
//
// Usage (from repo root, after `npm run build`):
//   node .claude/skills/run-civ6mcp/driver.mjs list
//   node .claude/skills/run-civ6mcp/driver.mjs call <tool-name> ['{"json":"args"}']
//   node .claude/skills/run-civ6mcp/driver.mjs smoke
//
// Exit code 0 on success; non-zero if the server errors or a tool call
// returns isError.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const serverEntry = join(repoRoot, 'dist', 'index.js');

const [, , cmd, toolName, argsJson] = process.argv;

function startServer() {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  let buf = '';
  const pending = new Map(); // id -> resolve
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });

  let nextId = 1;
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }
      }, 15000);
    });
  const notify = (method, params = {}) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

  return { child, request, notify };
}

async function withServer(fn) {
  const { child, request, notify } = startServer();
  try {
    const init = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'civ6mcp-driver', version: '1.0.0' },
    });
    if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
    notify('notifications/initialized');
    return await fn(request);
  } finally {
    child.kill();
  }
}

function textOf(result) {
  return (result?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

async function main() {
  if (cmd === 'list') {
    await withServer(async (request) => {
      const res = await request('tools/list');
      for (const t of res.result.tools) console.log(`${t.name} — ${t.description}`);
      console.log(`\n${res.result.tools.length} tools`);
    });
  } else if (cmd === 'call') {
    if (!toolName) throw new Error('usage: driver.mjs call <tool-name> [json-args]');
    await withServer(async (request) => {
      const res = await request('tools/call', {
        name: toolName,
        arguments: argsJson ? JSON.parse(argsJson) : {},
      });
      if (res.error) throw new Error(JSON.stringify(res.error));
      console.log(textOf(res.result));
      if (res.result.isError) process.exitCode = 1;
    });
  } else if (cmd === 'smoke') {
    await withServer(async (request) => {
      const list = await request('tools/list');
      const n = list.result.tools.length;
      console.log(`tools/list OK — ${n} tools`);
      if (n < 1) throw new Error('no tools registered');

      // Log-based tool: works whenever Civ 6 logging has produced Player_Stats.csv.
      const stats = await request('tools/call', { name: 'get_civ_statistics', arguments: {} });
      const statsText = textOf(stats.result);
      console.log(`get_civ_statistics ${stats.result.isError ? 'ERROR' : 'OK'} — ${statsText.slice(0, 120).replace(/\n/g, ' ')}...`);

      // Save-based tool: may legitimately find nothing (saves dir missing/empty).
      const saves = await request('tools/call', { name: 'list_saves', arguments: {} });
      console.log(`list_saves ${saves.result.isError ? 'ERROR (non-fatal: no saves dir?)' : 'OK'} — ${textOf(saves.result).slice(0, 120).replace(/\n/g, ' ')}...`);

      if (stats.result.isError) {
        console.error('SMOKE FAIL: get_civ_statistics errored — is GameHistoryLogLevel=1 set and a turn played?');
        process.exitCode = 1;
      } else {
        console.log('SMOKE PASS');
      }
    });
  } else {
    console.error('usage: driver.mjs <list|call|smoke> [tool-name] [json-args]');
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(`DRIVER ERROR: ${e.message}`);
  process.exit(1);
});
