import { z } from "zod"
import { plugin } from "@repo/core"
import { BankLedgerSchema, type BankLedger } from "@fixture/plugin-a-ledger/schema"

export const InterestServiceSchema = z.object({
    interestRate: z.number(),
    applyInterestToAll: z.custom<() => number>()
})
export type InterestService = z.infer<typeof InterestServiceSchema>

const ledgerHandle = plugin.require(BankLedgerSchema)
let activeLedger: BankLedger | undefined

@plugin.component(InterestServiceSchema)
export class InterestServiceImpl implements InterestService {
    interestRate = 0.05

    applyInterestToAll(): number {
        if (!activeLedger) {
            throw new Error("Cannot apply interest: BankLedger component is unavailable")
        }
        let totalInterest = 0
        for (const [id, account] of activeLedger.accounts.entries()) {
            const interest = Math.round(account.balance * this.interestRate * 100) / 100
            if (interest > 0) {
                activeLedger.deposit(id, interest)
                totalInterest += interest
            }
        }
        plugin.logger.info(`Applied total interest: $${totalInterest}`)
        return totalInterest
    }
}

plugin.onActivated = async () => {
    plugin.logger.info(`Initializing ${plugin.metadata.name}...`)
    activeLedger = await ledgerHandle.get()
}

plugin.onDeactivated = () => {
    plugin.logger.info(`Unloading ${plugin.metadata.name}...`)
    activeLedger = undefined
}

export default plugin

