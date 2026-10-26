# WebAssembly (WASM) Plugin Examples

This directory demonstrates building and loading WebAssembly modules inside plugins as packaged assets, running inside sandboxed worker threads managed by `@repo/host`.

## Architecture Overview

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                              PluginHost                                │
 │                                                                        │
 │  • Registers host components (Audit, telemetry, etc.)                  │
 │  • Manages DAG & cascades deactivation / reactivation                  │
 │  • Proxies remote RPC calls to plugin workers                          │
 └──────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
                    ▼                                 ▼
   ┌────────────────────────────────┐ ┌────────────────────────────────┐
   │ Worker: plugin-wasm-rust       │ │ Worker: plugin-wasm-wat        │
   │                                │ │                                │
   │ 1. Fetches "math.wasm" via:    │ │ 1. Fetches "cipher.wasm" via:  │
   │    plugin.getAsset("math.wasm")│ │    plugin.getAsset(...)        │
   │ 2. WebAssembly.instantiate()   │ │ 2. WebAssembly.instantiate()   │
   │ 3. Exports MathCalculator      │ │ 3. Requires MathCalculator RPC │
   │    • add(), fibonacci()        │ │ 4. Exports CryptoCipher        │
   │    • isPrime(), factorial()    │ │    • rot13(), xorCipher()      │
   │                                │ │    • computePrimeKeyHash()     │
   └────────────────────────────────┘ └────────────────────────────────┘
```

## The Two WASM Plugins

### 1. `@example/plugin-wasm-rust` (Built from Rust)
- **Source**: [`src/lib.rs`](file:///home/aditya/projects/plugins/examples/wasm/plugins/plugin-wasm-rust/src/lib.rs)
- **Asset**: `assets/math.wasm` (built via `rustc --target wasm32-unknown-unknown -O --crate-type=cdylib`)
- **Plugin Entry**: [`src/index.ts`](file:///home/aditya/projects/plugins/examples/wasm/plugins/plugin-wasm-rust/src/index.ts)
- **Exported Schema**: [`MathCalculatorSchema`](file:///home/aditya/projects/plugins/examples/wasm/plugins/plugin-wasm-rust/src/schema.ts)
  - `add(a: number, b: number): number`
  - `fibonacci(n: number): number`
  - `isPrime(n: number): boolean`
  - `factorial(n: number): number`

### 2. `@example/plugin-wasm-wat` (Built from WAT & C)
- **WAT Source**: [`src/cipher.wat`](file:///home/aditya/projects/plugins/examples/wasm/plugins/plugin-wasm-wat/src/cipher.wat)
- **Reference C Source**: [`src/cipher.c`](file:///home/aditya/projects/plugins/examples/wasm/plugins/plugin-wasm-wat/src/cipher.c)
- **Asset**: `assets/cipher.wasm` (built via `bun x wat2wasm ./src/cipher.wat`)
- **Plugin Entry**: [`src/index.ts`](file:///home/aditya/projects/plugins/examples/wasm/plugins/plugin-wasm-wat/src/index.ts)
- **Exported Schema**: [`CryptoCipherSchema`](file:///home/aditya/projects/plugins/examples/wasm/plugins/plugin-wasm-wat/src/schema.ts)
  - `xorCipher(text, key)` & `xorDecipher(hex, key)`
  - `rot13(text)`
  - `crc16(text)`
  - `computePrimeKeyHash(seed, primeLimit)` — **Cross-WASM composite method** that queries the Rust plugin's `MathCalculator` via RPC to locate a prime key, then encrypts and hashes the seed using its own WebAssembly linear memory!

---

## How WASM Loading Works via Plugin Assets

In this plugin architecture, WebAssembly files are bundled as **assets** in the `.plugin` archive using the CLI packer tool (`-a ./assets`).

When the plugin is activated in its worker thread:
```typescript
plugin.onActivated = async () => {
    // 1. Fetch WASM binary asset on-demand from plugin archive
    const wasmAsset = await plugin.getAsset("math.wasm")
    const wasmBytes = await wasmAsset.bytes()

    // 2. Instantiate WebAssembly module
    const { instance } = await WebAssembly.instantiate(wasmBytes)

    // 3. Bind exports to component instance
    wasmInstance = instance.exports
}
```

Host applications can also inspect, hash, and stream assets directly before or while plugins are running:
```typescript
const mathAsset = await plugin.getAsset("math.wasm")
console.log(mathAsset.size)
const bytes = await mathAsset.bytes()
```

---

## How to Build and Run

### 1. Build the WASM plugins
Compile the Rust and WAT modules, bundle the TypeScript code, and package the `.plugin` archives:
```bash
bun run build:wasm-examples
```

Or build individually:
```bash
# Rust plugin:
cd examples/wasm/plugins/plugin-wasm-rust && bun run build

# WAT / C plugin:
cd examples/wasm/plugins/plugin-wasm-wat && bun run build
```

### 2. Run the WASM mini host walkthrough
```bash
bun run example:wasm
# or directly:
bun run ./examples/wasm/host.ts
```

---

## What the Walkthrough Demonstrates

1. **Asset Loading**: Extracting and inspecting WebAssembly `.wasm` binaries bundled inside `.plugin` distribution files.
2. **WebAssembly Instantiation inside Worker Sandboxes**: Loading compiled Rust and WAT bytecode into sandboxed plugin worker threads.
3. **RPC Execution**: Invoking exported WebAssembly math and cryptography methods across thread boundaries via host RPC.
4. **Inter-Plugin WASM Dependency**: Tracking dependencies in the DAG where the WAT cipher plugin calls the Rust math plugin dynamically to compute prime cipher keys.
5. **Cascading Lifecycle**: Deactivating the Rust plugin automatically cascades to deactivating the WAT plugin, and reactivating the dependency cleanly re-initializes both WebAssembly modules.
