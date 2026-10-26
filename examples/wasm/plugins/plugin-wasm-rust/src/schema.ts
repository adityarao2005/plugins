import { z } from "zod"

export const MathCalculatorSchema = z.object({
    add: z.custom<(a: number, b: number) => number>(),
    fibonacci: z.custom<(n: number) => number>(),
    isPrime: z.custom<(n: number) => boolean>(),
    factorial: z.custom<(n: number) => number>()
}).describe("MathCalculator")

export type MathCalculator = z.infer<typeof MathCalculatorSchema>
