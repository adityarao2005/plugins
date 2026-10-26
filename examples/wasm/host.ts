import path from "node:path"
import { z } from "zod"
import { PluginHost } from "../../packages/host/src"
import { MathCalculatorSchema, type MathCalculator } from "./plugins/plugin-wasm-rust/src/schema"
import { CryptoCipherSchema, type CryptoCipher } from "./plugins/plugin-wasm-wat/src/schema"

// 1. Define a host-provided monitoring/audit component
const HostAuditSchema = z.object({
    audit: z.custom<(action: string, details: Record<string, any>) => void>()
})

class HostAuditLogger {
    audit(action: string, details: Record<string, any>): void {
        console.log(`[Host Audit] [${action}]`, details)
    }
}

async function main() {
    console.log("================================================================")
    console.log("  WebAssembly (WASM) Plugin Demonstration Walkthrough")
    console.log("  Plugins with Rust, WAT & C compiled modules as loaded assets")
    console.log("================================================================\n")

    // Initialize the Plugin Host
    const host = new PluginHost({
        autoActivate: true,
        autoReactivateDependents: true
    })

    // Register a host component
    host.registerComponent(HostAuditSchema, new HostAuditLogger())
    console.log("✓ Registered host component: HostAuditSchema\n")

    // Paths to built .plugin archives
    const rustPluginPath = path.resolve(
        import.meta.dir,
        "./plugins/plugin-wasm-rust/dist/plugin-wasm-rust.plugin"
    )
    const watPluginPath = path.resolve(
        import.meta.dir,
        "./plugins/plugin-wasm-wat/dist/plugin-wasm-wat.plugin"
    )

    // -------------------------------------------------------------------------
    // STEP 1: Load Plugin 1 (Rust WASM Math Plugin)
    // -------------------------------------------------------------------------
    console.log("----------------------------------------------------------------")
    console.log("1. Loading Plugin 1: @example/plugin-wasm-rust (built from Rust)")
    console.log("----------------------------------------------------------------")
    const rustPlugin = await host.loadPlugin(rustPluginPath)
    console.log(`✓ Plugin loaded: "${rustPlugin.name}" (version: ${rustPlugin.version}, state: ${rustPlugin.state})`)

    // Asset inspection
    console.log("\nInspecting bundled assets in Rust plugin:")
    const rustAssets = rustPlugin.listAssets()
    console.log("  Assets list:", rustAssets)

    const mathWasmAsset = await rustPlugin.getAsset("math.wasm")
    if (mathWasmAsset) {
        const bytes = await mathWasmAsset.bytes()
        console.log(`  Asset "math.wasm": ${bytes.byteLength} bytes (size: ${mathWasmAsset.size} bytes)`)
        const header = Array.from(bytes.slice(0, 4)).map(b => "0x" + b.toString(16).padStart(2, "0")).join(" ")
        console.log(`  WASM Magic Header: ${header} (\\0asm)`)
    }

    // Call Rust WASM methods via Host RPC Proxy
    console.log("\nInvoking MathCalculator component (backed by Rust WASM):")
    const mathService = await host.getComponent(MathCalculatorSchema)
    if (!mathService) {
        throw new Error("Failed to get MathCalculator component from host")
    }

    const sum = await mathService.add(40, 2)
    console.log(`  • add(40, 2)             = ${sum}`)

    const fib10 = await mathService.fibonacci(10)
    console.log(`  • fibonacci(10)          = ${fib10}`)

    const prime97 = await mathService.isPrime(97)
    console.log(`  • isPrime(97)            = ${prime97}`)

    const prime100 = await mathService.isPrime(100)
    console.log(`  • isPrime(100)           = ${prime100}`)

    const fact6 = await mathService.factorial(6)
    console.log(`  • factorial(6)           = ${fact6}`)

    // -------------------------------------------------------------------------
    // STEP 2: Load Plugin 2 (WAT / C WASM Cipher Plugin)
    // -------------------------------------------------------------------------
    console.log("\n----------------------------------------------------------------")
    console.log("2. Loading Plugin 2: @example/plugin-wasm-wat (built from WAT & C)")
    console.log("----------------------------------------------------------------")
    const watPlugin = await host.loadPlugin(watPluginPath)
    console.log(`✓ Plugin loaded: "${watPlugin.name}" (version: ${watPlugin.version}, state: ${watPlugin.state})`)

    // Asset inspection
    console.log("\nInspecting bundled assets in WAT plugin:")
    const watAssets = watPlugin.listAssets()
    console.log("  Assets list:", watAssets)

    const cipherWasmAsset = await watPlugin.getAsset("cipher.wasm")
    if (cipherWasmAsset) {
        const bytes = await cipherWasmAsset.bytes()
        console.log(`  Asset "cipher.wasm": ${bytes.byteLength} bytes`)
    }

    // -------------------------------------------------------------------------
    // STEP 3: Inspect Dependency Graph (DAG)
    // -------------------------------------------------------------------------
    console.log("\n----------------------------------------------------------------")
    console.log("3. Inspecting Inter-Plugin WASM Dependency Graph (DAG)")
    console.log("----------------------------------------------------------------")
    const dag = host.getDependencyGraph()
    console.log("  WAT Plugin Direct Dependencies:", Array.from(dag.getDirectDependencies(watPlugin.name)))
    console.log("  Rust Plugin Direct Dependents: ", Array.from(dag.getDirectDependents(rustPlugin.name)))
    console.log("\n  Mermaid Topology Diagram:\n" + dag.toMermaid().split("\n").map(l => "    " + l).join("\n"))

    // -------------------------------------------------------------------------
    // STEP 4: Call WAT WASM methods & Composite Multi-WASM Execution
    // -------------------------------------------------------------------------
    console.log("\n----------------------------------------------------------------")
    console.log("4. Executing Cipher & Multi-WASM Composite Workflows")
    console.log("----------------------------------------------------------------")
    const cryptoService = await host.getComponent(CryptoCipherSchema)
    if (!cryptoService) {
        throw new Error("Failed to get CryptoCipher component from host")
    }

    const testMessage = "Antigravity WASM Microkernel!"
    console.log(`Original message: "${testMessage}"`)

    // ROT13 via WAT WebAssembly memory transformation
    const rot13Encoded = await cryptoService.rot13(testMessage)
    console.log(`  • ROT13 Encoded:          "${rot13Encoded}"`)
    const rot13Decoded = await cryptoService.rot13(rot13Encoded)
    console.log(`  • ROT13 Decoded Back:     "${rot13Decoded}"`)

    // XOR Cipher with key 0x7E
    const xorResult = await cryptoService.xorCipher(testMessage, 0x7E)
    console.log(`  • XOR Cipher (key 0x7E):  Hex: ${xorResult.hex}`)
    console.log(`                            Base64: ${xorResult.base64}`)
    const xorDecrypted = await cryptoService.xorDecipher(xorResult.hex, 0x7E)
    console.log(`  • XOR Decrypted Back:     "${xorDecrypted}"`)

    // CRC16 Checksum via WAT
    const crc = await cryptoService.crc16(testMessage)
    console.log(`  • CRC-16 Checksum:        ${crc}`)

    // Composite Call: WAT Cipher uses Rust Math via RPC to dynamically find prime keys!
    console.log("\nComposite Multi-Plugin Execution (WAT + Rust):")
    console.log("  Requesting secure prime-key hash with limit 50...")
    const compositeResult = await cryptoService.computePrimeKeyHash(testMessage, 50)
    console.log(`  • Prime Key (via Rust):   ${compositeResult.key}`)
    console.log(`  • Hash Signature:         ${compositeResult.hash}`)

    // -------------------------------------------------------------------------
    // STEP 5: Cascading Lifecycle Demonstration
    // -------------------------------------------------------------------------
    console.log("\n----------------------------------------------------------------")
    console.log("5. Cascading Lifecycle Demonstration with WASM Plugins")
    console.log("----------------------------------------------------------------")
    console.log("[Action] Deactivating Rust Math Plugin...")
    const deact = await host.deactivatePlugin(rustPlugin.name)
    console.log("  Cascading deactivation triggered for:", deact.cascadingDependents)
    console.log("  Rust Plugin state:", host.getPlugin(rustPlugin.name)?.state)
    console.log(
        "  WAT Plugin state: ",
        host.getPlugin(watPlugin.name)?.state,
        `(reason: ${host.getPlugin(watPlugin.name)?.deactivatedReason})`
    )

    console.log("\n[Action] Reactivating Rust Math Plugin...")
    await host.activatePlugin(rustPlugin.name)
    console.log("  Rust Plugin state:", host.getPlugin(rustPlugin.name)?.state)
    console.log("  WAT Plugin state: ", host.getPlugin(watPlugin.name)?.state)

    // -------------------------------------------------------------------------
    // STEP 6: Clean Shutdown
    // -------------------------------------------------------------------------
    console.log("\n----------------------------------------------------------------")
    console.log("6. Terminating Host and Workers")
    console.log("----------------------------------------------------------------")
    await host.destroy()
    console.log("✓ Host successfully destroyed and workers terminated!\n")
}

main().catch(err => {
    console.error("WASM example error:", err)
    process.exit(1)
})
