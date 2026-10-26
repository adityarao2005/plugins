import { describe, expect, it } from "bun:test"
import z from "zod"
import { PluginHost } from "./host"
import { CircularDependencyError, PluginNotFoundError } from "./errors"

const GreetingServiceSchema = z.object({
    greet: z.custom<(name: string) => string>()
})
type GreetingService = z.infer<typeof GreetingServiceSchema>

class GreetingServiceImpl implements GreetingService {
    greet(name: string): string {
        return `Hello, ${name}!`
    }
}

describe("PluginHost (Unit Tests)", () => {
    it("registers and retrieves host components (host proxy plugin)", async () => {
        const host = new PluginHost()
        const greetingService = new GreetingServiceImpl()

        host.registerComponent(GreetingServiceSchema, greetingService)

        const resolved = await host.getComponent(GreetingServiceSchema)
        expect(resolved).toBeDefined()
        expect(resolved?.greet("World")).toBe("Hello, World!")
    })

    it("unregisters host components", async () => {
        const host = new PluginHost()
        host.registerComponent(GreetingServiceSchema, new GreetingServiceImpl())

        expect(await host.getComponent(GreetingServiceSchema)).toBeDefined()

        host.unregisterComponent(GreetingServiceSchema)
        expect(await host.getComponent(GreetingServiceSchema)).toBeUndefined()
    })

    it("prevents circular dependencies between plugins", () => {
        const host = new PluginHost()
        const dag = host.getDependencyGraph()

        dag.addEdge("plugin-b", "plugin-a") // B depends on A
        dag.addEdge("plugin-c", "plugin-b") // C depends on B

        // Trying to add cycle: A depends on C -> Throws CircularDependencyError
        expect(() => {
            dag.addEdge("plugin-a", "plugin-c")
        }).toThrow(CircularDependencyError)
    })

    it("throws PluginNotFoundError for operations on unknown plugins", async () => {
        const host = new PluginHost()

        expect(async () => {
            await host.deactivatePlugin("non-existent")
        }).toThrow(PluginNotFoundError)

        expect(async () => {
            await host.removePlugin("non-existent")
        }).toThrow(PluginNotFoundError)
    })

    it("maintains DAG state correctly on deactivation and removal", () => {
        const host = new PluginHost()
        const dag = host.getDependencyGraph()

        // plugin-b depends on plugin-a
        dag.addEdge("plugin-b", "plugin-a")
        // plugin-c depends on plugin-a
        dag.addEdge("plugin-c", "plugin-a")

        expect(dag.getAllDependents("plugin-a").has("plugin-b")).toBe(true)
        expect(dag.getAllDependents("plugin-a").has("plugin-c")).toBe(true)

        // Deactivation order when plugin-a deactivates: dependents first!
        const { deactivationOrder, cascadingDependents } = dag.getDeactivationOrder("plugin-a")
        expect(cascadingDependents).toContain("plugin-b")
        expect(cascadingDependents).toContain("plugin-c")
        expect(deactivationOrder[deactivationOrder.length - 1]).toBe("plugin-a")

        // Removing plugin-a removes it from DAG
        dag.removeNode("plugin-a")
        expect(dag.hasNode("plugin-a")).toBe(false)
        expect(dag.getDirectDependencies("plugin-b").has("plugin-a")).toBe(false)
    })
})
