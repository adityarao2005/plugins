import z from "zod"

export function serializeSchema(schema: z.ZodType<any>): any {
    try {
        if (typeof (schema as any).toJSONSchema === "function") {
            return (schema as any).toJSONSchema()
        }
        if (typeof (z as any).toJSONSchema === "function") {
            return (z as any).toJSONSchema(schema, { unrepresentable: "any" })
        }
    } catch {
        // Fallback for custom or unrepresentable constructs
    }
    return {
        description: schema.description ?? (schema as any)._def?.description,
        type: (schema as any)._def?.typeName ?? "schema"
    }
}

export function getSchemaKey(schema: z.ZodType<any> | string | any): string {
    if (typeof schema === "string") return schema
    if (schema?.description) return schema.description
    if (schema?._def?.description) return schema._def.description
    try {
        return JSON.stringify(serializeSchema(schema))
    } catch {
        return String(schema)
    }
}

export interface ComponentProvider {
    /**
     * "host" or plugin name.
     */
    providerType: "host" | "plugin"
    providerName: string
    schema: any
    schemaKey: string
    instance?: any
}

export class ComponentRegistry {
    // schemaKey -> ComponentProvider
    private providers = new Map<string, ComponentProvider>()
    // Host-registered instances: schemaKey -> instance
    private hostComponents = new Map<string, { schema: any; instance: any }>()

    constructor() {}

    /**
     * Register a host component (host proxy plugin).
     */
    registerHostComponent<T extends object>(schema: z.ZodType<T>, instance: T): string {
        const key = getSchemaKey(schema)
        this.hostComponents.set(key, { schema, instance })
        this.providers.set(key, {
            providerType: "host",
            providerName: "@host",
            schema,
            schemaKey: key,
            instance
        })
        return key
    }

    /**
     * Unregister a host component.
     */
    unregisterHostComponent<T extends object>(schema: z.ZodType<T>): boolean {
        const key = getSchemaKey(schema)
        this.hostComponents.delete(key)
        const current = this.providers.get(key)
        if (current && current.providerType === "host") {
            this.providers.delete(key)
            return true
        }
        return false
    }

    /**
     * Register a plugin's exported schema.
     */
    registerPluginComponent(pluginName: string, schema: any): string {
        const key = getSchemaKey(schema)
        this.providers.set(key, {
            providerType: "plugin",
            providerName: pluginName,
            schema,
            schemaKey: key
        })
        return key
    }

    /**
     * Unregister all components exported by a plugin.
     */
    unregisterPluginComponents(pluginName: string): string[] {
        const removed: string[] = []
        for (const [key, provider] of this.providers.entries()) {
            if (provider.providerType === "plugin" && provider.providerName === pluginName) {
                this.providers.delete(key)
                removed.push(key)
            }
        }
        return removed
    }

    /**
     * Find the provider of a given schema.
     */
    findProvider(schemaQuery: any): ComponentProvider | undefined {
        if (!schemaQuery) return undefined

        const queryKey = getSchemaKey(schemaQuery)

        // 1. Exact schema key match
        if (this.providers.has(queryKey)) {
            return this.providers.get(queryKey)
        }

        // 2. Match by description if available
        const description = schemaQuery?.description ?? schemaQuery?._def?.description
        if (description) {
            for (const [key, provider] of this.providers.entries()) {
                if (key === description || provider.schema?.description === description) {
                    return provider
                }
            }
        }

        // 3. Serialized schema match
        const queryJson = typeof schemaQuery === "string" ? schemaQuery : JSON.stringify(schemaQuery)
        for (const [key, provider] of this.providers.entries()) {
            if (key === queryJson) {
                return provider
            }
        }

        return undefined
    }

    /**
     * Check if a component is registered.
     */
    has(schemaQuery: any): boolean {
        return this.findProvider(schemaQuery) !== undefined
    }

    /**
     * Get host component instance if available.
     */
    getHostComponent<T = any>(schemaQuery: any): T | undefined {
        const provider = this.findProvider(schemaQuery)
        if (provider && provider.providerType === "host") {
            return provider.instance as T
        }
        return undefined
    }

    /**
     * Returns all registered provider records.
     */
    getAllProviders(): ComponentProvider[] {
        return Array.from(this.providers.values())
    }
}
