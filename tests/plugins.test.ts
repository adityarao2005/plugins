import { describe, expect, it } from "bun:test"
import { z } from "zod"
import type {
    PluginAsset,
    PluginContext,
    PluginHandler,
    PluginLogger,
    PluginMetadata,
    UnsubscribeCallback
} from "@repo/core"

import handlePluginA from "../tests/fixtures/plugin-a-ledger/src/index"
import { BankLedgerSchema } from "../tests/fixtures/plugin-a-ledger/src/schema"
import handlePluginB, { InterestServiceSchema } from "../tests/fixtures/plugin-b-interest/src/index"
import handlePluginC, { FraudAuditLogSchema } from "../tests/fixtures/plugin-c-fraud-detector/src/index"

// In-memory asset helper for test execution
function createTestAsset(path: string, content: string): PluginAsset {
    const encoded = new TextEncoder().encode(content)
    return {
        path,
        size: encoded.byteLength,
        bytes: async () => encoded,
        arrayBuffer: async () => encoded.buffer,
        text: async () => content,
        json: async <T>(schema?: z.ZodType<T>) => {
            const data = JSON.parse(content)
            return schema ? schema.parse(data) : (data as T)
        },
        stream: () =>
            new ReadableStream({
                start(controller) {
                    controller.enqueue(encoded)
                    controller.close()
                }
            })
    }
}

// Host managing shared registry and scoped child plugin contexts
class TestPluginHost {
    private readonly components = new Map<z.ZodType<unknown>, unknown>()
    private readonly putListeners = new Map<
        z.ZodType<unknown>,
        Set<(newValue: unknown, oldValue?: unknown) => void>
    >()
    private readonly deleteListeners = new Map<
        z.ZodType<unknown>,
        Set<(value: unknown) => void>
    >()

    async getComponent<T>(schema: z.ZodType<T>): Promise<T | undefined> {
        const value = this.components.get(schema as z.ZodType<unknown>)
        return value !== undefined ? schema.parse(value) : undefined
    }

    async putComponent<T>(schema: z.ZodType<T>, value: T): Promise<void> {
        const validated = schema.parse(value)
        const key = schema as z.ZodType<unknown>
        const oldVal = this.components.get(key)
        this.components.set(key, validated)

        const listeners = this.putListeners.get(key)
        if (listeners) {
            for (const fn of Array.from(listeners)) {
                fn(validated, oldVal)
            }
        }
    }

    async deleteComponent<T>(schema: z.ZodType<T>): Promise<void> {
        const key = schema as z.ZodType<unknown>
        const oldVal = this.components.get(key)
        if (oldVal === undefined) return
        this.components.delete(key)

        const listeners = this.deleteListeners.get(key)
        if (listeners) {
            for (const fn of Array.from(listeners)) {
                fn(oldVal)
            }
        }
    }

    // Creates an isolated child context for a plugin instance with automatic tracking
    createChildContext(
        metadata: PluginMetadata,
        assets: Record<string, string> = {},
        customLogger?: PluginLogger
    ): {
        context: PluginContext
        dispose: () => Promise<void>
        getOwnedComponents: () => z.ZodType<unknown>[]
    } {
        const abortController = new AbortController()
        const ownedSchemas = new Set<z.ZodType<unknown>>()
        const unsubscribes = new Set<UnsubscribeCallback>()
        let isDisposed = false

        const logger: PluginLogger = customLogger ?? {
            info: () => {},
            debug: () => {},
            warn: () => {},
            error: () => {}
        }

        const dispose = async (): Promise<void> => {
            if (isDisposed) return
            isDisposed = true

            if (!abortController.signal.aborted) {
                abortController.abort()
            }

            // 1. Auto-cleanup listeners
            for (const unsub of Array.from(unsubscribes)) {
                unsub()
            }
            unsubscribes.clear()

            // 2. Auto-delete components owned by this child context
            for (const schema of Array.from(ownedSchemas)) {
                await this.deleteComponent(schema)
            }
            ownedSchemas.clear()
        }

        const context: PluginContext = {
            metadata,
            signal: abortController.signal,
            logger,

            getComponent: <T>(schema: z.ZodType<T>) => this.getComponent(schema),

            putComponent: async <T>(schema: z.ZodType<T>, value: T) => {
                if (isDisposed) throw new Error("Context is disposed")
                ownedSchemas.add(schema as z.ZodType<unknown>)
                await this.putComponent(schema, value)
            },

            deleteComponent: async <T>(schema: z.ZodType<T>) => {
                ownedSchemas.delete(schema as z.ZodType<unknown>)
                await this.deleteComponent(schema)
            },

            onComponentPut: <T>(
                schema: z.ZodType<T>,
                handler: (newValue: T, oldValue?: T) => void
            ) => {
                if (isDisposed) return () => {}
                const key = schema as z.ZodType<unknown>
                let set = this.putListeners.get(key)
                if (!set) {
                    set = new Set()
                    this.putListeners.set(key, set)
                }
                const fn = handler as (newValue: unknown, oldValue?: unknown) => void
                set.add(fn)

                const unsub: UnsubscribeCallback = () => {
                    const s = this.putListeners.get(key)
                    if (s) {
                        s.delete(fn)
                        if (s.size === 0) this.putListeners.delete(key)
                    }
                }
                unsubscribes.add(unsub)
                return () => {
                    unsubscribes.delete(unsub)
                    unsub()
                }
            },

            onComponentDelete: <T>(schema: z.ZodType<T>, handler: (value: T) => void) => {
                if (isDisposed) return () => {}
                const key = schema as z.ZodType<unknown>
                let set = this.deleteListeners.get(key)
                if (!set) {
                    set = new Set()
                    this.deleteListeners.set(key, set)
                }
                const fn = handler as (value: unknown) => void
                set.add(fn)

                const unsub: UnsubscribeCallback = () => {
                    const s = this.deleteListeners.get(key)
                    if (s) {
                        s.delete(fn)
                        if (s.size === 0) this.deleteListeners.delete(key)
                    }
                }
                unsubscribes.add(unsub)
                return () => {
                    unsubscribes.delete(unsub)
                    unsub()
                }
            },

            getAsset: async (filePath: string) => {
                const text = assets[filePath]
                return text !== undefined ? createTestAsset(filePath, text) : undefined
            },

            listAssets: async () => Object.keys(assets)
        }

        return {
            context,
            dispose,
            getOwnedComponents: () => Array.from(ownedSchemas)
        }
    }

    async loadPlugin(
        handler: PluginHandler,
        metadata: PluginMetadata,
        assets: Record<string, string> = {},
        customLogger?: PluginLogger
    ) {
        const { context, dispose, getOwnedComponents } = this.createChildContext(
            metadata,
            assets,
            customLogger
        )
        const customUnsub = await handler(context)

        return {
            context,
            dispose: async () => {
                if (customUnsub) {
                    await customUnsub()
                }
                await dispose()
            },
            getOwnedComponents
        }
    }
}

describe("Bank System 3-Plugin Test Fixture", () => {
    it("should load Plugin A, initialize ledger from assets, and allow operations", async () => {
        const host = new TestPluginHost()

        const pluginA = await host.loadPlugin(
            handlePluginA,
            { name: "plugin-a-ledger", version: "0.1.0" },
            {
                "default-rates.json": JSON.stringify({ currency: "USD", baseRate: 0.05 })
            }
        )

        const ledger = await host.getComponent(BankLedgerSchema)
        expect(ledger).toBeDefined()
        expect(ledger?.currency).toBe("USD")

        const alice = ledger?.getAccount("acc-1")
        expect(alice).toBeDefined()
        expect(alice?.balance).toBe(1000)

        // Deposit funds
        ledger?.deposit("acc-1", 500)
        expect(ledger?.getAccount("acc-1")?.balance).toBe(1500)

        await pluginA.dispose()
    })

    it("should allow Plugin B and Plugin C to interact reactively with Plugin A", async () => {
        const host = new TestPluginHost()
        const warnings: string[] = []

        const logger: PluginLogger = {
            info: () => {},
            debug: () => {},
            warn: (...data) => warnings.push(data.join(" ")),
            error: () => {}
        }

        // 1. Load Plugin A (Ledger)
        const pluginA = await host.loadPlugin(
            handlePluginA,
            { name: "plugin-a-ledger", version: "0.1.0" },
            { "default-rates.json": JSON.stringify({ currency: "USD", baseRate: 0.05 }) }
        )

        // 2. Load Plugin B (Interest Calculator)
        const pluginB = await host.loadPlugin(
            handlePluginB,
            { name: "plugin-b-interest", version: "0.1.0" },
            {}
        )

        // 3. Load Plugin C (Fraud Detector)
        const pluginC = await host.loadPlugin(
            handlePluginC,
            { name: "plugin-c-fraud-detector", version: "0.1.0" },
            {
                "alert-template.txt":
                    "[FRAUD ALERT] High-value activity on ${accountId}: delta=${delta}, balance=${balance}"
            },
            logger
        )

        // Verify Plugin B registered interest service
        const interestService = await host.getComponent(InterestServiceSchema)
        expect(interestService).toBeDefined()

        // Apply interest across all accounts
        const totalInterest = interestService?.applyInterestToAll()
        expect(totalInterest).toBeGreaterThan(0)

        // Verify balances accrued interest
        const ledger = await host.getComponent(BankLedgerSchema)
        expect(ledger?.getAccount("acc-1")?.balance).toBe(1050) // 1000 + 5% = 1050

        // Test Plugin C fraud detection: Deposit $50,000 to trigger alert
        ledger?.deposit("acc-2", 50000)

        const fraudLog = await host.getComponent(FraudAuditLogSchema)
        expect(fraudLog).toBeDefined()
        const incidents = fraudLog?.getIncidents() ?? []
        expect(incidents.length).toBe(1)
        expect(incidents[0]?.accountId).toBe("acc-2")
        expect(incidents[0]?.delta).toBe(50000)
        expect(warnings.some((w) => w.includes("[FRAUD ALERT]"))).toBe(true)

        // Teardown
        await pluginC.dispose()
        await pluginB.dispose()
        await pluginA.dispose()
    })

    it("should automatically clean up child context components and listeners on dispose", async () => {
        const host = new TestPluginHost()

        // Load Plugin A
        const pluginA = await host.loadPlugin(
            handlePluginA,
            { name: "plugin-a-ledger", version: "0.1.0" },
            { "default-rates.json": JSON.stringify({ currency: "USD", baseRate: 0.05 }) }
        )

        let deletedDetected = false
        // Load Plugin B which listens to BankLedger deletes
        const pluginB = await host.loadPlugin(
            handlePluginB,
            { name: "plugin-b-interest", version: "0.1.0" },
            {
                ...{},
            }
        )

        // Manually subscribe to deletion of ledger
        pluginB.context.onComponentDelete(BankLedgerSchema, () => {
            deletedDetected = true
        })

        expect(await host.getComponent(BankLedgerSchema)).toBeDefined()
        expect(await host.getComponent(InterestServiceSchema)).toBeDefined()

        // Disposing Plugin A should trigger delete and notify Plugin B
        await pluginA.dispose()

        expect(await host.getComponent(BankLedgerSchema)).toBeUndefined()
        expect(deletedDetected).toBe(true)

        // Disposing Plugin B should auto-clean its own components
        await pluginB.dispose()
        expect(await host.getComponent(InterestServiceSchema)).toBeUndefined()
    })
})
