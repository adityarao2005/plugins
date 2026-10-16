# monorepo

A Bun + TypeScript monorepo for **libraries and CLIs that run anywhere** — the
browser, Node, Bun, Deno, or an edge runtime. No framework, no frontend, no
runtime lock-in.

## Layout

```
.
├── apps/                      # deployable / runnable things
│   └── cli/                   # @repo/cli — runs under Bun or Node
│       ├── src/
│       │   ├── index.ts       # entry point (shebang + stdout/stderr I/O)
│       │   ├── run.ts         # pure logic, easy to test
│       │   └── run.test.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/                  # reusable libraries
│   └── core/                  # @repo/core — universal, dependency-free
│       ├── src/
│       │   ├── index.ts       # public entry / re-exports
│       │   ├── text.ts
│       │   └── index.test.ts
│       ├── package.json
│       └── tsconfig.json
├── package.json               # workspace root + shared scripts
└── tsconfig.json              # shared base TypeScript config
```

Every package and app owns a `src/` folder, its own `package.json`, and its own
`tsconfig.json` that extends the root config. All TypeScript source lives in
`src/`.

## Requirements

- **Bun** `>= 1.1` (install with `curl -fsSL https://bun.sh/install | bash`)
- **Node** `>= 18` — only needed to run the compiled CLI; not required for development

## Quick start

```bash
bun install      # link workspaces, install dev deps

bun run test     # run all tests (from source, no build needed)
bun run cli slugify "Hello, World!"   # run the CLI from source
bun run build    # emit dist/ for every package and app

node apps/cli/dist/index.js title "runs on node too"
```

## Scripts (root)

| Command | Description |
| --- | --- |
| `bun run build` | Build `packages/*` first, then `apps/*` (topological order) |
| `bun run typecheck` | `tsc --noEmit` in every workspace |
| `bun run test` | `bun test` across the whole repo |
| `bun run cli <args>` | Run the CLI straight from source |
| `bun run clean` | Remove all `dist/` folders |

## How packages resolve

Each package publishes a single `exports` entry with several conditions:

```jsonc
"exports": {
  ".": {
    "types":  "./src/index.ts",   // TypeScript + editor: source types, no build needed
    "bun":    "./src/index.ts",   // Bun runtime/bundler: source (fast dev, no build)
    "import": "./dist/index.js",  // Node, browsers via bundlers, anything else
    "default":"./dist/index.js"
  }
}
```

- **Develop in Bun** → `bun run cli`, `bun test`, and editors read TypeScript
  source directly. Nothing to build.
- **Everything else** (Node, bundlers, published consumers) → resolves to the
  prebuilt `dist/`, so no TypeScript toolchain is required downstream.

Because the non-Bun path points at `dist/`, `bun run build` builds `packages/*`
before `apps/*`. If you build a single app by hand before its libraries,
you'll get `Could not resolve "@repo/core"` — build the packages first (the
root `build` script already does).

## Portability rules

CLIs may use runtime APIs (`process`, `console`, `node:*`), but **libraries in
`packages/` should stay universal**:

- Avoid `node:*` builtins and `Bun.*` globals in libraries.
- Prefer web-standard APIs (`fetch`, `URL`, `TextEncoder`, `crypto.subtle`).
- Libraries are compiled with `--target browser`, which fails on Node-only
  imports — a useful guardrail.
- Apps default to `--target node` (the most conservative runtime).

## Adding a package or app

```bash
mkdir -p packages/my-lib/src
```

Then copy `packages/core/package.json` and `tsconfig.json`, rename the package,
and point `exports` at your `src/index.ts`. Workspaces pick it up automatically
(`apps/*`, `packages/*` in the root `package.json`).

## Standalone CLI binary

To produce a single self-contained executable (bundled Bun runtime, no
`node_modules` needed):

```bash
bun run --filter '@repo/cli' build:bin   # → apps/cli/dist/repo-cli
```

## Releasing

`types` currently points at `src/` for ideal local DX. When you're ready to
publish to npm, generate declarations during the build (`tsc --emitDeclarationOnly`)
and point `types`/`exports.types` at `dist/index.d.ts`, and add a
`publishConfig` if you want to keep the source-types override for development.
