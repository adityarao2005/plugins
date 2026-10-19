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

export interface Plugin {
    readonly metadata: PluginMetadata;
    readonly logger: PluginLogger;

    require<T>(schema: z.ZodType<T>): ComponentHandle<T>;
    component<T>(schema: z.ZodType<T>): ComponentDecorator<T>;
    component<T, C extends ClassConstructor<T>>(schema: z.ZodType<T>, constructor: C): C;
    onPluginActivated(callback: () => void | Promise<void>): void;
    onPluginDeactivated(callback: () => void | Promise<void>): void;

    // asset handling
    getAsset(filePath: string): Promise<PluginAsset | undefined>;
    listAssets(prefix?: string): Promise<string[]>;
}
