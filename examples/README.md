# Examples

This directory contains executable walkthroughs demonstrating the `@repo/host` library.

## Running the Example

Make sure the fixture plugins are compiled first:
```bash
bun run build:fixtures
```

Then run the basic host walkthrough:
```bash
bun run ./examples/basic-host.ts
```

Or via npm/bun script from root:
```bash
bun run example
```

## What the Example Demonstrates

1. **Host Proxy Components**: Registering a component from the host application using `host.registerComponent(schema, implementation)`.
2. **`.plugin` File Loading**: Loading and extracting distribution archives from disk with `host.loadPlugin(path)`.
3. **Asset Traversal**: Querying available assets (`plugin.listAssets()`) and reading contents (`asset.json()`, `asset.text()`, `asset.bytes()`, etc.).
4. **RPC & Dynamic Dependency Graph (DAG)**: Tracking inter-plugin communication and schema requirements without relying on `package.json` dependencies.
5. **Cascading Deactivation vs. Removal**:
   - `host.deactivatePlugin()`: Cascades deactivation in topological order to dependents first, leaving plugins loaded.
   - `host.removePlugin()`: Invokes deactivation first, terminates the worker thread, removes the plugin, and keeps dependents in a suspended deactivated state waiting for a replacement.
6. **Host Replacement Proxy**: Providing a replacement component directly from the host to satisfy missing dependencies, automatically reactivating waiting plugins.
7. **Circular Dependency Prevention**: Detecting and rejecting circular dependency cycles before they can corrupt runtime state.
