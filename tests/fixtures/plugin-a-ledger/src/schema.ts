import { z } from "zod"

export const AccountSchema = z.object({
    id: z.string(),
    owner: z.string(),
    balance: z.number(),
    updatedAt: z.number()
})
export type Account = z.infer<typeof AccountSchema>

export const BankLedgerSchema = z.object({
    currency: z.string(),
    accounts: z.map(z.string(), AccountSchema),
    deposit: z.custom<(id: string, amount: number) => void>(),
    transfer: z.custom<(fromId: string, toId: string, amount: number) => void>(),
    getAccount: z.custom<(id: string) => Account | undefined>()
})
export type BankLedger = z.infer<typeof BankLedgerSchema>
