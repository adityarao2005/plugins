export interface IPluginWorker {
    postMessage(message: any, transfer?: Transferable[]): void
    onmessage: ((event: { data: any }) => void) | null
    onerror: ((error: any) => void) | null
    terminate(): Promise<void> | void
}

export interface CreateWorkerOptions {
    name: string
    workerType?: "auto" | "web" | "node" | "in-memory"
}
