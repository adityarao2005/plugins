import z from "zod"

const InitializeEventSchema = z.object({
    type: z.literal("initialize"),
    metadata: z.object({
        name: z.string(),
        version: z.string()
    }),
    assetPaths: z.array(z.string())
})

const RequireComponentEventSchema = z.object({
    type: z.literal("require"),
    schema: z.object()
})

const ActivateBundleEventSchema = z.object({
    type: z.literal("activate")
})

const DeactivateBundleEventSchema = z.object({
    type: z.literal("deactivate")
})

const EventSchema = z.discriminatedUnion("type", [
    InitializeEventSchema,
    RequireComponentEventSchema,
    ActivateBundleEventSchema,
    DeactivateBundleEventSchema
])

self.onmessage = (event: MessageEvent<z.infer<typeof EventSchema>>) => {
    const value = EventSchema.parse(event.data)
}