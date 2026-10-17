import { z } from "zod"
import type { PluginContext, UnsubscribeCallback } from "@repo/core"
import { BankLedgerSchema, type BankLedger } from "@fixture/plugin-a-ledger/schema"

export const InterestServiceSchema = z.object({
    interestRate: z.number(),
    applyInterestToAll: z.custom<() => number>()
})
export type InterestService = z.infer<typeof InterestServiceSchema>

export default async function handle(context: PluginContext): Promise<UnsubscribeCallback> {
    context.logger.info(`Initializing ${context.metadata.name}...`)

    let activeLedger: BankLedger | undefined = await context.getComponent(BankLedgerSchema)
    const annualRate = 0.05

    const service: InterestService = {
        interestRate: annualRate,
        applyInterestToAll: () => {
            if (!activeLedger) {
                throw new Error("Cannot apply interest: BankLedger component is unavailable")
            }
            let totalInterest = 0
            for (const [id, account] of activeLedger.accounts.entries()) {
                const interest = Math.round(account.balance * annualRate * 100) / 100
                if (interest > 0) {
                    activeLedger.deposit(id, interest)
                    totalInterest += interest
                }
            }
            context.logger.info(`Applied total interest: $${totalInterest}`)
            return totalInterest
        }
    }

    // Register own service component
    await context.putComponent(InterestServiceSchema, service)

    // React to BankLedger lifecycle
    const unsubPut = context.onComponentPut(BankLedgerSchema, (newLedger) => {
        context.logger.debug("Interest calculator received updated BankLedger")
        activeLedger = newLedger
    })

    const unsubDelete = context.onComponentDelete(BankLedgerSchema, () => {
        context.logger.warn("BankLedger was removed! Pausing interest calculation capability.")
        activeLedger = undefined
    })

    return () => {
        context.logger.info(`Unloading ${context.metadata.name}...`)
        unsubPut()
        unsubDelete()
        void context.deleteComponent(InterestServiceSchema)
    }
}
