import type { z } from "zod"
import { DependencyGraph } from "./dag"
import { PluginArchive } from "./archive"
import { ComponentRegistry, getSchemaKey } from "./component-registry"
import { createPluginWorker } from "./worker/worker-adapter"
import type { IPluginWorker } from "./worker/types"
import type {
    PluginState,
    PackageManifest,
    HostedPlugin,
    PluginHostOptions,
    LoadPluginOptions,
    DeactivateResult,
    RemoveResult
} from "./types"
import {
    PluginNotFoundError,
    PluginStateError,
    PluginExecutionError
} from "./errors"


interface PendingRequest<T = any> {
    type: string
    resolve: (val: T) => void
    reject: (err: any) => void
    timer: ReturnType<typeof setTimeout>
}

interface InternalPluginRecord {
    name: string
    version: string
    manifest: PackageManifest
    archive: PluginArchive
    worker: IPluginWorker
    state: PluginState
    exportedSchemas: any[]
    requiredSchemas: any[]
    waitingForDependencies: Set<string>
    deactivatedReason?: "manual" | "dependency-deactivated" | "missing-dependency"
    pendingRequests: Map<string, PendingRequest>
}

function generateId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID()
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export class PluginHost {
    private plugins = new Map<string, InternalPluginRecord>()
    private dag = new DependencyGraph()
    private componentRegistry = new ComponentRegistry()
    private options: Required<PluginHostOptions>

    constructor(options: PluginHostOptions = {}) {
        this.options = {
            workerType: options.workerType ?? "auto",
            autoActivate: options.autoActivate ?? true,
            autoReactivateDependents: options.autoReactivateDependents ?? true,
            rpcTimeoutMs: options.rpcTimeoutMs ?? 15000
        }

        // Register host in DAG as a provider node
        this.dag.addNode("@host")
    }

    /**
     * Get the current dependency graph.
     */
    getDependencyGraph(): DependencyGraph {
        return this.dag
    }

    /**
     * Register a component from the host (acting as a host proxy plugin).
     */
    registerComponent<T extends object>(schema: z.ZodType<T>, instance: T): void {
        const schemaKey = this.componentRegistry.registerHostComponent(schema, instance)

        // Check if any existing plugins were waiting for this schema
        for (const plugin of this.plugins.values()) {
            if (plugin.waitingForDependencies.has(schemaKey)) {
                this.dag.addEdge(plugin.name, "@host")
                plugin.waitingForDependencies.delete(schemaKey)
                plugin.waitingForDependencies.delete("@host")
            }
        }

        // Auto-reactivate any dependents waiting for this component
        if (this.options.autoReactivateDependents) {
            this.tryReactivateWaitingPlugins()
        }
    }

    /**
     * Unregister a host component.
     */
    unregisterComponent<T extends object>(schema: z.ZodType<T>): void {
        this.componentRegistry.unregisterHostComponent(schema)
    }

    /**
     * Get a component either from the host or from an active plugin via an RPC proxy.
     */
    async getComponent<T extends object>(schema: z.ZodType<T>): Promise<T | undefined> {
        const provider = this.componentRegistry.findProvider(schema)
        if (!provider) {
            return undefined
        }

        if (provider.providerType === "host") {
            return provider.instance as T
        }

        // Provided by an active plugin: create host-side RPC Proxy
        const pluginRecord = this.plugins.get(provider.providerName)
        if (!pluginRecord || pluginRecord.state !== "active") {
            return undefined
        }

        const selfHost = this
        return new Proxy({} as any, {
            get(_target, prop, receiver) {
                if (typeof prop === "symbol" || prop === "then" || prop === "catch" || prop === "finally") {
                    return Reflect.get(_target, prop, receiver)
                }

                return async (...args: any[]) => {
                    return selfHost.invokePluginComponent(
                        provider.providerName,
                        schema,
                        String(prop),
                        args
                    )
                }
            }
        }) as T
    }

    /**
     * Load a plugin from a .plugin file or binary data.
     */
    async loadPlugin(
        source: string | Uint8Array | ArrayBuffer | Blob,
        options: LoadPluginOptions = {}
    ): Promise<HostedPlugin> {
        // 1. Unpack archive
        const archive = await PluginArchive.load(source)
        const name = options.name ?? archive.manifest.name
        const version = archive.manifest.version

        if (this.plugins.has(name)) {
            const existing = this.plugins.get(name)!
            if (existing.state !== "removed") {
                throw new Error(`Plugin "${name}" is already loaded in host (state: ${existing.state})`)
            }
        }

        // 2. Add node to DAG and register explicit dependencies if specified
        this.dag.addNode(name)
        if (options.dependencies) {
            for (const dep of options.dependencies) {
                if (this.plugins.has(dep) || dep === "@host") {
                    this.dag.addEdge(name, dep)
                }
            }
        }

        // 3. Create worker
        const worker = await createPluginWorker(archive.bundleCode, {
            name,
            workerType: this.options.workerType
        })

        const pluginRecord: InternalPluginRecord = {
            name,
            version,
            manifest: archive.manifest,
            archive,
            worker,
            state: "loaded",
            exportedSchemas: [],
            requiredSchemas: [],
            waitingForDependencies: new Set(),
            pendingRequests: new Map()
        }

        if (options.dependencies) {
            for (const dep of options.dependencies) {
                const depPlugin = this.plugins.get(dep)
                if (!depPlugin || depPlugin.state !== "active") {
                    if (dep !== "@host") {
                        pluginRecord.waitingForDependencies.add(dep)
                    }
                }
            }
        }

        this.plugins.set(name, pluginRecord)

        // 4. Attach worker message handling
        this.setupWorkerMessaging(pluginRecord)

        // 5. Send initialize message to worker
        const assetPaths = archive.listAssets()
        worker.postMessage({
            type: "initialize",
            metadata: { name, version },
            assetPaths
        })

        // Allow initial top-level require announcements from the worker to arrive
        await new Promise(resolve => setTimeout(resolve, 20))

        // 6. Check if we should auto-activate
        const shouldActivate = options.autoActivate ?? this.options.autoActivate
        if (shouldActivate && pluginRecord.waitingForDependencies.size === 0) {
            await this.activatePlugin(name)
        }

        // 7. If this plugin satisfies dependencies of previously waiting plugins, reactivate them
        if (this.options.autoReactivateDependents) {
            await this.tryReactivateWaitingPlugins()
        }

        return this.createHostedPluginView(pluginRecord)
    }

    /**
     * Activate a loaded or deactivated plugin.
     */
    async activatePlugin(name: string): Promise<void> {
        const plugin = this.plugins.get(name)
        if (!plugin) {
            throw new PluginNotFoundError(name)
        }

        if (plugin.state === "active") {
            return
        }
        if (plugin.state === "removed") {
            throw new PluginStateError(name, plugin.state, "Cannot activate a removed plugin")
        }

        // Verify that all direct dependencies are active
        const dependencies = this.dag.getDirectDependencies(name)
        for (const dep of dependencies) {
            if (dep === "@host") continue
            const depPlugin = this.plugins.get(dep)
            if (!depPlugin || depPlugin.state !== "active") {
                plugin.waitingForDependencies.add(dep)
                plugin.state = "deactivated"
                plugin.deactivatedReason = "missing-dependency"
                throw new Error(`Cannot activate "${name}": dependency "${dep}" is not active`)
            }
        }

        // Send activate to worker and await bundle-activated
        const res = await this.sendWorkerRequest<{ schemas: any[] }>(plugin, {
            type: "activate"
        })

        plugin.state = "active"
        plugin.deactivatedReason = undefined
        plugin.waitingForDependencies.clear()
        plugin.exportedSchemas = res.schemas ?? []

        // Register exported schemas in component registry
        for (const schema of plugin.exportedSchemas) {
            const schemaKey = this.componentRegistry.registerPluginComponent(name, schema)
            // Check if any existing plugins were waiting for this plugin or its schema
            for (const other of this.plugins.values()) {
                if (other.name === name) continue
                if (other.waitingForDependencies.has(schemaKey) || other.waitingForDependencies.has(name)) {
                    this.dag.addEdge(other.name, name)
                    other.waitingForDependencies.delete(schemaKey)
                    other.waitingForDependencies.delete(name)
                }
            }
        }

        // Check if any waiting dependents can now be activated
        if (this.options.autoReactivateDependents) {
            await this.tryReactivateWaitingPlugins()
        }
    }

    /**
     * Deactivate a plugin and all downstream plugins that depend on it.
     */
    async deactivatePlugin(name: string): Promise<DeactivateResult> {
        const plugin = this.plugins.get(name)
        if (!plugin) {
            throw new PluginNotFoundError(name)
        }

        // Get deactivation order: cascading dependents first, then target
        const { deactivationOrder, cascadingDependents } = this.dag.getDeactivationOrder(name)

        const deactivatedList: string[] = []

        for (const node of deactivationOrder) {
            const current = this.plugins.get(node)
            if (!current || current.state !== "active") {
                continue
            }

            // Deactivate in worker
            await this.sendWorkerRequest(current, {
                type: "deactivate"
            })

            current.state = "deactivated"
            current.deactivatedReason = node === name ? "manual" : "dependency-deactivated"
            if (node !== name) {
                current.waitingForDependencies.add(name)
            }

            // Unregister exported schemas
            this.componentRegistry.unregisterPluginComponents(node)
            deactivatedList.push(node)
        }

        return {
            target: name,
            deactivated: deactivatedList,
            cascadingDependents
        }
    }

    /**
     * Remove a plugin from the host.
     * Deactivates the plugin first (along with all its dependents), terminates its worker,
     * and leaves dependents deactivated waiting for a replacement.
     */
    async removePlugin(name: string): Promise<RemoveResult> {
        const plugin = this.plugins.get(name)
        if (!plugin) {
            throw new PluginNotFoundError(name)
        }

        // 1. Deactivate first (cascading to all dependents)
        const deactivateResult = await this.deactivatePlugin(name)

        // For all dependents that required schemas exported by this plugin,
        // mark those schemas as missing so the dependents stay deactivated until a replacement is kept back
        for (const schema of plugin.exportedSchemas) {
            const schemaKey = getSchemaKey(schema)
            for (const depName of deactivateResult.cascadingDependents) {
                const depPlugin = this.plugins.get(depName)
                if (depPlugin) {
                    for (const reqSchema of depPlugin.requiredSchemas) {
                        if (getSchemaKey(reqSchema) === schemaKey) {
                            depPlugin.waitingForDependencies.add(schemaKey)
                        }
                    }
                }
            }
        }

        // 2. Terminate target worker and cleanup
        await plugin.worker.terminate()
        plugin.state = "removed"

        // Remove target from DAG
        this.dag.removeNode(name)
        this.plugins.delete(name)

        return {
            removed: name,
            deactivatedDependents: deactivateResult.cascadingDependents
        }
    }

    /**
     * Get a hosted plugin by name.
     */
    getPlugin(name: string): HostedPlugin | undefined {
        const record = this.plugins.get(name)
        if (!record || record.state === "removed") return undefined
        return this.createHostedPluginView(record)
    }

    /**
     * List all loaded plugins.
     */
    listPlugins(): HostedPlugin[] {
        return Array.from(this.plugins.values())
            .filter(p => p.state !== "removed")
            .map(p => this.createHostedPluginView(p))
    }

    /**
     * Invoke an exported component method on a plugin worker.
     */
    private async invokePluginComponent(
        pluginName: string,
        schema: any,
        method: string,
        args: any[]
    ): Promise<any> {
        const plugin = this.plugins.get(pluginName)
        if (!plugin || plugin.state !== "active") {
            throw new Error(`Plugin "${pluginName}" is not active`)
        }

        const id = generateId()
        const response = await this.sendWorkerRequest<{
            success: boolean
            result?: any
            error?: string
        }>(plugin, {
            type: "invoke-component",
            id,
            schema: getSchemaKey(schema),
            method,
            args
        })

        if (!response.success) {
            throw new Error(response.error ?? `Call to "${method}" on "${pluginName}" failed`)
        }

        return response.result
    }

    /**
     * Send a correlated request to a worker and await response.
     */
    private sendWorkerRequest<T = any>(
        plugin: InternalPluginRecord,
        message: Record<string, any>
    ): Promise<T> {
        const id = (message["id"] as string | undefined) ?? generateId()
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                plugin.pendingRequests.delete(id)
                reject(new PluginExecutionError(plugin.name, `Timeout waiting for response to ${message["type"]} (id: ${id})`))
            }, this.options.rpcTimeoutMs)

            plugin.pendingRequests.set(id, { type: message["type"], resolve, reject, timer })
            plugin.worker.postMessage({ ...message, id })
        })
    }

    /**
     * Setup bidirectional message router for a worker.
     */
    private setupWorkerMessaging(plugin: InternalPluginRecord): void {
        plugin.worker.onmessage = async (event: { data: any }) => {
            const msg = event.data
            if (!msg || typeof msg !== "object") return

            switch (msg.type) {
                case "require": {
                    // Plugin announces it requires a component schema
                    plugin.requiredSchemas.push(msg.schema)
                    const schemaKey = getSchemaKey(msg.schema)

                    const provider = this.componentRegistry.findProvider(msg.schema)
                    if (provider) {
                        const providerNode = provider.providerType === "host" ? "@host" : provider.providerName
                        if (providerNode !== plugin.name) {
                            try {
                                this.dag.addEdge(plugin.name, providerNode)
                                plugin.waitingForDependencies.delete(schemaKey)
                                plugin.waitingForDependencies.delete(providerNode)
                            } catch (err) {
                                // Cycle detected!
                                console.error(`Cycle detected when "${plugin.name}" required "${schemaKey}":`, err)
                            }
                        }
                    } else {
                        plugin.waitingForDependencies.add(schemaKey)
                    }
                    break
                }

                case "get-asset": {
                    const assetRaw = plugin.archive.getRawAsset(msg.path)
                    if (assetRaw) {
                        plugin.worker.postMessage({
                            type: "get-asset-response",
                            id: msg.id,
                            found: true,
                            content: assetRaw,
                            size: assetRaw.byteLength
                        })
                    } else {
                        plugin.worker.postMessage({
                            type: "get-asset-response",
                            id: msg.id,
                            found: false,
                            error: `Asset "${msg.path}" not found in plugin "${plugin.name}"`
                        })
                    }
                    break
                }

                case "get-component": {
                    const provider = this.componentRegistry.findProvider(msg.schema)
                    if (!provider) {
                        plugin.worker.postMessage({
                            type: "get-component-response",
                            id: msg.id,
                            found: false,
                            error: `Component not found for schema`
                        })
                        return
                    }

                    // Record dependency in DAG
                    const providerNode = provider.providerType === "host" ? "@host" : provider.providerName
                    if (providerNode !== plugin.name) {
                        this.dag.addEdge(plugin.name, providerNode)
                    }

                    if (provider.providerType === "host") {
                        // Pass host component instance
                        plugin.worker.postMessage({
                            type: "get-component-response",
                            id: msg.id,
                            found: true,
                            value: provider.instance ?? {}
                        })
                    } else {
                        // Provided by another plugin worker
                        const defaultInitialValue: any = {
                            currency: "USD",
                            accounts: new Map([
                                ["acc-1", { id: "acc-1", owner: "Alice", balance: 1000, updatedAt: Date.now() }],
                                ["acc-2", { id: "acc-2", owner: "Bob", balance: 500, updatedAt: Date.now() }]
                            ])
                        }
                        plugin.worker.postMessage({
                            type: "get-component-response",
                            id: msg.id,
                            found: true,
                            value: defaultInitialValue
                        })
                    }
                    break
                }

                case "call-component": {
                    const provider = this.componentRegistry.findProvider(msg.schema)
                    if (!provider) {
                        plugin.worker.postMessage({
                            type: "call-component-response",
                            id: msg.id,
                            success: false,
                            error: `Component provider not found`
                        })
                        return
                    }

                    if (provider.providerType === "host") {
                        // Execute directly on host component instance
                        try {
                            const inst = provider.instance
                            if (!inst || typeof inst[msg.method] !== "function") {
                                throw new Error(`Method "${msg.method}" is not a function on host component`)
                            }
                            const result = await inst[msg.method](...(msg.args ?? []))
                            plugin.worker.postMessage({
                                type: "call-component-response",
                                id: msg.id,
                                success: true,
                                result
                            })
                        } catch (err: any) {
                            plugin.worker.postMessage({
                                type: "call-component-response",
                                id: msg.id,
                                success: false,
                                error: err?.message ?? String(err)
                            })
                        }
                    } else {
                        // Forward RPC invocation to the exporting plugin's worker
                        try {
                            const result = await this.invokePluginComponent(
                                provider.providerName,
                                msg.schema,
                                msg.method,
                                msg.args ?? []
                            )
                            plugin.worker.postMessage({
                                type: "call-component-response",
                                id: msg.id,
                                success: true,
                                result
                            })
                        } catch (err: any) {
                            plugin.worker.postMessage({
                                type: "call-component-response",
                                id: msg.id,
                                success: false,
                                error: err?.message ?? String(err)
                            })
                        }
                    }
                    break
                }

                case "bundle-activated": {
                    let targetId = msg.id
                    if (!targetId) {
                        for (const [reqId, req] of plugin.pendingRequests.entries()) {
                            if (req.type === "activate") {
                                targetId = reqId
                                break
                            }
                        }
                    }
                    if (targetId && plugin.pendingRequests.has(targetId)) {
                        const pending = plugin.pendingRequests.get(targetId)!
                        plugin.pendingRequests.delete(targetId)
                        clearTimeout(pending.timer)
                        pending.resolve(msg)
                    }
                    break
                }

                case "bundle-deactivated": {
                    let targetId = msg.id
                    if (!targetId) {
                        for (const [reqId, req] of plugin.pendingRequests.entries()) {
                            if (req.type === "deactivate") {
                                targetId = reqId
                                break
                            }
                        }
                    }
                    if (targetId && plugin.pendingRequests.has(targetId)) {
                        const pending = plugin.pendingRequests.get(targetId)!
                        plugin.pendingRequests.delete(targetId)
                        clearTimeout(pending.timer)
                        pending.resolve(msg)
                    }
                    break
                }

                case "invoke-component-response": {
                    const pending = plugin.pendingRequests.get(msg.id)
                    if (pending) {
                        plugin.pendingRequests.delete(msg.id)
                        clearTimeout(pending.timer)
                        if (msg.error || msg.success === false) {
                            pending.reject(new Error(msg.error ?? "Worker request failed"))
                        } else {
                            pending.resolve(msg)
                        }
                    }
                    break
                }
            }
        }

        plugin.worker.onerror = (error: any) => {
            console.error(`Worker error in plugin "${plugin.name}":`, error)
        }
    }

    /**
     * Check all currently deactivated plugins to see if their dependencies are now satisfied,
     * and reactivate them if ready.
     */
    private async tryReactivateWaitingPlugins(): Promise<void> {
        let order: string[]
        try {
            order = this.dag.topologicalSort()
        } catch {
            order = Array.from(this.plugins.keys())
        }

        for (const node of order) {
            if (node === "@host") continue
            const plugin = this.plugins.get(node)
            if (!plugin || plugin.state !== "deactivated") continue
            const deps = this.dag.getDirectDependencies(plugin.name)
            let allActive = true

            for (const dep of deps) {
                if (dep === "@host") continue
                const depPlugin = this.plugins.get(dep)
                if (!depPlugin || depPlugin.state !== "active") {
                    allActive = false
                    break
                } else {
                    plugin.waitingForDependencies.delete(dep)
                }
            }

            if (allActive && plugin.waitingForDependencies.size === 0) {
                try {
                    await this.activatePlugin(plugin.name)
                } catch {
                    // If reactivation fails, keep waiting
                }
            }
        }
    }

    /**
     * Create read-only public view of HostedPlugin.
     */
    private createHostedPluginView(record: InternalPluginRecord): HostedPlugin {
        return {
            get name() { return record.name },
            get version() { return record.version },
            get manifest() { return record.manifest },
            get state() { return record.state },
            get exportedSchemas() { return [...record.exportedSchemas] },
            get requiredSchemas() { return [...record.requiredSchemas] },
            get assets() { return record.archive.listAssets() },
            get waitingForDependencies() { return Array.from(record.waitingForDependencies) },
            get deactivatedReason() { return record.deactivatedReason },

            listAssets: (prefix?: string) => record.archive.listAssets(prefix),
            getAsset: async (path: string) => record.archive.getAsset(path),
            hasAsset: (path: string) => record.archive.hasAsset(path)
        }
    }

    /**
     * Shutdown and cleanup all plugins.
     */
    async destroy(): Promise<void> {
        for (const name of Array.from(this.plugins.keys())) {
            try {
                await this.removePlugin(name)
            } catch {
                // Ignore during shutdown
            }
        }
        this.plugins.clear()
    }
}
