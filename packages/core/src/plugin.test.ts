import { describe, expect, it } from "bun:test";
import z from "zod";
import type { PluginAsset, PluginMetadata } from "./asset";
import type { ClassConstructor, ComponentDecorator, ComponentHandle, Plugin, PluginLogger } from "./plugin";

// Mock plugin class extending the real implementation
export class MockPlugin implements Plugin {
    readonly metadata: PluginMetadata;
    readonly logger: PluginLogger;

    private readonly components = new Map<z.ZodType<any>, ClassConstructor<any>>();
    private readonly instances = new Map<z.ZodType<any>, any>();
    private readonly activatedHooks: (() => void | Promise<void>)[] = [];
    private readonly deactivatedHooks: (() => void | Promise<void>)[] = [];

    constructor() {
        this.metadata = {
            name: "default",
            version: "0.0.0",
        };
        this.logger = {
            info() { },
            debug() { },
            error() { },
            warn() { },
        };
    }

    require<T>(schema: z.ZodType<T>): ComponentHandle<T> {
        return {
            get: async () => {
                const constructor = this.components.get(schema);
                if (!constructor) {
                    return undefined;
                }
                if (!this.instances.has(schema)) {
                    this.instances.set(schema, new constructor());
                }
                return this.instances.get(schema) as T;
            },
        };
    }

    component<T>(schema: z.ZodType<T>): ComponentDecorator<T>;
    component<T, C extends ClassConstructor<T>>(schema: z.ZodType<T>, constructor: C): C;
    component<T, C extends ClassConstructor<T>>(
        schema: z.ZodType<T>,
        constructor?: C
    ): C | ((target: C, context: ClassDecoratorContext) => C) {
        const register = (target: C) => {
            this.components.set(schema, target);
            return target;
        };

        if (constructor) {
            return register(constructor);
        }

        return (target: C, _context?: ClassDecoratorContext) => {
            return register(target);
        };
    }

    onPluginActivated(callback: () => void | Promise<void>): void {
        this.activatedHooks.push(callback);
    }

    onPluginDeactivated(callback: () => void | Promise<void>): void {
        this.deactivatedHooks.push(callback);
    }

    async getAsset(_filePath: string): Promise<PluginAsset | undefined> {
        return undefined;
    }

    async listAssets(_prefix?: string): Promise<string[]> {
        return [];
    }
}

// Schemas for testing
export const TicketDatabaseSchema = z.object({
    tickets: z.array(z.string()),
});
export type TicketDatabase = z.infer<typeof TicketDatabaseSchema>;

export const EmployeeDatabaseSchema = z.object({
    employees: z.array(z.string()),
});
export type EmployeeDatabase = z.infer<typeof EmployeeDatabaseSchema>;

export const TicketManagementSchema = z.object({
    createTicket: z.function({
        input: [z.string(), z.string()],
        output: z.number(),
    }),
    listTickets: z.function({
        input: [],
        output: z.array(z.string()),
    }),
});
export type TicketManagement = z.infer<typeof TicketManagementSchema>;

const plugin = new MockPlugin();

@plugin.component(TicketManagementSchema)
export class TicketManagementImpl implements TicketManagement {
    private tickets: string[] = ["initial-ticket"];

    createTicket(title: string, _description: string): number {
        this.tickets.push(title);
        return this.tickets.length;
    }

    listTickets(): string[] {
        return [...this.tickets];
    }
}


@plugin.component(TicketDatabaseSchema)
export class TicketDatabaseImpl implements TicketDatabase {
    tickets: string[] = ["db-ticket-1"];
}

describe("Plugin System", () => {
    it("resolves components registered via class decorator", async () => {
        const handle = plugin.require(TicketManagementSchema);
        const service = await handle.get();

        expect(service).toBeDefined();
        expect(service?.listTickets()).toEqual(["initial-ticket"]);

        const newId = service?.createTicket("bug-report", "something broke");
        expect(newId).toBe(2);
        expect(service?.listTickets()).toEqual(["initial-ticket", "bug-report"]);
    });

    it("resolves another decorated component correctly", async () => {
        const dbHandle = plugin.require(TicketDatabaseSchema);
        const db = await dbHandle.get();

        expect(db).toBeDefined();
        expect(db?.tickets).toEqual(["db-ticket-1"]);
    });

    it("supports direct component registration without decorator", async () => {
        class EmployeeDbImpl implements EmployeeDatabase {
            employees = ["Alice", "Bob"];
        }

        plugin.component(EmployeeDatabaseSchema, EmployeeDbImpl);

        const handle = plugin.require(EmployeeDatabaseSchema);
        const employeeDb = await handle.get();

        expect(employeeDb).toBeDefined();
        expect(employeeDb?.employees).toEqual(["Alice", "Bob"]);
    });

    it("returns undefined for unregistered schemas", async () => {
        const UnregisteredSchema = z.object({ foo: z.string() });
        const handle = plugin.require(UnregisteredSchema);
        const value = await handle.get();

        expect(value).toBeUndefined();
    });

    it("handles lifecycle callbacks", () => {
        let activated = false;
        let deactivated = false;

        plugin.onPluginActivated(() => {
            activated = true;
        });

        plugin.onPluginDeactivated(() => {
            deactivated = true;
        });

        expect(activated).toBe(false);
        expect(deactivated).toBe(false);
    });
});

describe("Worker Plugin Implementation (plugin.impl.ts)", () => {
    it("handles asset listing and on-demand getAsset via message RPC", async () => {
        const { plugin: workerPlugin } = await import("./plugin.impl");

        // Simulate host sending initialize event
        const targetScope: any = typeof self !== "undefined" ? self : globalThis;
        await targetScope.onmessage?.({
            data: {
                type: "initialize",
                metadata: { name: "test-plugin", version: "1.0.0" },
                assetPaths: ["config.json", "templates/main.txt", "logo.png"]
            }
        });

        // Test listAssets
        const allAssets = await workerPlugin.listAssets();
        expect(allAssets).toEqual(["config.json", "templates/main.txt", "logo.png"]);

        const filtered = await workerPlugin.listAssets("templates/");
        expect(filtered).toEqual(["templates/main.txt"]);

        // Test non-existent asset returns undefined without IPC
        const missing = await workerPlugin.getAsset("non-existent.txt");
        expect(missing).toBeUndefined();

        // Test getAsset requesting from host
        const origPostMessage = targetScope.postMessage;
        try {
            targetScope.postMessage = (msg: any) => {
                if (msg.type === "get-asset" && msg.path === "config.json") {
                    // Simulate host response
                    setTimeout(() => {
                        targetScope.onmessage?.({
                            data: {
                                type: "get-asset-response",
                                id: msg.id,
                                found: true,
                                content: JSON.stringify({ rate: 0.05 }),
                                size: 15
                            }
                        });
                    }, 5);
                }
            };

            const asset = await workerPlugin.getAsset("config.json");
            expect(asset).toBeDefined();
            expect(asset?.path).toBe("config.json");
            expect(await asset?.text()).toBe(JSON.stringify({ rate: 0.05 }));

            const parsed = await asset?.json<{ rate: number }>();
            expect(parsed?.rate).toBe(0.05);

            const bytes = await asset?.bytes();
            expect(bytes instanceof Uint8Array).toBe(true);

            const buffer = await asset?.arrayBuffer();
            expect(buffer instanceof ArrayBuffer).toBe(true);
        } finally {
            targetScope.postMessage = origPostMessage;
        }
    });

    it("creates an RPC proxy for require that intercepts remote method calls", async () => {
        const { plugin: workerPlugin } = await import("./plugin.impl");
        const targetScope: any = typeof self !== "undefined" ? self : globalThis;

        const CalculatorSchema = z.object({
            multiply: z.function({
                input: [z.number(), z.number()],
                output: z.number()
            })
        });

        const origPostMessage = targetScope.postMessage;
        try {
            targetScope.postMessage = (msg: any) => {
                if (msg.type === "get-component") {
                    // Host confirms component exists
                    setTimeout(() => {
                        targetScope.onmessage?.({
                            data: {
                                type: "get-component-response",
                                id: msg.id,
                                found: true,
                                value: {}
                            }
                        });
                    }, 5);
                } else if (msg.type === "call-component") {
                    // Host executes RPC method and returns result
                    expect(msg.method).toBe("multiply");
                    expect(msg.args).toEqual([6, 7]);
                    setTimeout(() => {
                        targetScope.onmessage?.({
                            data: {
                                type: "call-component-response",
                                id: msg.id,
                                success: true,
                                result: 42
                            }
                        });
                    }, 5);
                }
            };

            const handle = workerPlugin.require(CalculatorSchema);
            const calc = await handle.get();
            expect(calc).toBeDefined();

            // Calling method on proxy executes RPC
            const result = await (calc as any).multiply(6, 7);
            expect(result).toBe(42);
        } finally {
            targetScope.postMessage = origPostMessage;
        }
    });

    it("supports sending and receiving large binary blobs (wasm data, images) and streams", async () => {
        const { plugin: workerPlugin } = await import("./plugin.impl");
        const targetScope: any = typeof self !== "undefined" ? self : globalThis;

        const origPostMessage = targetScope.postMessage;
        try {
            await targetScope.onmessage?.({
                data: {
                    type: "initialize",
                    metadata: { name: "test-plugin", version: "1.0.0" },
                    assetPaths: ["module.wasm"]
                }
            });

            // 1. Test asset with WASM header bytes (\0asm)
            const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
            targetScope.postMessage = (msg: any) => {
                if (msg.type === "get-asset" && msg.path === "module.wasm") {
                    setTimeout(() => {
                        targetScope.onmessage?.({
                            data: {
                                type: "get-asset-response",
                                id: msg.id,
                                found: true,
                                content: wasmBytes,
                                size: wasmBytes.byteLength
                            }
                        });
                    }, 5);
                }
            };

            const wasmAsset = await workerPlugin.getAsset("module.wasm");
            expect(wasmAsset).toBeDefined();
            expect(wasmAsset?.size).toBe(8);

            const buffer = await wasmAsset?.arrayBuffer();
            expect(buffer?.byteLength).toBe(8);

            // Test streaming chunks
            const stream = wasmAsset?.stream();
            expect(stream).toBeDefined();
            const reader = stream?.getReader();
            const readResult = await reader?.read();
            expect(readResult?.value).toEqual(wasmBytes);

            // 2. Test passing large image buffer through component RPC
            const ImageProcessorSchema = z.object({
                processImage: z.function({
                    input: [z.instanceof(Uint8Array)],
                    output: z.number()
                })
            });

            const imageBytes = new Uint8Array(1024 * 64); // 64KB image chunk
            imageBytes[0] = 0xff; // JPEG SOI marker
            imageBytes[1] = 0xd8;

            let receivedArgs: any = null;
            targetScope.postMessage = (msg: any) => {
                if (msg.type === "get-component") {
                    setTimeout(() => {
                        targetScope.onmessage?.({
                            data: {
                                type: "get-component-response",
                                id: msg.id,
                                found: true,
                                value: {}
                            }
                        });
                    }, 5);
                } else if (msg.type === "call-component") {
                    receivedArgs = msg.args;
                    setTimeout(() => {
                        targetScope.onmessage?.({
                            data: {
                                type: "call-component-response",
                                id: msg.id,
                                success: true,
                                result: msg.args[0]?.byteLength
                            }
                        });
                    }, 5);
                }
            };

            const handle = workerPlugin.require(ImageProcessorSchema);
            const processor = await handle.get();
            const processedSize = await (processor as any).processImage(imageBytes);

            expect(processedSize).toBe(1024 * 64);
            expect(receivedArgs[0][0]).toBe(0xff);
            expect(receivedArgs[0][1]).toBe(0xd8);
        } finally {
            targetScope.postMessage = origPostMessage;
        }
    });
});

