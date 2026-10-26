import JSZip from "jszip"
import type { PluginAsset } from "@repo/core"
import type { PackageManifest } from "./types"

export interface LoadedArchive {
    manifest: PackageManifest
    bundleCode: string
    bundleBytes: Uint8Array
    rawAssets: Map<string, Uint8Array>
}

/**
 * Creates a standard PluginAsset object conforming to @repo/core.
 */
export function createHostAsset(path: string, bytes: Uint8Array): PluginAsset {
    return {
        path,
        size: bytes.byteLength,
        async bytes(): Promise<Uint8Array> {
            return bytes
        },
        async arrayBuffer(): Promise<ArrayBuffer> {
            const buffer = new ArrayBuffer(bytes.byteLength)
            new Uint8Array(buffer).set(bytes)
            return buffer
        },
        async text(): Promise<string> {
            return new TextDecoder().decode(bytes)
        },
        async json<T = unknown>(schema?: any): Promise<T> {
            const text = new TextDecoder().decode(bytes)
            const parsed = JSON.parse(text)
            return schema ? schema.parse(parsed) : (parsed as T)
        },
        stream(): ReadableStream<Uint8Array> {
            return new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(bytes)
                    controller.close()
                }
            })
        }
    }
}

/**
 * Represents an unpacked .plugin distribution archive.
 */
export class PluginArchive {
    readonly manifest: PackageManifest
    readonly bundleCode: string
    readonly bundleBytes: Uint8Array
    // Stores normalized asset paths -> Uint8Array
    private assets = new Map<string, Uint8Array>()
    // Original relative asset paths (e.g. "default-rates.json")
    private assetList: string[] = []

    constructor(data: LoadedArchive) {
        this.manifest = data.manifest
        this.bundleCode = data.bundleCode
        this.bundleBytes = data.bundleBytes
        this.assets = data.rawAssets
        this.assetList = Array.from(data.rawAssets.keys())
    }

    /**
     * Load and parse a .plugin archive from a file system path, ArrayBuffer, Uint8Array, or Blob.
     * Works identically across Browser, Bun, and Node.
     */
    static async load(source: string | Uint8Array | ArrayBuffer | Blob): Promise<PluginArchive> {
        let zipBytes: Uint8Array

        if (typeof source === "string") {
            // If running in Node or Bun:
            if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
                const fs = await import("node:fs/promises")
                const buffer = await fs.readFile(source)
                zipBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
            } else if (typeof fetch === "function") {
                // If in browser fetching from URL
                const response = await fetch(source)
                if (!response.ok) {
                    throw new Error(`Failed to fetch .plugin file from "${source}": ${response.statusText}`)
                }
                zipBytes = new Uint8Array(await response.arrayBuffer())
            } else {
                throw new Error(`Cannot load plugin path "${source}": no suitable filesystem or fetch API available`)
            }
        } else if (typeof Blob !== "undefined" && source instanceof Blob) {
            zipBytes = new Uint8Array(await source.arrayBuffer())
        } else if (source instanceof ArrayBuffer) {
            zipBytes = new Uint8Array(source)
        } else if (source instanceof Uint8Array) {
            zipBytes = source
        } else {
            throw new Error("Invalid .plugin source: expected file path string, Uint8Array, ArrayBuffer, or Blob")
        }

        const zip = await JSZip.loadAsync(zipBytes)

        // 1. Read and parse package.json
        const pkgFile = zip.file("package.json")
        if (!pkgFile) {
            throw new Error('Invalid .plugin file: missing "package.json" in archive root')
        }
        const pkgText = await pkgFile.async("text")
        let manifest: PackageManifest
        try {
            manifest = JSON.parse(pkgText) as PackageManifest
        } catch (err: any) {
            throw new Error(`Invalid .plugin manifest: failed to parse package.json: ${err.message}`)
        }

        if (!manifest.name) {
            throw new Error('Invalid .plugin manifest: "name" field is required in package.json')
        }
        if (!manifest.version) {
            manifest.version = "0.0.0"
        }

        // 2. Read entry point (index.js or manifest.main)
        const entryName = manifest.main ?? "index.js"
        const entryFile = zip.file(entryName) ?? zip.file("index.js")
        if (!entryFile) {
            throw new Error(`Invalid .plugin file: entrypoint "${entryName}" not found in archive`)
        }
        const bundleBytes = await entryFile.async("uint8array")
        const bundleCode = await entryFile.async("text")

        // 3. Extract all asset files
        const rawAssets = new Map<string, Uint8Array>()

        // Find all files in the zip that are not root package.json or root index.js
        for (const [filename, fileObj] of Object.entries(zip.files)) {
            const entry = fileObj as { dir: boolean; async: (type: "uint8array") => Promise<Uint8Array> }
            if (entry.dir) continue
            const normalized = filename.replace(/\\/g, "/").replace(/^\/+/, "")

            if (normalized === "package.json" || normalized === "index.js") {
                continue
            }

            const content = await entry.async("uint8array")

            // Index with both full archive path ("assets/default-rates.json")
            // and stripped path ("default-rates.json") for flexible resolution
            rawAssets.set(normalized, content)
            if (normalized.startsWith("assets/")) {
                const stripped = normalized.slice("assets/".length)
                rawAssets.set(stripped, content)
            }
        }

        return new PluginArchive({
            manifest,
            bundleCode,
            bundleBytes,
            rawAssets
        })
    }

    /**
     * Returns a list of relative asset paths available in the archive.
     */
    listAssets(prefix?: string): string[] {
        // Collect normalized paths without duplicates (prefer non-prefixed if available)
        const unique = new Set<string>()
        for (const path of this.assetList) {
            if (path.startsWith("assets/")) {
                const stripped = path.slice("assets/".length)
                unique.add(stripped)
            } else {
                unique.add(path)
            }
        }

        const list = Array.from(unique)
        if (prefix) {
            return list.filter(p => p.startsWith(prefix))
        }
        return list
    }

    /**
     * Check if asset exists.
     */
    hasAsset(assetPath: string): boolean {
        const normalized = assetPath.replace(/\\/g, "/").replace(/^\/+/, "")
        return (
            this.assets.has(normalized) ||
            this.assets.has(`assets/${normalized}`) ||
            (normalized.startsWith("assets/") && this.assets.has(normalized.slice("assets/".length)))
        )
    }

    /**
     * Get raw asset bytes.
     */
    getRawAsset(assetPath: string): Uint8Array | undefined {
        const normalized = assetPath.replace(/\\/g, "/").replace(/^\/+/, "")
        return (
            this.assets.get(normalized) ??
            this.assets.get(`assets/${normalized}`) ??
            (normalized.startsWith("assets/") ? this.assets.get(normalized.slice("assets/".length)) : undefined)
        )
    }

    /**
     * Get standard PluginAsset instance for an asset path.
     */
    getAsset(assetPath: string): PluginAsset | undefined {
        const raw = this.getRawAsset(assetPath)
        if (!raw) return undefined
        return createHostAsset(assetPath, raw)
    }
}
