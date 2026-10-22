import { z } from "zod"
import { plugin } from "@repo/core"
import { BankLedgerSchema, type Account, type BankLedger } from "./schema"

export * from "./schema"

const RateConfigSchema = z.object({
    currency: z.string().default("USD"),
    baseRate: z.number().default(0.05)
})

@plugin.component(BankLedgerSchema)
export class BankLedgerImpl implements BankLedger {
    currency = "USD"
    accounts = new Map<string, Account>()

    constructor() {
        // Seed test accounts
        this.accounts.set("acc-1", {
            id: "acc-1",
            owner: "Alice",
            balance: 1000,
            updatedAt: Date.now()
        })
        this.accounts.set("acc-2", {
            id: "acc-2",
            owner: "Bob",
            balance: 500,
            updatedAt: Date.now()
        })
    }

    getAccount(id: string): Account | undefined {
        return this.accounts.get(id)
    }

    deposit(id: string, amount: number): void {
        const acc = this.accounts.get(id) ?? {
            id,
            owner: "Unknown",
            balance: 0,
            updatedAt: Date.now()
        }
        acc.balance += amount
        acc.updatedAt = Date.now()
        this.accounts.set(id, acc)
    }

    transfer(fromId: string, toId: string, amount: number): void {
        const from = this.accounts.get(fromId)
        const to = this.accounts.get(toId)
        if (!from || !to) {
            throw new Error(`Invalid transfer: accounts ${fromId} or ${toId} not found`)
        }
        if (from.balance < amount) {
            throw new Error(`Insufficient funds: ${fromId} has ${from.balance}, transfer requires ${amount}`)
        }
        from.balance -= amount
        from.updatedAt = Date.now()
        to.balance += amount
        to.updatedAt = Date.now()
    }
}

plugin.onActivated = async () => {
    plugin.logger.info(`Initializing ${plugin.metadata.name}@${plugin.metadata.version}...`)

    const rateAsset = await plugin.getAsset("default-rates.json")
    const rates = rateAsset ? await rateAsset.json(RateConfigSchema) : { currency: "USD", baseRate: 0.05 }

    const ledger = (plugin as any).exportedComponents?.get(BankLedgerSchema) as BankLedgerImpl | undefined
    if (ledger) {
        ledger.currency = rates.currency
    }
}

plugin.onDeactivated = () => {
    plugin.logger.info(`Unloading ${plugin.metadata.name}...`)
}

export default plugin

