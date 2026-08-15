---
name: run-civ6mcp
description: Build, run, and drive the civ6mcp MCP server. Use when asked to start civ6mcp, test its MCP tools, call a tool against live Civ 6 game data, run a smoke test, or invoke the parsers directly.
---

civ6mcp is a stdio MCP server (JSON-RPC over newline-delimited stdin/stdout) that reads Civilization VI save files and CSV game logs. Drive it via `.claude/skills/run-civ6mcp/driver.mjs`, which spawns the built server and speaks the MCP handshake for you — there is no port, no UI, nothing to screenshot.

All paths are relative to the repo root.

## Prerequisites

- Node.js 18+ (verified on v24.19.0, Windows 11).
- For live data: Civilization VI with `GameHistoryLogLevel=1` in `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VI\UserOptions.txt`, and at least one turn played. Most tools read the CSVs in `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VI\Logs\` (chiefly `Player_Stats.csv`); no game data ⇒ tools return "no data" errors but the server itself still runs.

## Setup + Build

```powershell
npm install
npm run build   # tsc → dist/
```

`npm install` prints `npm warn allow-scripts esbuild@0.27.2 (postinstall...)` — harmless, esbuild is a tsx dependency and works without the postinstall approval.

## Run (agent path)

The driver spawns `node dist/index.js` per invocation, does the MCP `initialize` handshake, runs your command, and kills the server. Rebuild first if you changed `src/`.

```powershell
node .claude/skills/run-civ6mcp/driver.mjs smoke
node .claude/skills/run-civ6mcp/driver.mjs list
node .claude/skills/run-civ6mcp/driver.mjs call get_civ_statistics
node .claude/skills/run-civ6mcp/driver.mjs call get_score_breakdown '{}'
```

| command | what it does |
|---|---|
| `smoke` | tools/list + one log-based call (`get_civ_statistics`) + one save-based call (`list_saves`). Prints `SMOKE PASS`/`SMOKE FAIL`; exit code 1 on failure. `list_saves` finding nothing is non-fatal (see Gotchas). |
| `list` | Lists all registered tools with descriptions (21 as of Aug 2026). |
| `call <tool> ['{json}']` | Calls one tool, prints its text content. Exit 1 if the tool returns `isError`. |

Expected smoke output on this machine (live game in progress):

```
tools/list OK — 21 tools
get_civ_statistics OK — [ { "civilization": "Byzantium", ...
list_saves OK — No save files found ...
SMOKE PASS
```

## Direct invocation (parser-level PRs)

The parsers are plain synchronous functions — no server needed. Run them straight from `src/` with tsx:

```powershell
npx tsx -e "import { parseGameHistory } from './src/history-parser.ts'; const h = parseGameHistory(); console.log('turns:', h.turns.length)"
```

`parseGameHistory()` returns `{ turns, civilizations }` or `null` if `Player_Stats.csv` is missing/empty. Other entry points: `parseSaveFile`/`listSaveFiles` in `src/parser.ts`, the `parse*`/`format*` functions in `src/logs-parser.ts`, path resolution in `src/paths.ts`.

## Run (human path)

`npm start` (or `npm run dev` for tsx on src) starts the server and waits on stdin — useless standalone. The real human path is Claude Desktop: add `{"command": "node", "args": ["<abs-path>\\dist\\index.js"]}` under `mcpServers` in `%APPDATA%\Claude\claude_desktop_config.json` (see README.md).

## Test

No test suite exists (`package.json` has no test script). `driver.mjs smoke` is the closest thing.

## Gotchas

- **Documents folder redirection (OneDrive).** `getSavesDirectory()` in `src/paths.ts` resolves the real Documents folder from the registry (`HKCU\...\User Shell Folders\Personal`) because OneDrive can redirect it away from `homedir()\Documents`. If `list_saves` reports "No save files found" but saves exist, check that resolution first. Log paths use `%LOCALAPPDATA%` and are unaffected.
- **`read_game_state` and `get_strategy_brief` require a `save_path` argument** (get one from `list_saves`); calling them without it returns a zod `invalid_type` error.
- **stdout is protocol-only.** The server writes `Civ6 MCP Server running on stdio` to **stderr**; the driver prefixes it `[server]`. Never print to the server's stdout when editing `src/index.ts` — it corrupts the JSON-RPC stream.
- **`tsx -e` compiles to CJS** — top-level `await` fails with `Top-level await is currently not supported with the "cjs" output format`. The parsers are synchronous anyway; just call them directly.
- **Log data is per-game and per-turn.** The Logs CSVs are overwritten when a new game starts and appended each completed turn; mid-turn only the human player's row is fresh. Early-game (turn < ~5) many tools return sparse or "no data" results — that's the data, not a bug.

## Troubleshooting

- **`DRIVER ERROR: timeout waiting for initialize`**: `dist/index.js` missing or stale — run `npm run build` first.
- **`get_civ_statistics ERROR` in smoke**: `Player_Stats.csv` absent or empty — enable `GameHistoryLogLevel=1` and play a turn (see Prerequisites).
