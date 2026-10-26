# Plugin System Examples

This directory contains standalone, executable example walkthroughs demonstrating different capabilities of the `@repo/host` and `@repo/core` architecture.

## Available Examples

### 1. [Basic Host Walkthrough](./basic) (`./examples/basic/host.ts`)
Demonstrates core plugin host fundamentals:
- Packaging `.plugin` distribution files.
- Loading and activating plugins in isolated worker threads.
- Registering host-provided proxy components.
- Asset traversal (`plugin.listAssets()`, `plugin.getAsset()`).
- Dynamic RPC dependency graph (DAG) tracking.
- Cascading deactivation vs. permanent removal semantics.
- Host replacement proxy components to resurrect suspended dependents.
- Circular dependency cycle prevention.

**Run it:**
```bash
bun run example:basic
# or
bun run example
```

---

### 2. [WebAssembly (WASM) Plugins](./wasm) (`./examples/wasm/host.ts`)
Demonstrates loading and executing WebAssembly modules inside sandboxed plugins:
- Packaging compiled `.wasm` binaries as plugin assets.
- **Plugin 1 (`@example/plugin-wasm-rust`)**: Built from Rust code (`src/lib.rs`), exporting high-performance math utilities (`add`, `fibonacci`, `isPrime`, `factorial`).
- **Plugin 2 (`@example/plugin-wasm-wat`)**: Built from WebAssembly Text format (`src/cipher.wat`) with reference C source (`src/cipher.c`), exporting memory-based cryptography routines (`rot13`, `xorCipher`, `crc16`).
- **Cross-Plugin WASM Dependency**: The WAT cipher plugin queries the Rust math plugin via RPC to locate dynamic prime keys for cryptographic operations.
- **Asset Inspection**: Host application inspecting binary WASM headers (`\0asm`) and byte lengths.
- **Cascading WASM Lifecycle**: Automatic shutdown and re-instantiation of WebAssembly modules during plugin deactivation/reactivation.

**Run it:**
```bash
# 1. Build the WASM plugins
bun run build:wasm-examples

# 2. Run the mini host
bun run example:wasm
```

---

## Directory Structure

```
examples/
├── basic/
│   ├── host.ts                   # Core host walkthrough
│   └── README.md                 # Detailed documentation for basic example
├── wasm/
│   ├── host.ts                   # Mini host demonstrating WASM plugins
│   ├── README.md                 # Detailed documentation for WASM example
│   └── plugins/
│       ├── plugin-wasm-rust/     # Plugin loading Rust-built WASM asset
│       │   ├── src/lib.rs        # Rust source
│       │   ├── src/schema.ts     # Component schema
│       │   ├── src/index.ts      # Plugin worker entry
│       │   └── assets/math.wasm  # Compiled WASM asset
│       └── plugin-wasm-wat/      # Plugin loading WAT/C-built WASM asset
│           ├── src/cipher.wat    # WebAssembly Text source
│           ├── src/cipher.c      # Reference C implementation
│           ├── src/schema.ts     # Component schema
│           ├── src/index.ts      # Plugin worker entry
│           └── assets/cipher.wasm# Compiled WASM asset
├── basic-host.ts                 # Compatibility alias pointing to basic/host.ts
└── README.md                     # This directory index
```
