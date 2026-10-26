import { runBasicHostExample } from "./basic/host"

runBasicHostExample().catch(err => {
    console.error("Example error:", err)
    process.exit(1)
})
