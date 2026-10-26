import { plugin } from "@repo/core"
import { CryptoCipherSchema, type CryptoCipher } from "./schema"
import { MathCalculatorSchema, type MathCalculator } from "../../plugin-wasm-rust/src/schema"

export * from "./schema"

interface WasmCipherExports {
    memory: WebAssembly.Memory
    xor_cipher(ptr: number, len: number, key: number): number
    rot13(ptr: number, len: number): number
    crc16(ptr: number, len: number): number
}

let wasmInstance: WasmCipherExports | null = null

@plugin.component(CryptoCipherSchema)
export class CryptoCipherImpl implements CryptoCipher {
    // Inter-plugin dependency: requires the MathCalculator component from the Rust WASM plugin
    private mathServiceHandle = plugin.require(MathCalculatorSchema)
    private encoder = new TextEncoder()
    private decoder = new TextDecoder()

    xorCipher(text: string, key: number): { hex: string; base64: string } {
        if (!wasmInstance) {
            throw new Error("WASM module not initialized: cipher.wasm is not ready")
        }
        const bytes = this.encoder.encode(text)
        const mem = new Uint8Array(wasmInstance.memory.buffer)
        mem.set(bytes, 0)

        // Invoke WASM function compiled from WAT
        wasmInstance.xor_cipher(0, bytes.length, key)

        const ciphered = new Uint8Array(mem.subarray(0, bytes.length))
        const hex = Array.from(ciphered)
            .map(b => b.toString(16).padStart(2, "0"))
            .join("")
        const base64 = btoa(String.fromCharCode(...ciphered))
        return { hex, base64 }
    }

    xorDecipher(hexInput: string, key: number): string {
        if (!wasmInstance) {
            throw new Error("WASM module not initialized: cipher.wasm is not ready")
        }
        const match = hexInput.match(/.{1,2}/g) ?? []
        const bytes = new Uint8Array(match.map(byte => parseInt(byte, 16)))
        const mem = new Uint8Array(wasmInstance.memory.buffer)
        mem.set(bytes, 0)

        // XOR is symmetrical; running xor_cipher with the same key decodes the buffer
        wasmInstance.xor_cipher(0, bytes.length, key)

        return this.decoder.decode(mem.subarray(0, bytes.length))
    }

    rot13(text: string): string {
        if (!wasmInstance) {
            throw new Error("WASM module not initialized: cipher.wasm is not ready")
        }
        const bytes = this.encoder.encode(text)
        const mem = new Uint8Array(wasmInstance.memory.buffer)
        mem.set(bytes, 0)

        // Invoke WASM ROT13 function
        wasmInstance.rot13(0, bytes.length)

        return this.decoder.decode(mem.subarray(0, bytes.length))
    }

    crc16(text: string): string {
        if (!wasmInstance) {
            throw new Error("WASM module not initialized: cipher.wasm is not ready")
        }
        const bytes = this.encoder.encode(text)
        const mem = new Uint8Array(wasmInstance.memory.buffer)
        mem.set(bytes, 0)

        const checksum = wasmInstance.crc16(0, bytes.length)
        return "0x" + checksum.toString(16).toUpperCase().padStart(4, "0")
    }

    async computePrimeKeyHash(seed: string, primeLimit: number): Promise<{ key: number; hash: string }> {
        // Query the remote MathCalculator component (from plugin-wasm-rust) via RPC
        const math = await this.mathServiceHandle.get()
        if (!math) {
            throw new Error("MathCalculator dependency is unavailable. Is plugin-wasm-rust active?")
        }

        // Use the Rust WASM module to dynamically locate the largest prime number below primeLimit
        let selectedPrimeKey = 17
        for (let candidate = primeLimit; candidate >= 2; candidate--) {
            if (await math.isPrime(candidate)) {
                selectedPrimeKey = candidate
                break
            }
        }

        // Use the WAT WASM module to encrypt and hash the seed using the prime key
        const cipherResult = this.xorCipher(seed, selectedPrimeKey)
        const checksum = this.crc16(seed)

        return {
            key: selectedPrimeKey,
            hash: `${cipherResult.hex}:${checksum}`
        }
    }
}

plugin.onActivated = async () => {
    plugin.logger.info(`[${plugin.metadata.name}] Activating plugin...`)

    // 1. Fetch WASM binary asset bundled inside this plugin archive
    const wasmAsset = await plugin.getAsset("cipher.wasm")
    if (!wasmAsset) {
        throw new Error(`Required WASM asset "cipher.wasm" was not found in plugin package`)
    }

    const wasmBytes = await wasmAsset.bytes()
    plugin.logger.info(
        `[${plugin.metadata.name}] Successfully fetched cipher.wasm (${wasmBytes.byteLength} bytes). Instantiating WebAssembly...`
    )

    // 2. Instantiate WebAssembly module from bytes
    const { instance } = await WebAssembly.instantiate(wasmBytes)
    wasmInstance = instance.exports as unknown as WasmCipherExports

    plugin.logger.info(`[${plugin.metadata.name}] WebAssembly cipher module successfully instantiated and ready!`)
}

plugin.onDeactivated = () => {
    plugin.logger.info(`[${plugin.metadata.name}] Deactivating plugin. Cleaning up WebAssembly instance...`)
    wasmInstance = null
}

export default plugin
