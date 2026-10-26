import { plugin } from "@repo/core"
import { MathCalculatorSchema, type MathCalculator } from "./schema"

export * from "./schema"

interface WasmMathExports {
    add(a: number, b: number): number
    fibonacci(n: number): number
    is_prime(n: number): number
    factorial(n: number): bigint
}

let wasmInstance: WasmMathExports | null = null

@plugin.component(MathCalculatorSchema)
export class MathCalculatorImpl implements MathCalculator {
    add(a: number, b: number): number {
        if (!wasmInstance) {
            throw new Error("WASM module not initialized: math.wasm is not ready")
        }
        return wasmInstance.add(a, b)
    }

    fibonacci(n: number): number {
        if (!wasmInstance) {
            throw new Error("WASM module not initialized: math.wasm is not ready")
        }
        return wasmInstance.fibonacci(n)
    }

    isPrime(n: number): boolean {
        if (!wasmInstance) {
            throw new Error("WASM module not initialized: math.wasm is not ready")
        }
        return wasmInstance.is_prime(n) === 1
    }

    factorial(n: number): number {
        if (!wasmInstance) {
            throw new Error("WASM module not initialized: math.wasm is not ready")
        }
        return Number(wasmInstance.factorial(n))
    }
}

plugin.onActivated = async () => {
    plugin.logger.info(`[${plugin.metadata.name}] Activating plugin...`)
    
    // 1. Fetch WASM binary asset bundled inside the plugin archive
    const wasmAsset = await plugin.getAsset("math.wasm")
    if (!wasmAsset) {
        throw new Error(`Required WASM asset "math.wasm" was not found in plugin package`)
    }

    const wasmBytes = await wasmAsset.bytes()
    plugin.logger.info(
        `[${plugin.metadata.name}] Successfully fetched math.wasm (${wasmBytes.byteLength} bytes). Compiling WebAssembly...`
    )

    // 2. Instantiate WebAssembly module from bytes
    const { instance } = await WebAssembly.instantiate(wasmBytes)
    wasmInstance = instance.exports as unknown as WasmMathExports

    plugin.logger.info(`[${plugin.metadata.name}] WebAssembly math module successfully instantiated and ready!`)
}

plugin.onDeactivated = () => {
    plugin.logger.info(`[${plugin.metadata.name}] Deactivating plugin. Cleaning up WebAssembly instance...`)
    wasmInstance = null
}

export default plugin
