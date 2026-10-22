import { z } from "zod"

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

export type UnsubscribeCallback = () => void | Promise<void>

export type PluginHandler = (
    context: PluginContext
) => Promise<UnsubscribeCallback | void> | UnsubscribeCallback | void

export interface PluginMetadata {
    readonly name: string
    readonly version: string
}

export interface PluginLogger {
    info(...data: any[]): void
    debug(...data: any[]): void
    error(...data: any[]): void
    warn(...data: any[]): void
}

export interface PluginContext {
    readonly metadata: PluginMetadata
    readonly signal: AbortSignal
    readonly logger: PluginLogger

    // Component library loading
    getComponent<T>(schema: z.ZodType<T>): Promise<T | undefined>
    putComponent<T>(schema: z.ZodType<T>, value: T): Promise<void>
    deleteComponent<T>(schema: z.ZodType<T>): Promise<void>

    onComponentPut<T>(schema: z.ZodType<T>, handler: (newValue: T, oldValue?: T) => void): UnsubscribeCallback
    onComponentDelete<T>(schema: z.ZodType<T>, handler: (value: T) => void): UnsubscribeCallback

    // asset handling
    getAsset(filePath: string): Promise<PluginAsset | undefined>
    listAssets(prefix?: string): Promise<string[]>
}

export type {
    ComponentHandle,
    ClassConstructor,
    ComponentDecorator,
    Callback,
    Plugin
} from "./plugin"
export { plugin } from "./plugin.impl"