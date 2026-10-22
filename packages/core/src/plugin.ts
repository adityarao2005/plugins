import z from "zod";
import type { PluginAsset, PluginMetadata } from "./asset";

export interface ComponentHandle<T> {
    get(): Promise<T | undefined>
}

export interface PluginLogger {
    info(...data: any[]): void
    debug(...data: any[]): void
    error(...data: any[]): void
    warn(...data: any[]): void
}

export type ClassConstructor<T> = new (...args: any[]) => T;

export type ComponentDecorator<T> = <C extends ClassConstructor<T>>(
    target: C,
    context?: ClassDecoratorContext
) => C | void;

export type Callback = () => void | Promise<void>

export interface Plugin {
    readonly metadata: PluginMetadata;
    logger: PluginLogger;
    onActivated: Callback
    onDeactivated: Callback

    require<T>(schema: z.ZodType<T>): ComponentHandle<T>;
    component<T extends object>(schema: z.ZodType<T>): ComponentDecorator<T>;
    component<T extends object, C extends ClassConstructor<T>>(schema: z.ZodType<T>, constructor: C): C;

    // asset handling
    getAsset(filePath: string): Promise<PluginAsset | undefined>;
    listAssets(prefix?: string): Promise<string[]>;
}
