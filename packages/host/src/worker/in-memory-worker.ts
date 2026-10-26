import type { IPluginWorker } from "./types"

/**
 * Message channel simulating worker postMessage / onmessage asynchronously in-memory.
 */
export class InMemoryWorkerAdapter implements IPluginWorker {
    onmessage: ((event: { data: any }) => void) | null = null
    onerror: ((error: any) => void) | null = null

    // Handler simulating the worker's internal globalThis.onmessage
    workerOnMessage: ((event: { data: any }) => void) | null = null

    private isTerminated = false

    constructor() {}

    /**
     * Send message from host to the worker.
     */
    postMessage(message: any): void {
        if (this.isTerminated) return

        // Dispatch asynchronously
        queueMicrotask(() => {
            if (this.isTerminated) return
            try {
                if (typeof this.workerOnMessage === "function") {
                    this.workerOnMessage({ data: message })
                }
            } catch (err: any) {
                if (typeof this.onerror === "function") {
                    this.onerror(err)
                }
            }
        })
    }

    /**
     * Method called from inside the simulated worker to send message to host.
     */
    sendToHost(message: any): void {
        if (this.isTerminated) return

        queueMicrotask(() => {
            if (this.isTerminated) return
            try {
                if (typeof this.onmessage === "function") {
                    this.onmessage({ data: message })
                }
            } catch (err: any) {
                if (typeof this.onerror === "function") {
                    this.onerror(err)
                }
            }
        })
    }

    terminate(): void {
        this.isTerminated = true
        this.onmessage = null
        this.onerror = null
        this.workerOnMessage = null
    }
}
