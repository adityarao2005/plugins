import { describe, expect, it } from "bun:test"
import { DependencyGraph } from "./dag"
import { CircularDependencyError } from "./errors"

describe("DependencyGraph (DAG)", () => {
    it("manages nodes and direct edges correctly", () => {
        const dag = new DependencyGraph()
        dag.addNode("A")
        dag.addNode("B")
        dag.addEdge("B", "A") // B depends on A

        expect(dag.hasNode("A")).toBe(true)
        expect(dag.hasNode("B")).toBe(true)
        expect(dag.hasEdge("B", "A")).toBe(true)
        expect(dag.hasEdge("A", "B")).toBe(false)

        expect(Array.from(dag.getDirectDependencies("B"))).toEqual(["A"])
        expect(Array.from(dag.getDirectDependents("A"))).toEqual(["B"])
    })

    it("prevents direct circular dependencies (A -> B -> A)", () => {
        const dag = new DependencyGraph()
        dag.addEdge("B", "A") // B depends on A

        expect(() => {
            dag.addEdge("A", "B") // A depends on B -> CYCLE!
        }).toThrow(CircularDependencyError)
    })

    it("prevents self-dependencies (A -> A)", () => {
        const dag = new DependencyGraph()
        expect(() => {
            dag.addEdge("A", "A")
        }).toThrow(CircularDependencyError)
    })

    it("prevents deep transitive circular dependencies (A -> B -> C -> D -> A)", () => {
        const dag = new DependencyGraph()
        dag.addEdge("B", "A") // B depends on A
        dag.addEdge("C", "B") // C depends on B
        dag.addEdge("D", "C") // D depends on C

        // Trying to make A depend on D would create: A -> D -> C -> B -> A
        expect(() => {
            dag.addEdge("A", "D")
        }).toThrow(CircularDependencyError)
    })

    it("tracks transitive dependencies and dependents", () => {
        const dag = new DependencyGraph()
        // C depends on B, B depends on A
        dag.addEdge("B", "A")
        dag.addEdge("C", "B")
        // D also depends on B
        dag.addEdge("D", "B")

        const allDepsOfC = dag.getAllDependencies("C")
        expect(allDepsOfC.has("B")).toBe(true)
        expect(allDepsOfC.has("A")).toBe(true)

        const allDependentsOfA = dag.getAllDependents("A")
        expect(allDependentsOfA.has("B")).toBe(true)
        expect(allDependentsOfA.has("C")).toBe(true)
        expect(allDependentsOfA.has("D")).toBe(true)
    })

    it("performs topological sort with dependencies first", () => {
        const dag = new DependencyGraph()
        dag.addEdge("B", "A") // B depends on A
        dag.addEdge("C", "B") // C depends on B
        dag.addEdge("D", "A") // D depends on A

        const order = dag.topologicalSort()
        // A must come before B, C, D
        // B must come before C
        expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"))
        expect(order.indexOf("B")).toBeLessThan(order.indexOf("C"))
        expect(order.indexOf("A")).toBeLessThan(order.indexOf("D"))
    })

    it("computes correct deactivation order with dependents deactivated BEFORE dependencies", () => {
        const dag = new DependencyGraph()
        // C depends on B, B depends on A
        dag.addEdge("B", "A")
        dag.addEdge("C", "B")
        // D depends on B
        dag.addEdge("D", "B")

        // If A is deactivated, C and D must deactivate first, then B, then A!
        const { deactivationOrder, cascadingDependents } = dag.getDeactivationOrder("A")

        expect(cascadingDependents).toContain("B")
        expect(cascadingDependents).toContain("C")
        expect(cascadingDependents).toContain("D")

        // C must deactivate before B
        expect(deactivationOrder.indexOf("C")).toBeLessThan(deactivationOrder.indexOf("B"))
        // D must deactivate before B
        expect(deactivationOrder.indexOf("D")).toBeLessThan(deactivationOrder.indexOf("B"))
        // B must deactivate before A
        expect(deactivationOrder.indexOf("B")).toBeLessThan(deactivationOrder.indexOf("A"))
        // Target A is deactivated last in this chain
        expect(deactivationOrder[deactivationOrder.length - 1]).toBe("A")
    })

    it("generates a mermaid diagram representation", () => {
        const dag = new DependencyGraph()
        dag.addEdge("plugin-b", "plugin-a")
        const mermaid = dag.toMermaid()
        expect(mermaid).toContain('"plugin-b" --> "plugin-a"')
    })
})
