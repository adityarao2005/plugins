# `@repo/host`

Cross-runtime plugin loader and host runtime for `.plugin` files with DAG dependency management, worker sandboxing, and host proxy components. Runs in the **Browser**, in **Bun**, and in **Node.js**.

---

## Features

- 📦 **`.plugin` Archive Loader**: Loads and unpacks `.plugin` distribution zip archives from the filesystem, URLs, or binary buffers (`Uint8Array`, `ArrayBuffer`, `Blob`).
- ⚡ **Cross-Runtime Worker Execution**:
  - **Browser**: Native Web Worker via Blob URL.
  - **Bun**: Native Web Worker via `new Worker(url, { type: "module" })`.
  - **Node.js**: `node:worker_threads` with automatic bridge to `globalThis.postMessage` and `globalThis.onmessage`.
  - **In-Memory**: Isolated in-process worker adapter for fast headless testing.
- 🌳 **Dynamic DAG & Component Requirements**:
  - Tracks inter-plugin dependencies dynamically from `plugin.require(Schema)` calls.
  - Does **not** couple to `package.json` dependencies (npm packages like React or lodash do not interfere with the plugin graph).
- 🔄 **Circular Dependency Prevention**:
  - Automatically detects cycles across required components before loading or activating plugins.
  - Throws `CircularDependencyError` with the exact cycle trace.
- 🛡️ **Host Proxy Components**:
  - Host applications can register components via `host.registerComponent(Schema, instance)` to provide capabilities to worker plugins.
  - Host applications can invoke plugin methods via `host.getComponent(Schema)`.
- 🔀 **Cascading Deactivation vs. Removal**:
  - `host.deactivatePlugin(name)`: Suspends the target plugin and deactivates all downstream dependents in safe topological order. Plugins remain loaded.
  - `host.removePlugin(name)`: Invokes deactivation first, terminates the worker thread, removes the plugin from the host, and leaves dependents in a suspended deactivated state waiting for a replacement.
- 🔁 **Replacement & Auto-Reactivation**:
  - When a replacement component is registered (via host proxy or a replacement plugin), waiting dependents automatically reactivate.
- 🗂️ **Asset Traversal**:
  - Workers can fetch assets on-demand via RPC (`plugin.getAsset("config.json")`).
  - Host applications can inspect and stream assets directly (`plugin.listAssets()`, `plugin.getAsset()`).

---

## Installation

```bash
# In your monorepo or project
bun add @repo/host
```

---

## Quickstart

```typescript
import { PluginHost } from "@repo/host"
import { z } from "zod"

// 1. Initialize Host
const host = new PluginHost({
    autoActivate: true,
    autoReactivateDependents: true
})

// 2. Register Host Components (Host Proxy)
const LoggerSchema = z.object({
    log: z.custom<(msg: string) => void>()
})

host.registerComponent(LoggerSchema, {
    log: (msg) => console.log(`[Host Logger] ${msg}`)
})

// 3. Load a .plugin Archive
const plugin = await host.loadPlugin("./path/to/my-plugin.plugin")
console.log(`Loaded ${plugin.name}@${plugin.version} (State: ${plugin.state})`)

// 4. Asset Traversal
const assets = plugin.listAssets()
const configAsset = await plugin.getAsset("config.json")
if (configAsset) {
    const config = await configAsset.json()
    console.log("Plugin config:", config)
}

// 5. Deactivate Plugin (cascading to dependents)
await host.deactivatePlugin(plugin.name)

// 6. Reactivate Plugin (dependents automatically restored)
await host.activatePlugin(plugin.name)

// 7. Remove Plugin
await host.removePlugin(plugin.name)
```

---

## API Reference

### `PluginHost`

```typescript
class PluginHost {
    constructor(options?: PluginHostOptions)

    // Plugin Lifecycle
    loadPlugin(source: string | Uint8Array | ArrayBuffer | Blob, options?: LoadPluginOptions): Promise<HostedPlugin>
    activatePlugin(name: string): Promise<void>
    deactivatePlugin(name: string): Promise<DeactivateResult>
    removePlugin(name: string): Promise<RemoveResult>

    // Host Proxy Components
    registerComponent<T extends object>(schema: z.ZodType<T>, instance: T): void
    unregisterComponent<T extends object>(schema: z.ZodType<T>): void
    getComponent<T extends object>(schema: z.ZodType<T>): Promise<T | undefined>

    // Queries & Graph
    getPlugin(name: string): HostedPlugin | undefined
    listPlugins(): HostedPlugin[]
    getDependencyGraph(): DependencyGraph

    // Cleanup
    destroy(): Promise<void>
}
```

### `PluginHostOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `workerType` | `'auto' \| 'web' \| 'node' \| 'in-memory'` | `'auto'` | Execution environment adapter |
| `autoActivate` | `boolean` | `true` | Automatically activate loaded plugins if dependencies are satisfied |
| `autoReactivateDependents` | `boolean` | `true` | Automatically reactivate waiting plugins when their missing dependencies/replacements arrive |
| `rpcTimeoutMs` | `number` | `15000` | Timeout in ms for worker IPC calls |

### `DependencyGraph` (DAG)

- `addEdge(dependent, dependency)`: Adds a dependency link; throws `CircularDependencyError` if a cycle would be introduced.
- `getDirectDependencies(node)` / `getDirectDependents(node)`
- `getAllDependencies(node)` / `getAllDependents(node)`
- `topologicalSort()`: Returns topological order (dependencies first).
- `getDeactivationOrder(targetNode)`: Returns deactivation sequence (dependents first).
- `toMermaid()`: Exports a Mermaid diagram representing the graph.

---

## Deactivate vs. Remove

| Feature | `deactivatePlugin(name)` | `removePlugin(name)` |
|---|---|---|
| **Worker Thread** | Stays alive in background | Terminated (`worker.terminate()`) |
| **Plugin Record** | Retained in host registry | Removed from host registry |
| **State** | Set to `"deactivated"` | Set to `"removed"` |
| **Dependents** | Deactivated first in topological order | Deactivated first, then left waiting for replacement |
| **Reactivation** | Can be reactivated with `activatePlugin()` | Must be reloaded or replaced |

---

## License

MIT
