import type { IPluginWorker, CreateWorkerOptions } from "./types"

/**
 * Detect current execution runtime.
 */
export function detectRuntime(): "browser" | "bun" | "node" {
    if (typeof (globalThis as any).Bun !== "undefined") {
        return "bun"
    }
    if (typeof window !== "undefined" || (typeof self !== "undefined" && typeof (self as any).Worker !== "undefined" && typeof (globalThis as any).process === "undefined")) {
        return "browser"
    }
    return "node"
}

/**
 * Create a cross-runtime IPluginWorker capable of executing the plugin bundle.
 * Supports:
 * - Browser: Web Worker via Blob URL
 * - Bun: Web Worker via file URL
 * - Node: node:worker_threads with globalThis.postMessage bridge
 */
export async function createPluginWorker(
    bundleCode: string,
    options: CreateWorkerOptions
): Promise<IPluginWorker> {
    const runtime = options.workerType === "web"
        ? "browser"
        : options.workerType === "node"
            ? "node"
            : detectRuntime()

    if (runtime === "browser") {
        return createBrowserWebWorker(bundleCode)
    } else if (runtime === "bun") {
        return createBunWorker(bundleCode, options.name)
    } else {
        return createNodeWorker(bundleCode, options.name)
    }
}

/**
 * Browser Web Worker implementation using Blob URL.
 */
function createBrowserWebWorker(bundleCode: string): IPluginWorker {
    const blob = new Blob([bundleCode], { type: "application/javascript" })
    const blobUrl = URL.createObjectURL(blob)
    const worker = new Worker(blobUrl, { type: "module" })

    const adapter: IPluginWorker = {
        postMessage(message: any, transfer?: Transferable[]): void {
            if (transfer && transfer.length > 0) {
                try {
                    worker.postMessage(message, transfer)
                    return
                } catch {
                    // Fallback to clone
                }
            }
            worker.postMessage(message)
        },
        onmessage: null,
        onerror: null,
        terminate(): void {
            worker.terminate()
            URL.revokeObjectURL(blobUrl)
        }
    }

    worker.onmessage = (event: MessageEvent) => {
        if (adapter.onmessage) {
            adapter.onmessage({ data: event.data })
        }
    }

    worker.onerror = (error: ErrorEvent) => {
        if (adapter.onerror) {
            adapter.onerror(error)
        }
    }

    return adapter
}

/**
 * Bun Worker implementation using a temporary file.
 */
async function createBunWorker(bundleCode: string, pluginName: string): Promise<IPluginWorker> {
    const os = await import("node:os")
    const path = await import("node:path")
    const fs = await import("node:fs/promises")

    const safeName = pluginName.replace(/[^a-zA-Z0-9-_]/g, "_")
    const tempDir = path.join(os.tmpdir(), "plugins-bun-runtime", `${safeName}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(tempDir, { recursive: true })

    const entryPath = path.join(tempDir, "index.js")
    await fs.writeFile(entryPath, bundleCode, "utf-8")

    const workerUrl = new URL(`file://${entryPath}`)
    const worker = new (globalThis as any).Worker(workerUrl, { type: "module" })

    const adapter: IPluginWorker = {
        postMessage(message: any, transfer?: Transferable[]): void {
            if (transfer && transfer.length > 0) {
                try {
                    worker.postMessage(message, transfer)
                    return
                } catch {
                    // Fallback
                }
            }
            worker.postMessage(message)
        },
        onmessage: null,
        onerror: null,
        async terminate(): Promise<void> {
            try {
                worker.terminate()
            } catch {
                // Ignore
            }
            try {
                await fs.rm(tempDir, { recursive: true, force: true })
            } catch {
                // Ignore cleanup error
            }
        }
    }

    worker.onmessage = (event: any) => {
        if (adapter.onmessage) {
            adapter.onmessage({ data: event.data })
        }
    }

    worker.onerror = (error: any) => {
        if (adapter.onerror) {
            adapter.onerror(error)
        }
    }

    return adapter
}

/**
 * Node.js Worker implementation using node:worker_threads with parentPort bridge.
 */
async function createNodeWorker(bundleCode: string, pluginName: string): Promise<IPluginWorker> {
    const os = await import("node:os")
    const path = await import("node:path")
    const fs = await import("node:fs/promises")
    const { Worker: NodeWorker } = await import("node:worker_threads")

    const safeName = pluginName.replace(/[^a-zA-Z0-9-_]/g, "_")
    const tempDir = path.join(os.tmpdir(), "plugins-node-runtime", `${safeName}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(tempDir, { recursive: true })

    // Create bundle file
    const bundlePath = path.join(tempDir, "bundle.mjs")
    await fs.writeFile(bundlePath, bundleCode, "utf-8")

    // Create entry file with parentPort bridge
    const entryCode = `
import { parentPort } from "node:worker_threads";

if (parentPort) {
    const pp = parentPort;
    globalThis.postMessage = (data, transfer) => {
        if (transfer && transfer.length > 0) {
            try {
                pp.postMessage(data, transfer);
                return;
            } catch {}
        }
        pp.postMessage(data);
    };

    pp.on("message", (data) => {
        if (typeof globalThis.onmessage === "function") {
            globalThis.onmessage({ data });
        }
    });
}

// Load plugin bundle
await import("./bundle.mjs");
`
    const entryPath = path.join(tempDir, "entry.mjs")
    await fs.writeFile(entryPath, entryCode, "utf-8")

    const nodeWorker = new NodeWorker(entryPath)

    const adapter: IPluginWorker = {
        postMessage(message: any, transfer?: Transferable[]): void {
            if (transfer && transfer.length > 0) {
                try {
                    nodeWorker.postMessage(message, transfer as any)
                    return
                } catch {
                    // Fallback
                }
            }
            nodeWorker.postMessage(message)
        },
        onmessage: null,
        onerror: null,
        async terminate(): Promise<void> {
            try {
                await nodeWorker.terminate()
            } catch {
                // Ignore
            }
            try {
                await fs.rm(tempDir, { recursive: true, force: true })
            } catch {
                // Ignore cleanup error
            }
        }
    }

    nodeWorker.on("message", (data: any) => {
        if (adapter.onmessage) {
            adapter.onmessage({ data })
        }
    })

    nodeWorker.on("error", (error: any) => {
        if (adapter.onerror) {
            adapter.onerror(error)
        }
    })

    return adapter
}
