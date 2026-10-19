import { type z } from "zod"

export interface PluginAsset {
    readonly path: string
    readonly size: number

    // raw binary data
    bytes(): Promise<Uint8Array>
    // array buffer
    arrayBuffer(): Promise<ArrayBuffer>
    // textual data
    text(): Promise<string>
    // json data
    json<T = unknown>(schema?: z.ZodType<T>): Promise<T>
    // Streaming for large assets (audio, textures, video)
    stream(): ReadableStream<Uint8Array>
}

export interface PluginMetadata {
    readonly name: string
    readonly version: string
}