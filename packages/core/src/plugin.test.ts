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
