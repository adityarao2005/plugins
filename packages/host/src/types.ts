import type { PluginAsset } from "@repo/core"

export type PluginState = "loaded" | "active" | "deactivated" | "removed"

export interface PackageManifest {
    name: string
    version: string
    description?: string
    main?: string
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    [key: string]: unknown
}

export interface HostedPlugin {
    readonly name: string
    readonly version: string
    readonly manifest: PackageManifest
    readonly state: PluginState
    readonly exportedSchemas: any[]
    readonly requiredSchemas: any[]
    readonly assets: string[]
    readonly waitingForDependencies: string[]
    readonly deactivatedReason?: "manual" | "dependency-deactivated" | "missing-dependency"

    listAssets(prefix?: string): string[]
    getAsset(path: string): Promise<PluginAsset | undefined>
    hasAsset(path: string): boolean
}

export type WorkerType = "auto" | "web" | "node" | "in-memory"

export interface PluginHostOptions {
    /**
     * Type of worker execution model to use.
     * - 'auto': Detects runtime (Browser, Bun, Node) and selects optimal worker.
     * - 'web': Uses standard Web Worker (Blob URL / URL).
     * - 'node': Uses node:worker_threads.
     * - 'in-memory': Fast in-process worker simulation (great for tests & restricted environments).
     */
    workerType?: WorkerType

    /**
     * Whether to automatically activate plugins when loaded.
     * Default: true.
     */
    autoActivate?: boolean

    /**
     * Whether to automatically reactivate waiting dependent plugins when
     * a replacement or missing dependency becomes available.
     * Default: true.
     */
    autoReactivateDependents?: boolean

    /**
     * Timeout in milliseconds for RPC requests to plugin workers.
     * Default: 15000.
     */
    rpcTimeoutMs?: number
}

export interface LoadPluginOptions {
    /**
     * Override plugin name from package.json if needed.
     */
    name?: string

    /**
     * Override or declare additional explicit plugin dependencies.
     */
    dependencies?: string[]

    /**
     * Whether to automatically activate upon loading.
     */
    autoActivate?: boolean
}

export interface DeactivateResult {
    /**
     * Target plugin that was requested to deactivate.
     */
    target: string

    /**
     * List of all plugins that were deactivated in order (dependents first, then target).
     */
    deactivated: string[]

    /**
     * Dependent plugins that were deactivated as a cascading result.
     */
    cascadingDependents: string[]
}

export interface RemoveResult {
    /**
     * Name of the removed plugin.
     */
    removed: string

    /**
     * Names of plugins that were deactivated because they depended on the removed plugin.
     */
    deactivatedDependents: string[]
}

export interface IPluginWorker {
    postMessage(message: any, transfer?: Transferable[]): void
    onmessage: ((event: { data: any }) => void) | null
    onerror: ((error: any) => void) | null
    terminate(): Promise<void> | void
}
