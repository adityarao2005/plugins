import z from "zod"
import type { Callback, ClassConstructor, ComponentDecorator, ComponentHandle, Plugin, PluginLogger } from "./plugin"
import type { PluginMetadata, PluginAsset } from "./asset"

// ==================== Messaging & Protocol Schemas ====================

const InitializeEventSchema = z.object({
    type: z.literal("initialize"),
    metadata: z.object({
        name: z.string(),
        version: z.string()
    }),
    assetPaths: z.array(z.string()).default([])
})

const ActivateBundleEventSchema = z.object({
    type: z.literal("activate"),
})

const DeactivateBundleEventSchema = z.object({
    type: z.literal("deactivate")
})

const GetAssetResponseSchema = z.object({
    type: z.literal("get-asset-response"),
    id: z.string(),
    found: z.boolean(),
    content: z.any().optional(),
    size: z.number().optional(),
    error: z.string().optional()
})

const GetComponentResponseSchema = z.object({
    type: z.literal("get-component-response"),
    id: z.string(),
    found: z.boolean(),
    value: z.any().optional(),
    error: z.string().optional()
})

const CallComponentResponseSchema = z.object({
    type: z.literal("call-component-response"),
    id: z.string(),
    success: z.boolean(),
    result: z.any().optional(),
    error: z.string().optional()
})

const InvokeComponentSchema = z.object({
    type: z.literal("invoke-component"),
    id: z.string(),
    schema: z.any().optional(),
    method: z.string(),
    args: z.array(z.any()).default([])
})

const ProvideComponentsSchema = z.object({
    type: z.literal("provide-components"),
    components: z.record(z.string(), z.any())
})

const GenericResponseSchema = z.object({
    type: z.literal("response"),
    id: z.string(),
    success: z.boolean().optional(),
    data: z.any().optional(),
    error: z.string().optional()
})

const EventSchema = z.discriminatedUnion("type", [
    InitializeEventSchema,
    ActivateBundleEventSchema,
    DeactivateBundleEventSchema,
    GetAssetResponseSchema,
    GetComponentResponseSchema,
    CallComponentResponseSchema,
    InvokeComponentSchema,
    ProvideComponentsSchema,
    GenericResponseSchema
])

// ==================== Utilities & Correlated Messaging ====================

const targetScope: any = typeof self !== "undefined" ? self : globalThis

interface PendingRequest<T = any> {
    resolve: (val: T) => void
    reject: (err: any) => void
    timer: ReturnType<typeof setTimeout>
}

const pendingRequests = new Map<string, PendingRequest>()

function generateId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID()
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function safePostMessage(message: any, transfer?: Transferable[]): void {
    if (typeof targetScope.postMessage === "function") {
        if (transfer && transfer.length > 0) {
            try {
                targetScope.postMessage(message, transfer)
                return
            } catch {
                // Fallback to structured clone if transferables are not supported by the environment/mock
            }
        }
        targetScope.postMessage(message)
    }
}

function sendRequest<T = any>(
    message: Record<string, any>,
    timeoutMs = 15000,
    transfer?: Transferable[]
): Promise<T> {
    const id = (message["id"] as string | undefined) ?? generateId()
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingRequests.delete(id)
            reject(new Error(`Timeout waiting for response to ${message["type"]} (id: ${id})`))
        }, timeoutMs)

        pendingRequests.set(id, { resolve, reject, timer })
        safePostMessage({ ...message, id }, transfer)
    })
}

function serializeSchema(schema: z.ZodType<any>): any {
    try {
        if (typeof (schema as any).toJSONSchema === "function") {
            return (schema as any).toJSONSchema()
        }
        if (typeof (z as any).toJSONSchema === "function") {
            return (z as any).toJSONSchema(schema, { unrepresentable: "any" })
        }
    } catch {
        // Fallback for unrepresentable constructs (e.g. z.function())
    }
    return {
        description: schema.description ?? (schema as any)._def?.description,
        type: (schema as any)._def?.typeName ?? "schema"
    }
}

function getSchemaKey(schema: z.ZodType<any>): string {
    if (schema.description) return schema.description
    try {
        return JSON.stringify(serializeSchema(schema))
    } catch {
        return String(schema)
    }
}

// ==================== Asset Implementation ====================

function createPluginAsset(
    path: string,
    content: ArrayBuffer | Uint8Array | string | Blob | ReadableStream<Uint8Array>,
    customSize?: number
): PluginAsset {
    // If it's a Blob (images, wasm binaries, etc.)
    if (typeof Blob !== "undefined" && content instanceof Blob) {
        return {
            path,
            size: customSize ?? content.size,
            async bytes() {
                return new Uint8Array(await content.arrayBuffer())
            },
            async arrayBuffer(): Promise<ArrayBuffer> {
                return content.arrayBuffer()
            },
            async text() {
                return content.text()
            },
            async json<T = unknown>(schema?: z.ZodType<T>): Promise<T> {
                const text = await content.text()
                const parsed = JSON.parse(text)
                return schema ? schema.parse(parsed) : (parsed as T)
            },
            stream() {
                return content.stream()
            }
        }
    }

    // If it's a ReadableStream (for streaming large blobs, audio, textures, wasm)
    if (typeof ReadableStream !== "undefined" && content instanceof ReadableStream) {
        let cachedBytes: Uint8Array | null = null
        const getBytes = async (): Promise<Uint8Array> => {
            if (cachedBytes) return cachedBytes
            const reader = content.getReader()
            const chunks: Uint8Array[] = []
            let total = 0
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (value) {
                    chunks.push(value)
                    total += value.byteLength
                }
            }
            const merged = new Uint8Array(total)
            let offset = 0
            for (const chunk of chunks) {
                merged.set(chunk, offset)
                offset += chunk.byteLength
            }
            cachedBytes = merged
            return merged
        }

        return {
            path,
            size: customSize ?? 0,
            async bytes() {
                return getBytes()
            },
            async arrayBuffer(): Promise<ArrayBuffer> {
                const b = await getBytes()
                const buffer = new ArrayBuffer(b.byteLength)
                new Uint8Array(buffer).set(b)
                return buffer
            },
            async text() {
                const b = await getBytes()
                return new TextDecoder().decode(b)
            },
            async json<T = unknown>(schema?: z.ZodType<T>): Promise<T> {
                const b = await getBytes()
                const text = new TextDecoder().decode(b)
                const parsed = JSON.parse(text)
                return schema ? schema.parse(parsed) : (parsed as T)
            },
            stream() {
                if (cachedBytes) {
                    return new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(cachedBytes!)
                            controller.close()
                        }
                    })
                }
                return content
            }
        }
    }

    let bytesData: Uint8Array
    if (typeof content === "string") {
        bytesData = new TextEncoder().encode(content)
    } else if (content instanceof Uint8Array) {
        bytesData = content
    } else if (content instanceof ArrayBuffer) {
        bytesData = new Uint8Array(content)
    } else {
        bytesData = new Uint8Array()
    }

    const size = customSize ?? bytesData.byteLength

    return {
        path,
        size,
        async bytes() {
            return bytesData
        },
        async arrayBuffer(): Promise<ArrayBuffer> {
            const buffer = new ArrayBuffer(bytesData.byteLength)
            new Uint8Array(buffer).set(bytesData)
            return buffer
        },
        async text() {
            return new TextDecoder().decode(bytesData)
        },
        async json<T = unknown>(schema?: z.ZodType<T>): Promise<T> {
            const text = new TextDecoder().decode(bytesData)
            const parsed = JSON.parse(text)
            return schema ? schema.parse(parsed) : (parsed as T)
        },
        stream() {
            return new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(bytesData)
                    controller.close()
                }
            })
        }
    }
}

// ==================== Component RPC Proxy ====================

function createComponentProxy<T>(
    schemaJson: any,
    initialData?: any
): T {
    const base = (typeof initialData === "object" && initialData !== null) ? initialData : {}

    return new Proxy(base, {
        get(target, prop, receiver) {
            if (typeof prop === "symbol") {
                return Reflect.get(target, prop, receiver)
            }
            // CRITICAL: Prevent promise chaining / thenable coercion from treating proxy as a promise
            if (prop === "then" || prop === "catch" || prop === "finally") {
                return undefined
            }
            // If property or method exists directly on the target object
            if (prop in target) {
                const val = (target as any)[prop]
                if (typeof val === "function") {
                    return val.bind(target)
                }
                return val
            }

            // Remote method invocation / RPC over postMessage
            return (...args: any[]) => {
                // Support sending large buffers / WASM / images via transferables if present in args
                const transferables: Transferable[] = []
                for (const arg of args) {
                    if (arg instanceof ArrayBuffer) {
                        transferables.push(arg)
                    } else if (ArrayBuffer.isView(arg)) {
                        transferables.push(arg.buffer)
                    } else if (typeof ReadableStream !== "undefined" && arg instanceof ReadableStream) {
                        transferables.push(arg)
                    } else if (typeof MessagePort !== "undefined" && arg instanceof MessagePort) {
                        transferables.push(arg)
                    }
                }

                return sendRequest<{ result: any }>({
                    type: "call-component",
                    schema: schemaJson,
                    method: prop,
                    args
                }, 15000, transferables.length > 0 ? transferables : undefined).then((res) => {
                    if (res && typeof res === "object" && "result" in res) {
                        return res.result
                    }
                    return res
                })
            }
        },
        set(target, prop, value, receiver) {
            return Reflect.set(target, prop, value, receiver)
        }
    }) as T
}

// ==================== Plugin Implementation ====================

class PluginImplementation implements Plugin {
    metadata: PluginMetadata
    logger: PluginLogger
    assets: string[]
    onActivated: Callback
    onDeactivated: Callback

    requiredComponentMap = new Map<z.ZodType, any>()
    exportedComponentConstructors = new Map<z.ZodType, ClassConstructor<any>>()
    exportedComponents = new Map<z.ZodType, any>()
    private assetCache = new Map<string, PluginAsset>()

    constructor() {
        this.logger = {
            debug(...data: any[]) { console.debug(...data) },
            info(...data: any[]) { console.info(...data) },
            error(...data: any[]) { console.error(...data) },
            warn(...data: any[]) { console.warn(...data) }
        }
        this.metadata = {
            name: "uninitialized",
            version: "0.0.0"
        }
        this.assets = []
        this.onActivated = () => { }
        this.onDeactivated = () => { }
    }

    require<T>(schema: z.ZodType<T>): ComponentHandle<T> {
        const schemaJson = serializeSchema(schema)

        // Announce requirement to host upfront (useful for dependency graph & activation ordering)
        targetScope.postMessage({
            type: "require",
            schema: schemaJson
        })

        const selfM = this
        return {
            async get(): Promise<T | undefined> {
                // 1. If component was provided upfront at initialization / activation time:
                if (selfM.requiredComponentMap.has(schema)) {
                    const value = selfM.requiredComponentMap.get(schema)
                    return selfM.ensureComponentProxy(schema, schemaJson, value)
                }

                // 2. Otherwise request on-demand via postMessage and await the response:
                try {
                    const response = await sendRequest<{
                        found: boolean
                        value?: any
                        error?: string
                    }>({
                        type: "get-component",
                        schema: schemaJson
                    })

                    if (!response || !response.found) {
                        return undefined
                    }

                    const proxy = selfM.ensureComponentProxy(schema, schemaJson, response.value)
                    selfM.requiredComponentMap.set(schema, proxy)
                    return proxy
                } catch (err) {
                    selfM.logger.error("Failed to resolve component:", err)
                    return undefined
                }
            },
        }
    }

    private ensureComponentProxy<T>(_schema: z.ZodType<T>, schemaJson: any, value: any): T {
        return createComponentProxy<T>(schemaJson, value)
    }

    component<T extends object>(schema: z.ZodType<T>): ComponentDecorator<T>
    component<T extends object, C extends ClassConstructor<T>>(schema: z.ZodType<T>, constructor: C): C
    component<T extends object, C extends ClassConstructor<T>>(
        schema: z.ZodType<T>,
        constructor?: C
    ): ComponentDecorator<T> | C {
        const register = <C2 extends ClassConstructor<T>>(target: C2): C2 => {
            const ctor = class extends (target as any) { } as C2
            this.exportedComponentConstructors.set(schema, ctor)
            return ctor
        }

        if (constructor) {
            return register(constructor)
        }

        const decorator: ComponentDecorator<T> = <C2 extends ClassConstructor<T>>(
            target: C2,
            _context?: ClassDecoratorContext
        ) => {
            return register(target)
        }

        return decorator
    }

    async getAsset(filePath: string): Promise<PluginAsset | undefined> {
        // 1. Check local cache
        if (this.assetCache.has(filePath)) {
            return this.assetCache.get(filePath)
        }

        // 2. If known assets list is populated, return undefined early without IPC round-trip
        if (this.assets.length > 0 && !this.assets.includes(filePath)) {
            return undefined
        }

        // 3. Request asset on-demand from host and await message
        try {
            const response = await sendRequest<{
                found: boolean
                content?: ArrayBuffer | Uint8Array | string
                size?: number
                error?: string
            }>({
                type: "get-asset",
                path: filePath
            })

            if (!response || !response.found || response.content === undefined) {
                return undefined
            }

            const asset = createPluginAsset(filePath, response.content, response.size)
            this.assetCache.set(filePath, asset)
            return asset
        } catch (err) {
            this.logger.error(`Failed to load asset "${filePath}":`, err)
            return undefined
        }
    }

    async listAssets(prefix?: string): Promise<string[]> {
        if (prefix) {
            return this.assets.filter(asset => asset.startsWith(prefix))
        }
        return [...this.assets]
    }

    findExportedComponent(schemaQuery: any): any {
        if (!schemaQuery) return undefined

        // Try direct reference match
        if (this.exportedComponents.has(schemaQuery)) {
            return this.exportedComponents.get(schemaQuery)
        }

        // Try serialized schema comparison
        const queryKey = typeof schemaQuery === "string" ? schemaQuery : JSON.stringify(schemaQuery)
        for (const [schema, instance] of this.exportedComponents.entries()) {
            if (getSchemaKey(schema) === queryKey) {
                return instance
            }
        }

        // If only 1 component exported, fallback to it
        if (this.exportedComponents.size === 1) {
            return this.exportedComponents.values().next().value
        }

        return undefined
    }
}

// ==================== Global Message Handler ====================

targetScope.onmessage = async (event: MessageEvent<unknown>) => {
    const parseResult = EventSchema.safeParse(event.data)
    if (!parseResult.success) {
        // If message is a raw response matching a pending request ID
        const rawData = event.data as any
        if (rawData && typeof rawData === "object" && typeof rawData.id === "string") {
            const pending = pendingRequests.get(rawData.id)
            if (pending) {
                pendingRequests.delete(rawData.id)
                if (rawData.error || rawData.success === false) {
                    pending.reject(new Error(rawData.error ?? "Request failed"))
                } else {
                    pending.resolve(rawData)
                }
                return
            }
        }
        return
    }

    const value = parseResult.data

    switch (value.type) {
        case "initialize": {
            _plugin.metadata = value.metadata
            _plugin.assets = value.assetPaths
            break
        }

        case "activate": {
            const serializedSchemas: any[] = []

            // Initialize all exported components
            for (const [schema, ctor] of _plugin.exportedComponentConstructors.entries()) {
                const instance = new ctor()
                _plugin.exportedComponents.set(schema, instance)
                serializedSchemas.push(serializeSchema(schema))
            }

            // Run plugin activation lifecycle
            await _plugin.onActivated()

            // Notify host that bundle has activated
            targetScope.postMessage({
                type: "bundle-activated",
                schemas: serializedSchemas
            })
            break
        }

        case "deactivate": {
            await _plugin.onDeactivated()
            const serializedSchemas = Array.from(_plugin.exportedComponents.keys()).map(serializeSchema)
            _plugin.exportedComponents.clear()

            targetScope.postMessage({
                type: "bundle-deactivated",
                schemas: serializedSchemas
            })
            break
        }

        case "provide-components": {
            // Support upfront injection of components (at initialization / activation time)
            for (const [key, compValue] of Object.entries(value.components)) {
                for (const schema of _plugin.requiredComponentMap.keys()) {
                    if (getSchemaKey(schema) === key) {
                        _plugin.requiredComponentMap.set(schema, compValue)
                    }
                }
            }
            break
        }

        case "invoke-component": {
            // Incoming RPC: Host or another plugin calling a method on our exported component
            const { id, method, args, schema } = value
            try {
                const instance = _plugin.findExportedComponent(schema)
                if (!instance) {
                    throw new Error(`Exported component not found for schema`)
                }
                if (typeof instance[method] !== "function") {
                    throw new Error(`Method "${method}" is not a function on component`)
                }
                const result = await instance[method](...args)
                // If result contains large binary / wasm / images, transfer it zero-copy
                const transferables: Transferable[] = []
                if (result instanceof ArrayBuffer) {
                    transferables.push(result)
                } else if (ArrayBuffer.isView(result)) {
                    transferables.push(result.buffer)
                } else if (typeof ReadableStream !== "undefined" && result instanceof ReadableStream) {
                    transferables.push(result)
                }

                safePostMessage({
                    type: "invoke-component-response",
                    id,
                    success: true,
                    result
                }, transferables.length > 0 ? transferables : undefined)
            } catch (err: any) {
                safePostMessage({
                    type: "invoke-component-response",
                    id,
                    success: false,
                    error: err?.message ?? String(err)
                })
            }
            break
        }

        // Responses to worker-initiated requests:
        case "get-asset-response":
        case "get-component-response":
        case "call-component-response":
        case "response": {
            const pending = pendingRequests.get(value.id)
            if (pending) {
                pendingRequests.delete(value.id)
                if (value.error || (value as any).success === false) {
                    pending.reject(new Error(value.error ?? "Request failed"))
                } else {
                    pending.resolve(value)
                }
            }
            break
        }
    }
}

const _plugin = new PluginImplementation()

export const plugin: Plugin = _plugin