export class HostError extends Error {
    constructor(message: string) {
        super(message)
        this.name = this.constructor.name
    }
}

export class CircularDependencyError extends HostError {
    readonly cycle: string[]

    constructor(cycle: string[], message?: string) {
        const cycleStr = cycle.join(" -> ")
        super(message ?? `Circular dependency detected: ${cycleStr}`)
        this.name = "CircularDependencyError"
        this.cycle = cycle
    }
}

export class PluginNotFoundError extends HostError {
    readonly pluginName: string

    constructor(pluginName: string) {
        super(`Plugin "${pluginName}" not found`)
        this.name = "PluginNotFoundError"
        this.pluginName = pluginName
    }
}

export class PluginStateError extends HostError {
    readonly pluginName: string
    readonly currentState: string

    constructor(pluginName: string, currentState: string, message: string) {
        super(`Plugin "${pluginName}" (state: ${currentState}): ${message}`)
        this.name = "PluginStateError"
        this.pluginName = pluginName
        this.currentState = currentState
    }
}

export class ComponentNotFoundError extends HostError {
    readonly schemaKey: string

    constructor(schemaKey: string) {
        super(`Component for schema "${schemaKey}" was not found in host or any active plugin`)
        this.name = "ComponentNotFoundError"
        this.schemaKey = schemaKey
    }
}

export class AssetNotFoundError extends HostError {
    readonly pluginName: string
    readonly assetPath: string

    constructor(pluginName: string, assetPath: string) {
        super(`Asset "${assetPath}" not found in plugin "${pluginName}"`)
        this.name = "AssetNotFoundError"
        this.pluginName = pluginName
        this.assetPath = assetPath
    }
}

export class PluginExecutionError extends HostError {
    readonly pluginName: string
    readonly causeError?: unknown

    constructor(pluginName: string, message: string, causeError?: unknown) {
        super(`Error in plugin "${pluginName}": ${message}`)
        this.name = "PluginExecutionError"
        this.pluginName = pluginName
        this.causeError = causeError
    }
}
