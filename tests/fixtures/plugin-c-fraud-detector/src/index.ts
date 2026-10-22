import { z } from "zod"
import { plugin } from "@repo/core"
import { BankLedgerSchema, type BankLedger } from "@fixture/plugin-a-ledger/schema"

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

const ledgerHandle = plugin.require(BankLedgerSchema)

@plugin.component(FraudAuditLogSchema)
export class FraudAuditLogImpl implements FraudAuditLog {
    incidents: FraudIncident[] = []

    getIncidents(): FraudIncident[] {
        return [...this.incidents]
    }

    recordIncident(incident: FraudIncident): void {
        this.incidents.push(incident)
    }
}

let template = "[FRAUD ALERT] High delta on ${accountId}: ${delta}"
let activeLedger: BankLedger | undefined
const previousBalances = new Map<string, number>()

function checkFraud(auditLog: FraudAuditLogImpl, ledger: BankLedger) {
    for (const [id, acc] of ledger.accounts.entries()) {
        const prev = previousBalances.get(id) ?? 0
        const delta = acc.balance - prev
        previousBalances.set(id, acc.balance)

        if (delta >= 10000) {
            const alertMessage = template
                .replaceAll("${accountId}", id)
                .replaceAll("${delta}", String(delta))
                .replaceAll("${balance}", String(acc.balance))

            plugin.logger.warn(alertMessage)
            auditLog.recordIncident({
                accountId: id,
                delta,
                balance: acc.balance,
                timestamp: Date.now(),
                alertMessage
            })
        }
    }
}

plugin.onActivated = async () => {
    plugin.logger.info(`Initializing ${plugin.metadata.name}...`)

    const alertAsset = await plugin.getAsset("alert-template.txt")
    if (alertAsset) {
        template = await alertAsset.text()
    }

    activeLedger = await ledgerHandle.get()
    const auditLog = (plugin as any).exportedComponents?.get(FraudAuditLogSchema) as FraudAuditLogImpl | undefined

    if (activeLedger) {
        for (const [id, acc] of activeLedger.accounts.entries()) {
            previousBalances.set(id, acc.balance)
        }

        const originalDeposit = activeLedger.deposit.bind(activeLedger)
        activeLedger.deposit = (id: string, amount: number) => {
            originalDeposit(id, amount)
            if (auditLog && activeLedger) {
                checkFraud(auditLog, activeLedger)
            }
        }
    }
}

plugin.onDeactivated = () => {
    plugin.logger.info(`Unloading ${plugin.metadata.name}...`)
    activeLedger = undefined
    previousBalances.clear()
}

export default plugin

