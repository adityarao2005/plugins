import path from "node:path"
import z from "zod"
import { PluginHost, CircularDependencyError } from "../../packages/host/src"

// Define a schema for a host-provided service (host proxy component)
const HostMetricsSchema = z.object({
    recordEvent: z.custom<(eventName: string, data: Record<string, any>) => void>(),
    getEvents: z.custom<() => Array<{ eventName: string; data: Record<string, any>; timestamp: number }>>()
})
type HostMetrics = z.infer<typeof HostMetricsSchema>

class HostMetricsImpl implements HostMetrics {
    private events: Array<{ eventName: string; data: Record<string, any>; timestamp: number }> = []

    recordEvent(eventName: string, data: Record<string, any>): void {
        const entry = { eventName, data, timestamp: Date.now() }
        this.events.push(entry)
        console.log(`[Host Metrics] Event recorded: "${eventName}"`, data)
    }

    getEvents() {
        return [...this.events]
    }
}

export async function runBasicHostExample() {
    console.log("==================================================")
    console.log("   Plugin Host Library - Complete Example Walkthrough")
    console.log("==================================================\n")

    // 1. Initialize the PluginHost
    const host = new PluginHost({
        autoActivate: true,
        autoReactivateDependents: true
    })

    // 2. Register Host Components (Host Proxy Plugin)
    // Host components can be required and used by any plugin
    const metricsService = new HostMetricsImpl()
    host.registerComponent(HostMetricsSchema, metricsService)
    console.log("✓ Registered host component: HostMetricsSchema\n")

    // 3. Resolve paths to sample compiled .plugin files
    const fixtureAPath = path.resolve(
        import.meta.dir,
        "../../tests/fixtures/plugin-a-ledger/dist/plugin-a-ledger.plugin"
    )
    const fixtureBPath = path.resolve(
        import.meta.dir,
        "../../tests/fixtures/plugin-b-interest/dist/plugin-b-interest.plugin"
    )

    // 4. Load Plugin A (Bank Ledger Plugin) from disk
    console.log("Loading Plugin A (Ledger)...")
    const pluginA = await host.loadPlugin(fixtureAPath)
    console.log(`✓ Plugin A loaded: "${pluginA.name}" (version: ${pluginA.version}, state: ${pluginA.state})`)

    // Asset Traversal
    console.log("\nTraversing assets inside Plugin A:")
    const assets = pluginA.listAssets()
    console.log("  Available assets:", assets)

    const rateAsset = await pluginA.getAsset("default-rates.json")
    if (rateAsset) {
        const rateContent = await rateAsset.json()
        console.log("  Parsed default-rates.json:", rateContent)
    }

    // 5. Load Plugin B (Interest Service Plugin)
    // Plugin B requires BankLedgerSchema, which is exported by Plugin A
    console.log("\nLoading Plugin B (Interest Service, depends on Plugin A)...")
    const pluginB = await host.loadPlugin(fixtureBPath)
    console.log(`✓ Plugin B loaded: "${pluginB.name}" (state: ${pluginB.state})`)

    // 6. Inspect the Dependency Graph (DAG)
    const dag = host.getDependencyGraph()
    console.log("\nDependency Graph:")
    console.log("  Plugin B dependencies:", Array.from(dag.getDirectDependencies(pluginB.name)))
    console.log("  Plugin A dependents:", Array.from(dag.getDirectDependents(pluginA.name)))
    console.log("  Mermaid Diagram:\n" + dag.toMermaid().split("\n").map(l => "    " + l).join("\n"))

    // 7. Deactivate vs. Remove Semantics
    console.log("\n--------------------------------------------------")
    console.log("Demonstrating Deactivate vs Remove")
    console.log("--------------------------------------------------")

    // Action 1: Deactivate Plugin A
    console.log("\n[Action] Deactivating Plugin A...")
    const deactivateResult = await host.deactivatePlugin(pluginA.name)
    console.log("  Cascading deactivation triggered for dependents:", deactivateResult.cascadingDependents)
    console.log("  Plugin A state:", host.getPlugin(pluginA.name)?.state)
    console.log("  Plugin B state:", host.getPlugin(pluginB.name)?.state, `(reason: ${host.getPlugin(pluginB.name)?.deactivatedReason})`)

    // Reactivate Plugin A -> Dependent Plugin B automatically reactivates
    console.log("\n[Action] Reactivating Plugin A...")
    await host.activatePlugin(pluginA.name)
    console.log("  Plugin A state:", host.getPlugin(pluginA.name)?.state)
    console.log("  Plugin B state:", host.getPlugin(pluginB.name)?.state)

    // Action 2: Remove Plugin A
    console.log("\n[Action] Removing Plugin A (invokes deactivate first, terminates worker)...")
    const removeResult = await host.removePlugin(pluginA.name)
    console.log("  Removed plugin:", removeResult.removed)
    console.log("  Dependents kept in deactivated state:", removeResult.deactivatedDependents)
    console.log("  Plugin A in host:", host.getPlugin(pluginA.name))
    console.log("  Plugin B state:", host.getPlugin(pluginB.name)?.state)
    console.log("  Plugin B is waiting for missing dependency:", host.getPlugin(pluginB.name)?.waitingForDependencies)

    // 8. Host Replacement Proxy Component
    // Now provide replacement component from host to satisfy Plugin B's missing requirement!
    console.log("\n[Action] Providing replacement BankLedger component directly from the host...")
    const BankLedgerSchema = z.object({
        currency: z.string(),
        accounts: z.map(z.string(), z.any()),
        deposit: z.custom<(id: string, amount: number) => void>(),
        transfer: z.custom<(fromId: string, toId: string, amount: number) => void>(),
        getAccount: z.custom<(id: string) => any>()
    })

    const replacementLedger = {
        currency: "EUR",
        accounts: new Map([
            ["acc-host-1", { id: "acc-host-1", owner: "HostUser", balance: 5000, updatedAt: Date.now() }]
        ]),
        deposit: (id: string, amount: number) => console.log(`[Host Ledger Proxy] Deposited €${amount} to ${id}`),
        transfer: () => {},
        getAccount: (id: string) => replacementLedger.accounts.get(id)
    }

    host.registerComponent(BankLedgerSchema, replacementLedger)
    console.log("✓ Replacement registered by host proxy!")

    // Plugin B's dependency is now satisfied and it reactivates!
    await host.activatePlugin(pluginB.name)
    console.log("  Plugin B state after host replacement:", host.getPlugin(pluginB.name)?.state)

    // 9. Circular Dependency Prevention
    console.log("\n--------------------------------------------------")
    console.log("Demonstrating Circular Dependency Prevention")
    console.log("--------------------------------------------------")
    const testDag = host.getDependencyGraph()
    try {
        console.log("Attempting to add cycle: plugin-b depends on plugin-c, plugin-c depends on plugin-b...")
        testDag.addEdge("plugin-b", "plugin-c")
        testDag.addEdge("plugin-c", "plugin-b") // This must throw!
    } catch (err: any) {
        if (err instanceof CircularDependencyError) {
            console.log("✓ Cycle successfully caught and prevented!")
            console.log("  Error message:", err.message)
            console.log("  Cycle path:", err.cycle)
        } else {
            throw err
        }
    }

    // 10. Clean shutdown
    console.log("\nCleaning up host and terminating all workers...")
    await host.destroy()
    console.log("✓ Complete!\n")
}

// Auto-run if executed directly
if (import.meta.main) {
    runBasicHostExample().catch(err => {
        console.error("Example error:", err)
        process.exit(1)
    })
}
