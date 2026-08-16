# AGENTS.md — for AI coding agents

## What this repo is

A DeepSeek Harness (DSH) plugin **package** (not a single-file plugin): the
server-side plugin registers one model tool, `mmx_bridge`, which dispatches
to the MiniMax `mmx` CLI (`mmx-cli` npm package) for describe / image / video /
speech / music / cover / search / quota actions. The package also ships a
built-in **client bundle** (declared via `dsh.client` in package.json) that
renders inline audio/video players in the Web GUI conversation.

## Layout

- `package.json` — package metadata: `exports` maps `.` → `lib/index.js` and
  `./client` → `lib/client.js`; `dsh.client.platform = "web"` makes the client
  bundle load automatically with the package.
- `lib/index.js` — the whole server-side plugin (single file, plain ESM, no
  build step). Serves generated files over HTTP (`/mmx-files/<filename>`, prefix
  must NOT have a trailing slash — the webserver matches `${prefix}/` — with
  HTTP Range support).
- `lib/client.js` — built-in client enhancement: `MmxToolView` (tool call card
  renderer with embedded `<audio>`/`<video>` players) + `installInlinePlayers`
  (message-body `/mmx-files/*` link → player card upgrade). Loads automatically;
  no manual merge into `dsh-plugin-manager`.
- `cordis.patch.yml` — mount example: install the package into the profile's
  `packages/` (+ node_modules symlink) and add a row `name: dsh-mmx-bridge`.
- `README.md` — user-facing docs in **Chinese** (default); `README.en.md` is the
  English version, linked from the README headers.

## How it works (short version)

`apply(ctx)` builds a `tool` object and registers it through `ctx.get('tools')`.
Each action maps to one `mmx <command>` invocation spawned via
`node:child_process` with `--quiet --non-interactive --output json`.
Runtime settings (`enabled`, `count`) are read from a JSON control file on
every call; status is mirrored to a status file. A `webServer` route can update
the control file. The client bundle registers a keyed `tool.call.toolview`
renderer and a MutationObserver-based inline player enhancer.

## Key conventions

- The plugin is intentionally dependency-free at runtime (only Node builtins).
- It uses `node:child_process`, not `ctx.subprocess` (patch-layer contexts
  suspend that service).
- Tool descriptions are Chinese by default.
- All paths are configurable via `MMX_*` env vars only — patch-layer loader
  entries get no `ctx.config`, so do not read it in this plugin.
- The client bundle is plain ESM loaded by the browser's `__ModuleLoader__`
  (factory(require) pattern, React via require).

## Before editing

`node --check lib/index.js && node --check lib/client.js` after any change.
If you change the tool schema, update the action tables in both READMEs.
