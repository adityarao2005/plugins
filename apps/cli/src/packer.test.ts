import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import JSZip from "jszip"
import { packPlugin } from "./packer"
import { run } from "./index"

describe("CLI Plugin Packer", () => {
    it("packages bundled index.js, package.json, and multiple asset directories into valid zip using JSZip", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-pack-test-"))

        try {
            // Setup mock bundle
            const entryFile = path.join(tempDir, "dist", "index.js")
            fs.mkdirSync(path.dirname(entryFile), { recursive: true })
            fs.writeFileSync(entryFile, 'console.log("Hello from plugin");')

            // Setup mock package.json
            const pkgFile = path.join(tempDir, "package.json")
            fs.writeFileSync(pkgFile, JSON.stringify({
                name: "@fixture/plugin-c-fraud-detector",
                version: "0.1.0",
                description: "Detects fraudulent bank activity"
            }))

            // Setup asset directory 1 (templates)
            const assetsDir1 = path.join(tempDir, "assets")
            fs.mkdirSync(assetsDir1, { recursive: true })
            fs.writeFileSync(path.join(assetsDir1, "alert-template.txt"), "[ALERT] suspicious activity on ${accountId}")
            fs.mkdirSync(path.join(assetsDir1, "nested"), { recursive: true })
            fs.writeFileSync(path.join(assetsDir1, "nested", "rules.json"), '{"threshold": 10000}')

            // Setup asset directory 2 (media/images)
            const assetsDir2 = path.join(tempDir, "static-assets")
            fs.mkdirSync(assetsDir2, { recursive: true })
            fs.writeFileSync(path.join(assetsDir2, "icon.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))

            const outputZip = path.join(tempDir, "fraud-detector.zip")

            // Run packer
            const result = await packPlugin({
                entryPath: entryFile,
                packageJsonPath: pkgFile,
                assetDirs: [assetsDir1, assetsDir2],
                outputPath: outputZip
            })

            expect(result.name).toBe("@fixture/plugin-c-fraud-detector")
            expect(result.version).toBe("0.1.0")
            expect(fs.existsSync(outputZip)).toBe(true)

            // Read back zip entries using JSZip library
            const zipBytes = fs.readFileSync(outputZip)
            const zip = await JSZip.loadAsync(zipBytes)
            const entryNames = Object.keys(zip.files)

            // Verify structure:
            // / - <root>
            // /index.js - <entrypoint>
            // /package.json - <manifest>
            // /assets - <assets folder with all assets inside>
            expect(entryNames).toContain("index.js")
            expect(entryNames).toContain("package.json")
            expect(entryNames).toContain("assets/alert-template.txt")
            expect(entryNames).toContain("assets/nested/rules.json")
            expect(entryNames).toContain("assets/icon.png")

            // Verify file contents
            const indexContent = await zip.file("index.js")?.async("string")
            expect(indexContent).toBe('console.log("Hello from plugin");')

            const pkgContent = await zip.file("package.json")?.async("string")
            const parsedPkg = JSON.parse(pkgContent!)
            expect(parsedPkg.name).toBe("@fixture/plugin-c-fraud-detector")
            expect(parsedPkg.main).toBe("index.js")

            const alertContent = await zip.file("assets/alert-template.txt")?.async("string")
            expect(alertContent).toBe("[ALERT] suspicious activity on ${accountId}")
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    })

    it("runs via CLI runner function with flags", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-test-"))

        try {
            const entryFile = path.join(tempDir, "index.js")
            fs.writeFileSync(entryFile, 'export default {};')

            const pkgFile = path.join(tempDir, "package.json")
            fs.writeFileSync(pkgFile, JSON.stringify({
                name: "simple-plugin",
                version: "1.2.3"
            }))

            const assetsDir = path.join(tempDir, "assets")
            fs.mkdirSync(assetsDir, { recursive: true })
            fs.writeFileSync(path.join(assetsDir, "data.txt"), "sample data")

            const outputZip = path.join(tempDir, "out.zip")

            const exitCode = await run([
                "-e", entryFile,
                "-p", pkgFile,
                "-a", assetsDir,
                "-o", outputZip
            ])

            expect(exitCode).toBe(0)
            expect(fs.existsSync(outputZip)).toBe(true)

            const zipBytes = fs.readFileSync(outputZip)
            const zip = await JSZip.loadAsync(zipBytes)
            const names = Object.keys(zip.files)

            expect(names).toContain("index.js")
            expect(names).toContain("package.json")
            expect(names).toContain("assets/data.txt")
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    })
})
