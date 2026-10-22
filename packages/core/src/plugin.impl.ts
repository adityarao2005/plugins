import z from "zod"
import type { Callback, ClassConstructor, ComponentDecorator, ComponentHandle, Plugin, PluginLogger } from "./plugin"
import type { PluginMetadata, PluginAsset } from "./asset"

const InitializeEventSchema = z.object({
    type: z.literal("initialize"),
    metadata: z.object({
        name: z.string(),
        version: z.string()
    }),
    assetPaths: z.array(z.string())
})

const ActivateBundleEventSchema = z.object({
    type: z.literal("activate"),
})

const DeactivateBundleEventSchema = z.object({
    type: z.literal("deactivate")
})

const EventSchema = z.discriminatedUnion("type", [
    InitializeEventSchema,
    ActivateBundleEventSchema,
    DeactivateBundleEventSchema
])



class PluginImplementation implements Plugin {
    metadata: PluginMetadata
    logger: PluginLogger
    assets: string[]
    onActivated: Callback
    onDeactivated: Callback
    requiredComponentMap = new Map<z.ZodType, any>()

    constructor() {
        this.logger = {
            debug() { },
            info() { },
            error() { },
            warn() { }
        }
        this.metadata = {
            name: "test-metadata",
            version: "not-versioned"
        }
        this.assets = []
        this.onActivated = () => { }
        this.onDeactivated = () => { }
    }

    require<T>(schema: z.ZodType<T>): ComponentHandle<T> {
        self.postMessage({
            type: "require",
            schema: schema.toJSONSchema()
        })

        const selfM = this
        return {
            async get() {
                const value = selfM.requiredComponentMap.get(schema)
                const result = schema.safeParse(value)
                return result.data
            },
        }
    }

    exportedComponentConstructors = new Map<z.ZodType, ClassConstructor<any>>()
    exportedComponents = new Map<z.ZodType, any>()

    component<T extends object>(schema: z.ZodType<T>): ComponentDecorator<T>
    component<T extends object, C extends ClassConstructor<T>>(schema: z.ZodType<T>, constructor: C): C
    component<T extends object, C extends ClassConstructor<T>>(schema: z.ZodType<T>, constructor?: C): ComponentDecorator<T> | C {
        if (constructor) {
            const ctor = class extends constructor { }
            this.exportedComponentConstructors.set(schema, ctor)
            return ctor
        }

        const decorator: ComponentDecorator<T> = <C2 extends ClassConstructor<T>>(constructor: C2, context?: ClassDecoratorContext) => {
            if (!context) {
                const ctor = class extends constructor { }
                this.exportedComponentConstructors.set(schema, ctor)
                return ctor
            }
        }

        return decorator
    }

    getAsset(filePath: string): Promise<PluginAsset | undefined> {
        throw new Error("Method not implemented.")
    }

    async listAssets(prefix?: string): Promise<string[]> {
        if (prefix)
            return this.assets.filter(asset => asset.startsWith(prefix))
        else
            return this.assets
    }

}

self.onmessage = async (event: MessageEvent<z.infer<typeof EventSchema>>) => {
    const value = EventSchema.parse(event.data)

    switch (value.type) {
        case "initialize":
            _plugin.metadata = value.metadata
            _plugin.assets = value.assetPaths
            break;
        case "activate":
            const schemas = []
            // initialize all the components
            for (const [schema, ctor] of _plugin.exportedComponentConstructors.entries()) {
                const value = await schema.safeParseAsync(new ctor())
                _plugin.exportedComponents.set(schema, value)
                schemas.push(schema)
            }
            // activate the components
            await _plugin.onActivated()
            // loop through all the exported components and post message saying all components with the schemas are now loaded
            self.postMessage({
                type: "bundle-activated",
                schemas: schemas
            })

            break
        case "deactivate":
            await _plugin.onDeactivated()
            _plugin.exportedComponents.clear()
            // loop through all the exported components and post message saying all components with the schemas are now loaded
            self.postMessage({
                type: "bundle-deactivated",
                schemas: schemas
            })
            break
    }
}

const _plugin = new PluginImplementation()

export const plugin: Plugin = _plugin