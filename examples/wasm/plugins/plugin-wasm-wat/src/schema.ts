import { z } from "zod"

export const CryptoCipherSchema = z.object({
    xorCipher: z.custom<(text: string, key: number) => { hex: string; base64: string }>(),
    xorDecipher: z.custom<(hexInput: string, key: number) => string>(),
    rot13: z.custom<(text: string) => string>(),
    crc16: z.custom<(text: string) => string>(),
    computePrimeKeyHash: z.custom<(seed: string, primeLimit: number) => Promise<{ key: number; hash: string }>>()
}).describe("CryptoCipher")

export type CryptoCipher = z.infer<typeof CryptoCipherSchema>
