import { describe, expect, it } from "bun:test"
import path from "node:path"
import { PluginHost } from "./host"
import z from "zod"

const AccountSchema = z.object({
    id: z.string(),
    owner: z.string(),
    balance: z.number(),
    updatedAt: z.number()
})
type Account = z.infer<typeof AccountSchema>

const BankLedgerSchema = z.object({
    currency: z.string(),
    accounts: z.map(z.string(), AccountSchema),
    deposit: z.custom<(id: string, amount: number) => void>(),
    transfer: z.custom<(fromId: string, toId: string, amount: number) => void>(),
    getAccount: z.custom<(id: string) => Account | undefined>()
})
type BankLedger = z.infer<typeof BankLedgerSchema>

describe("PluginHost (Integration with Fixtures)", () => {
    const fixtureAPath = path.resolve(
        import.meta.dir,
        "../../../tests/fixtures/plugin-a-ledger/dist/plugin-a-ledger.plugin"
    )
    const fixtureBPath = path.resolve(
        import.meta.dir,
        "../../../tests/fixtures/plugin-b-interest/dist/plugin-b-interest.plugin"
    )
    const fixtureCPath = path.resolve(
        import.meta.dir,
        "../../../tests/fixtures/plugin-c-fraud-detector/dist/plugin-c-fraud-detector.plugin"
    )

    it("loads, initializes, and starts fixture A (ledger plugin)", async () => {
        const host = new PluginHost()
        try {
            const pluginA = await host.loadPlugin(fixtureAPath)

            expect(pluginA.name).toBe("@fixture/plugin-a-ledger")
            expect(pluginA.version).toBe("0.1.0")
            expect(pluginA.state).toBe("active")

            // Asset traversal
            const assets = pluginA.listAssets()
            expect(assets).toContain("default-rates.json")

            const asset = await pluginA.getAsset("default-rates.json")
            expect(asset).toBeDefined()
            const rateData = await asset?.json<{ currency: string }>()
            expect(rateData?.currency).toBe("USD")

            // Component export check
            expect(pluginA.exportedSchemas.length).toBeGreaterThan(0)
        } finally {
            await host.destroy()
        }
    })

    it("manages inter-plugin dependency and DAG between fixture A and fixture B", async () => {
        const host = new PluginHost()
        try {
            const pluginA = await host.loadPlugin(fixtureAPath)
            const pluginB = await host.loadPlugin(fixtureBPath)

            expect(pluginA.state).toBe("active")
            expect(pluginB.state).toBe("active")

            // DAG should track that plugin B depends on plugin A
            const dag = host.getDependencyGraph()
            expect(dag.hasEdge(pluginB.name, pluginA.name)).toBe(true)

            // Dependents of plugin A should include plugin B
            const dependents = dag.getAllDependents(pluginA.name)
            expect(dependents.has(pluginB.name)).toBe(true)
        } finally {
            await host.destroy()
        }
    })

    it("deactivates dependents when a dependency is deactivated", async () => {
        const host = new PluginHost()
        try {
            const pluginA = await host.loadPlugin(fixtureAPath)
            const pluginB = await host.loadPlugin(fixtureBPath)
            const pluginC = await host.loadPlugin(fixtureCPath)

            expect(pluginA.state).toBe("active")
            expect(pluginB.state).toBe("active")
            expect(pluginC.state).toBe("active")

            // Deactivate plugin A
            const result = await host.deactivatePlugin(pluginA.name)

            // Result should record cascading dependents
            expect(result.cascadingDependents).toContain(pluginB.name)
            expect(result.cascadingDependents).toContain(pluginC.name)

            // Target and dependents should all now be deactivated
            expect(host.getPlugin(pluginA.name)?.state).toBe("deactivated")
            expect(host.getPlugin(pluginB.name)?.state).toBe("deactivated")
            expect(host.getPlugin(pluginC.name)?.state).toBe("deactivated")

            // Reason should specify dependency deactivation for B and C
            expect(host.getPlugin(pluginB.name)?.deactivatedReason).toBe("dependency-deactivated")
            expect(host.getPlugin(pluginC.name)?.deactivatedReason).toBe("dependency-deactivated")

            // Reactivating plugin A should restore dependents back to active
            await host.activatePlugin(pluginA.name)
            expect(host.getPlugin(pluginA.name)?.state).toBe("active")
            expect(host.getPlugin(pluginB.name)?.state).toBe("active")
            expect(host.getPlugin(pluginC.name)?.state).toBe("active")
        } finally {
            await host.destroy()
        }
    })

    it("removes a plugin: invokes deactivate first, terminates worker, and keeps dependents deactivated", async () => {
        const host = new PluginHost()
        try {
            const pluginA = await host.loadPlugin(fixtureAPath)
            const pluginB = await host.loadPlugin(fixtureBPath)

            expect(pluginA.state).toBe("active")
            expect(pluginB.state).toBe("active")

            // Remove plugin A
            const result = await host.removePlugin(pluginA.name)

            expect(result.removed).toBe(pluginA.name)
            expect(result.deactivatedDependents).toContain(pluginB.name)

            // Plugin A should be removed completely
            expect(host.getPlugin(pluginA.name)).toBeUndefined()

            // Plugin B remains in host, but deactivated waiting for replacement
            const pluginBRecord = host.getPlugin(pluginB.name)
            expect(pluginBRecord).toBeDefined()
            expect(pluginBRecord?.state).toBe("deactivated")
            expect(pluginBRecord?.waitingForDependencies).toContain(pluginA.name)

            // Now provide replacement component from host (host proxy plugin!)
            const mockLedger: BankLedger = {
                currency: "EUR",
                accounts: new Map([
                    ["acc-100", { id: "acc-100", owner: "Charlie", balance: 2000, updatedAt: Date.now() }]
                ]),
                deposit: () => {},
                transfer: () => {},
                getAccount: (id) => mockLedger.accounts.get(id)
            }

            host.registerComponent(BankLedgerSchema, mockLedger)

            // Plugin B can now reactivate using the host replacement!
            await host.activatePlugin(pluginB.name)
            expect(host.getPlugin(pluginB.name)?.state).toBe("active")
        } finally {
            await host.destroy()
        }
    })
})
