import { z } from "zod"
import type { PluginContext, UnsubscribeCallback } from "@repo/core"
import { BankLedgerSchema } from "@fixture/plugin-a-ledger/schema"

export const FraudIncidentSchema = z.object({
    accountId: z.string(),
    delta: z.number(),
    balance: z.number(),
    timestamp: z.number(),
    alertMessage: z.string()
})
export type FraudIncident = z.infer<typeof FraudIncidentSchema>

export const FraudAuditLogSchema = z.object({
    incidents: z.array(FraudIncidentSchema),
    getIncidents: z.custom<() => FraudIncident[]>()
})
export type FraudAuditLog = z.infer<typeof FraudAuditLogSchema>

export default async function handle(context: PluginContext): Promise<UnsubscribeCallback> {
    context.logger.info(`Initializing ${context.metadata.name}...`)

    const alertAsset = await context.getAsset("alert-template.txt")
    const template = alertAsset
        ? await alertAsset.text()
        : "[FRAUD ALERT] High delta on ${accountId}: ${delta}"

    const incidents: FraudIncident[] = []
    const auditLog: FraudAuditLog = {
        incidents,
        getIncidents: () => [...incidents]
    }

    await context.putComponent(FraudAuditLogSchema, auditLog)

    const previousBalances = new Map<string, number>()

    // Seed previous balances from existing ledger if available
    const initialLedger = await context.getComponent(BankLedgerSchema)
    if (initialLedger) {
        for (const [id, acc] of initialLedger.accounts.entries()) {
            previousBalances.set(id, acc.balance)
        }
    }

    const unsub = context.onComponentPut(BankLedgerSchema, (newLedger) => {
        for (const [id, acc] of newLedger.accounts.entries()) {
            const prev = previousBalances.get(id) ?? 0
            const delta = acc.balance - prev
            previousBalances.set(id, acc.balance)

            if (delta >= 10000) {
                const alertMessage = template
                    .replaceAll("${accountId}", id)
                    .replaceAll("${delta}", String(delta))
                    .replaceAll("${balance}", String(acc.balance))

                context.logger.warn(alertMessage)
                incidents.push({
                    accountId: id,
                    delta,
                    balance: acc.balance,
                    timestamp: Date.now(),
                    alertMessage
                })
            }
        }
    })

    return () => {
        context.logger.info(`Unloading ${context.metadata.name}...`)
        unsub()
        void context.deleteComponent(FraudAuditLogSchema)
    }
}
