import { z } from "zod"
import type { PluginContext, UnsubscribeCallback } from "@repo/core"
import { BankLedgerSchema, type Account, type BankLedger } from "./schema"

export * from "./schema"

const RateConfigSchema = z.object({
    currency: z.string().default("USD"),
    baseRate: z.number().default(0.05)
})

export default async function handle(context: PluginContext): Promise<UnsubscribeCallback> {
    context.logger.info(`Initializing ${context.metadata.name}@${context.metadata.version}...`)

    // Load bundled asset
    const rateAsset = await context.getAsset("default-rates.json")
    const rates = rateAsset ? await rateAsset.json(RateConfigSchema) : { currency: "USD", baseRate: 0.05 }

    const accounts = new Map<string, Account>()

    // Seed test accounts
    accounts.set("acc-1", {
        id: "acc-1",
        owner: "Alice",
        balance: 1000,
        updatedAt: Date.now()
    })
    accounts.set("acc-2", {
        id: "acc-2",
        owner: "Bob",
        balance: 500,
        updatedAt: Date.now()
    })

    const notifyUpdate = async () => {
        await context.putComponent(BankLedgerSchema, ledger)
    }

    const ledger: BankLedger = {
        currency: rates.currency,
        accounts,
        getAccount: (id: string) => accounts.get(id),
        deposit: (id: string, amount: number) => {
            const acc = accounts.get(id) ?? {
                id,
                owner: "Unknown",
                balance: 0,
                updatedAt: Date.now()
            }
            acc.balance += amount
            acc.updatedAt = Date.now()
            accounts.set(id, acc)
            void notifyUpdate()
        },
        transfer: (fromId: string, toId: string, amount: number) => {
            const from = accounts.get(fromId)
            const to = accounts.get(toId)
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
            void notifyUpdate()
        }
    }

    // Register component
    await context.putComponent(BankLedgerSchema, ledger)

    return () => {
        context.logger.info(`Unloading ${context.metadata.name}...`)
        void context.deleteComponent(BankLedgerSchema)
    }
}
