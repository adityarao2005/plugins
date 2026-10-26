export { PluginHost } from "./host"
export { DependencyGraph } from "./dag"
export { PluginArchive, createHostAsset } from "./archive"
export { ComponentRegistry, serializeSchema, getSchemaKey } from "./component-registry"
export { detectRuntime, createPluginWorker } from "./worker/worker-adapter"
export { InMemoryWorkerAdapter } from "./worker/in-memory-worker"

export type {
    PluginState,
    PackageManifest,
    HostedPlugin,
    WorkerType,
    PluginHostOptions,
    LoadPluginOptions,
    DeactivateResult,
    RemoveResult,
    IPluginWorker
} from "./types"

export {
    HostError,
    CircularDependencyError,
    PluginNotFoundError,
    PluginStateError,
    ComponentNotFoundError,
    AssetNotFoundError,
    PluginExecutionError
} from "./errors"
