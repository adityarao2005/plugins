import { describe, expect, it } from "bun:test"
import path from "node:path"
import { PluginArchive } from "./archive"

describe("PluginArchive (.plugin parsing and asset traversal)", () => {
    const fixtureAPath = path.resolve(
        import.meta.dir,
        "../../../tests/fixtures/plugin-a-ledger/dist/plugin-a-ledger.plugin"
    )

    it("loads a real compiled .plugin fixture from the filesystem", async () => {
        const archive = await PluginArchive.load(fixtureAPath)

        expect(archive.manifest.name).toBe("@fixture/plugin-a-ledger")
        expect(archive.manifest.version).toBe("0.1.0")
        expect(typeof archive.bundleCode).toBe("string")
        expect(archive.bundleCode.length).toBeGreaterThan(0)
    })

    it("lists assets contained inside the plugin", async () => {
        const archive = await PluginArchive.load(fixtureAPath)
        const assets = archive.listAssets()

        expect(assets).toContain("default-rates.json")
    })

    it("reads asset content as json, text, bytes, and arrayBuffer", async () => {
        const archive = await PluginArchive.load(fixtureAPath)
        const asset = archive.getAsset("default-rates.json")

        expect(asset).toBeDefined()
        expect(asset?.path).toBe("default-rates.json")
        expect(asset?.size).toBeGreaterThan(0)

        // Read text
        const text = await asset?.text()
        expect(text).toContain("USD")

        // Read json
        const data = await asset?.json<{ currency: string; baseRate: number }>()
        expect(data?.currency).toBe("USD")
        expect(data?.baseRate).toBe(0.05)

        // Read bytes
        const bytes = await asset?.bytes()
        expect(bytes instanceof Uint8Array).toBe(true)
        expect(bytes?.byteLength).toBe(asset!.size)

        // Read arrayBuffer
        const buffer = await asset?.arrayBuffer()
        expect(buffer instanceof ArrayBuffer).toBe(true)
        expect(buffer?.byteLength).toBe(asset!.size)

        // Read stream
        const stream = asset?.stream()
        expect(stream).toBeDefined()
        const reader = stream!.getReader()
        const { value, done } = await reader.read()
        expect(done).toBe(false)
        expect(value instanceof Uint8Array).toBe(true)
    })

    it("supports normalized paths with and without 'assets/' prefix", async () => {
        const archive = await PluginArchive.load(fixtureAPath)

        expect(archive.hasAsset("default-rates.json")).toBe(true)
        expect(archive.hasAsset("assets/default-rates.json")).toBe(true)

        const asset1 = archive.getAsset("default-rates.json")
        const asset2 = archive.getAsset("assets/default-rates.json")

        expect(asset1).toBeDefined()
        expect(asset2).toBeDefined()
        expect(await asset1?.text()).toEqual(await asset2?.text())
    })

    it("returns undefined for non-existent assets", async () => {
        const archive = await PluginArchive.load(fixtureAPath)
        expect(archive.hasAsset("non-existent.png")).toBe(false)
        expect(archive.getAsset("non-existent.png")).toBeUndefined()
    })
})
