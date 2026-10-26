import { CircularDependencyError } from "./errors"

/**
 * Directed Acyclic Graph (DAG) for managing plugin dependencies.
 *
 * An edge `dependent -> dependency` indicates that `dependent` requires
 * or relies on `dependency`.
 *
 * For example, if Plugin B imports or requires components from Plugin A,
 * then Plugin B is the dependent, and Plugin A is the dependency:
 * `B depends on A` (Edge: B -> A).
 */
export class DependencyGraph {
    // node -> Set of nodes that this node depends on (dependencies)
    private outgoing = new Map<string, Set<string>>()
    // node -> Set of nodes that depend on this node (dependents)
    private incoming = new Map<string, Set<string>>()

    constructor() {}

    /**
     * Add a node to the graph if not already present.
     */
    addNode(node: string): void {
        if (!this.outgoing.has(node)) {
            this.outgoing.set(node, new Set())
        }
        if (!this.incoming.has(node)) {
            this.incoming.set(node, new Set())
        }
    }

    /**
     * Check if node exists in the graph.
     */
    hasNode(node: string): boolean {
        return this.outgoing.has(node)
    }

    /**
     * Remove a node and all associated edges from the graph.
     */
    removeNode(node: string): void {
        if (!this.hasNode(node)) return

        // Remove from outgoing edges of other nodes
        const dependents = this.incoming.get(node) ?? new Set()
        for (const dep of dependents) {
            this.outgoing.get(dep)?.delete(node)
        }

        // Remove from incoming edges of other nodes
        const dependencies = this.outgoing.get(node) ?? new Set()
        for (const dep of dependencies) {
            this.incoming.get(dep)?.delete(node)
        }

        this.outgoing.delete(node)
        this.incoming.delete(node)
    }

    /**
     * Returns all nodes currently registered in the graph.
     */
    getNodes(): string[] {
        return Array.from(this.outgoing.keys())
    }

    /**
     * Add a dependency edge: `dependent` depends on `dependency`.
     * If adding this edge would create a cycle, a `CircularDependencyError` is thrown
     * and the edge is NOT added.
     *
     * @param dependent The node that requires the dependency.
     * @param dependency The node being relied upon.
     */
    addEdge(dependent: string, dependency: string): void {
        if (dependent === dependency) {
            throw new CircularDependencyError([dependent, dependency], `Self-dependency detected on "${dependent}"`)
        }

        this.addNode(dependent)
        this.addNode(dependency)

        // Check if edge already exists
        if (this.outgoing.get(dependent)?.has(dependency)) {
            return
        }

        // Check if adding `dependent -> dependency` would create a cycle
        // That happens if there is already a path from `dependency` to `dependent`.
        const cycle = this.findPath(dependency, dependent)
        if (cycle) {
            const fullCycle = [dependent, ...cycle]
            throw new CircularDependencyError(
                fullCycle,
                `Circular dependency detected: ${fullCycle.join(" -> ")}`
            )
        }

        this.outgoing.get(dependent)!.add(dependency)
        this.incoming.get(dependency)!.add(dependent)
    }

    /**
     * Remove a dependency edge.
     */
    removeEdge(dependent: string, dependency: string): void {
        this.outgoing.get(dependent)?.delete(dependency)
        this.incoming.get(dependency)?.delete(dependent)
    }

    /**
     * Check if a direct edge exists (`dependent` depends directly on `dependency`).
     */
    hasEdge(dependent: string, dependency: string): boolean {
        return this.outgoing.get(dependent)?.has(dependency) ?? false
    }

    /**
     * Get direct dependencies of a node (nodes that `node` directly depends on).
     */
    getDirectDependencies(node: string): Set<string> {
        return new Set(this.outgoing.get(node) ?? [])
    }

    /**
     * Get direct dependents of a node (nodes that directly depend on `node`).
     */
    getDirectDependents(node: string): Set<string> {
        return new Set(this.incoming.get(node) ?? [])
    }

    /**
     * Get all transitive dependencies of a node (everything `node` relies on, directly or indirectly).
     */
    getAllDependencies(node: string): Set<string> {
        const result = new Set<string>()
        const queue: string[] = Array.from(this.outgoing.get(node) ?? [])

        while (queue.length > 0) {
            const current = queue.shift()!
            if (!result.has(current)) {
                result.add(current)
                const next = this.outgoing.get(current) ?? new Set()
                for (const item of next) {
                    if (!result.has(item)) {
                        queue.push(item)
                    }
                }
            }
        }

        return result
    }

    /**
     * Get all transitive dependents of a node (everything that relies on `node`, directly or indirectly).
     */
    getAllDependents(node: string): Set<string> {
        const result = new Set<string>()
        const queue: string[] = Array.from(this.incoming.get(node) ?? [])

        while (queue.length > 0) {
            const current = queue.shift()!
            if (!result.has(current)) {
                result.add(current)
                const next = this.incoming.get(current) ?? new Set()
                for (const item of next) {
                    if (!result.has(item)) {
                        queue.push(item)
                    }
                }
            }
        }

        return result
    }

    /**
     * Find a directed path from `start` to `end` using BFS.
     * Returns the list of nodes in the path [start, ..., end], or null if no path exists.
     */
    private findPath(start: string, end: string): string[] | null {
        if (start === end) return [start]

        const visited = new Set<string>([start])
        const queue: { node: string; path: string[] }[] = [{ node: start, path: [start] }]

        while (queue.length > 0) {
            const { node, path } = queue.shift()!
            const neighbors = this.outgoing.get(node) ?? new Set()

            for (const neighbor of neighbors) {
                if (neighbor === end) {
                    return [...path, end]
                }
                if (!visited.has(neighbor)) {
                    visited.add(neighbor)
                    queue.push({ node: neighbor, path: [...path, neighbor] })
                }
            }
        }

        return null
    }

    /**
     * Return topological sort of all nodes (dependencies before dependents).
     * If the graph contains a cycle (which addEdge prevents), an error is thrown.
     */
    topologicalSort(): string[] {
        // In-degree from the perspective of incoming edges for topological ordering:
        // A node with 0 dependencies can be processed first.
        const dependencyCount = new Map<string, number>()
        for (const [node, deps] of this.outgoing.entries()) {
            dependencyCount.set(node, deps.size)
        }

        const queue: string[] = []
        for (const [node, count] of dependencyCount.entries()) {
            if (count === 0) {
                queue.push(node)
            }
        }

        const result: string[] = []

        while (queue.length > 0) {
            const node = queue.shift()!
            result.push(node)

            const dependents = this.incoming.get(node) ?? new Set()
            for (const dependent of dependents) {
                const currentCount = dependencyCount.get(dependent) ?? 0
                const newCount = currentCount - 1
                dependencyCount.set(dependent, newCount)
                if (newCount === 0) {
                    queue.push(dependent)
                }
            }
        }

        if (result.length !== this.outgoing.size) {
            throw new CircularDependencyError([], "Graph contains an unresolved circular dependency")
        }

        return result
    }

    /**
     * Calculate the proper deactivation order when `targetNode` is deactivated or removed.
     *
     * In a safe shutdown sequence, downstream dependents must be deactivated BEFORE
     * their dependencies.
     *
     * Example:
     * If C depends on B, and B depends on A:
     * When A is deactivated:
     * Cascading dependents: [C, B]
     * Order returned: [C, B, targetNode] (C first, then B, then A)
     *
     * @param targetNode The node to deactivate.
     * @returns Array of node IDs in the exact order they should be deactivated.
     */
    getDeactivationOrder(targetNode: string): { deactivationOrder: string[]; cascadingDependents: string[] } {
        const allDependents = this.getAllDependents(targetNode)

        // Subgraph of all affected nodes: targetNode + all its dependents
        const affectedNodes = new Set<string>([...allDependents, targetNode])

        // Topological ordering of affected nodes where dependents come FIRST
        // (i.e. nodes with 0 incoming dependents within the affected set)
        const dependentCount = new Map<string, number>()
        for (const node of affectedNodes) {
            let count = 0
            const nodeDependents = this.incoming.get(node) ?? new Set()
            for (const dep of nodeDependents) {
                if (affectedNodes.has(dep)) {
                    count++
                }
            }
            dependentCount.set(node, count)
        }

        const queue: string[] = []
        for (const [node, count] of dependentCount.entries()) {
            if (count === 0) {
                queue.push(node)
            }
        }

        const deactivationOrder: string[] = []
        while (queue.length > 0) {
            const node = queue.shift()!
            deactivationOrder.push(node)

            const dependencies = this.outgoing.get(node) ?? new Set()
            for (const dep of dependencies) {
                if (affectedNodes.has(dep)) {
                    const current = dependentCount.get(dep) ?? 0
                    const next = current - 1
                    dependentCount.set(dep, next)
                    if (next === 0) {
                        queue.push(dep)
                    }
                }
            }
        }

        const cascadingDependents = deactivationOrder.filter(n => n !== targetNode)
        return { deactivationOrder, cascadingDependents }
    }

    /**
     * Generate a visual Mermaid diagram string representing the current DAG.
     */
    toMermaid(): string {
        const lines: string[] = ["graph TD"]
        for (const [dependent, deps] of this.outgoing.entries()) {
            if (deps.size === 0) {
                lines.push(`    "${dependent}"`)
            } else {
                for (const dep of deps) {
                    lines.push(`    "${dependent}" --> "${dep}"`)
                }
            }
        }
        return lines.join("\n")
    }
}
