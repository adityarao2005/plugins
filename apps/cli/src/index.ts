#!/usr/bin/env bun
import fs from "node:fs"
import path from "node:path"
import { packPlugin, type PackPluginOptions } from "./packer"

function printHelp(): void {
    console.log(`
Plugin Packager CLI

Packages a bundled plugin into a standardized distribution zip.

Zip Structure:
  /index.js      <entrypoint>
  /package.json  <manifest>
  /assets/       <assets directory containing all assets>

Usage:
  repo-cli [pack] [directory] [options]

Options:
  -e, --entry <path>        Path to bundled index.js
  -p, --package <path>      Path to package.json manifest
  -a, --assets <paths...>   Path to asset directory (can be specified multiple times)
  -o, --out <path>          Output .zip path (default: <name>-<version>.zip)
  -h, --help                Show this help message

Examples:
  # Using explicit paths:
  repo-cli -e ./dist/index.js -p ./package.json -a ./assets -o ./my-plugin.zip

  # Using a package directory:
  repo-cli pack ./packages/my-plugin -e ./dist/index.js -a ./assets -a ./static

  # Multiple asset folders:
  repo-cli -e ./dist/index.js -p ./package.json -a ./assets -a ./locales -a ./icons
`)
}

interface ParsedArgs {
    command?: string
    targetDir?: string
    entryPath?: string
    packageJsonPath?: string
    assetDirs: string[]
    outputPath?: string
    help: boolean
}

function parseArgs(args: string[]): ParsedArgs {
    const result: ParsedArgs = {
        assetDirs: [],
        help: false
    }

    let i = 0
    while (i < args.length) {
        const arg = args[i]!

        if (arg === "-h" || arg === "--help" || arg === "help") {
            result.help = true
            i++
        } else if (arg === "-e" || arg === "--entry") {
            i++
            if (i < args.length) result.entryPath = args[i]
            i++
        } else if (arg === "-p" || arg === "--package") {
            i++
            if (i < args.length) result.packageJsonPath = args[i]
            i++
        } else if (arg === "-a" || arg === "--assets" || arg === "--asset") {
            i++
            while (i < args.length && !args[i]!.startsWith("-")) {
                const parts = args[i]!.split(",")
                for (const part of parts) {
                    const trimmed = part.trim()
                    if (trimmed) result.assetDirs.push(trimmed)
                }
                i++
            }
        } else if (arg === "-o" || arg === "--out" || arg === "--output") {
            i++
            if (i < args.length) result.outputPath = args[i]
            i++
        } else if (arg === "pack") {
            result.command = "pack"
            i++
        } else if (!arg.startsWith("-") && !result.targetDir) {
            result.targetDir = arg
            i++
        } else {
            i++
        }
    }

    return result
}

export async function run(argv = process.argv.slice(2)): Promise<number> {
    const parsed = parseArgs(argv)

    if (parsed.help) {
        printHelp()
        return 0
    }

    const baseDir = parsed.targetDir ? path.resolve(parsed.targetDir) : process.cwd()

    // Determine package.json path
    let packageJsonPath = parsed.packageJsonPath
    if (!packageJsonPath) {
        const candidateInBase = path.join(baseDir, "package.json")
        if (fs.existsSync(candidateInBase)) {
            packageJsonPath = candidateInBase
        } else {
            const candidateInCwd = path.join(process.cwd(), "package.json")
            if (fs.existsSync(candidateInCwd)) {
                packageJsonPath = candidateInCwd
            }
        }
    }

    if (!packageJsonPath) {
        console.error("Error: package.json path is required. Use -p <path> or specify a directory containing package.json.")
        return 1
    }

    // Determine entry path
    let entryPath = parsed.entryPath
    if (!entryPath) {
        const candidates = [
            path.join(baseDir, "dist", "index.js"),
            path.join(baseDir, "index.js"),
            path.join(process.cwd(), "dist", "index.js"),
            path.join(process.cwd(), "index.js")
        ]
        for (const cand of candidates) {
            if (fs.existsSync(cand)) {
                entryPath = cand
                break
            }
        }
    }

    if (!entryPath) {
        console.error("Error: Entry file (index.js) not found. Use -e <path> to specify the bundled index.js.")
        return 1
    }

    // Determine asset directories
    const assetDirs = [...parsed.assetDirs]
    if (assetDirs.length === 0) {
        const defaultAssetDir = path.join(baseDir, "assets")
        if (fs.existsSync(defaultAssetDir)) {
            assetDirs.push(defaultAssetDir)
        }
    }

    const options: PackPluginOptions = {
        entryPath,
        packageJsonPath,
        assetDirs,
        outputPath: parsed.outputPath
    }

    console.log("Packaging plugin...")
    console.log(`  Entry:    ${path.relative(process.cwd(), path.resolve(entryPath))}`)
    console.log(`  Manifest: ${path.relative(process.cwd(), path.resolve(packageJsonPath))}`)
    if (assetDirs.length > 0) {
        console.log(`  Assets:   ${assetDirs.map(d => path.relative(process.cwd(), path.resolve(d))).join(", ")}`)
    } else {
        console.log(`  Assets:   (none)`)
    }

    try {
        const result = await packPlugin(options)

        console.log(`\nSuccessfully created plugin bundle!`)
        console.log(`  Plugin:   ${result.name}@${result.version}`)
        console.log(`  Output:   ${path.relative(process.cwd(), result.outputPath)} (${(result.totalBytes / 1024).toFixed(2)} KB)`)
        console.log(`\nArchive Contents (${result.fileCount} files):`)
        for (const file of result.files) {
            console.log(`  - /${file.path} (${file.size} bytes)`)
        }

        return 0
    } catch (err: any) {
        console.error(`\nError packaging plugin: ${err.message}`)
        return 1
    }
}

// Auto-run if executed directly as a script
if (import.meta.main || (typeof require !== "undefined" && require.main === module)) {
    run().then((code) => {
        if (code !== 0) {
            process.exit(code)
        }
    }).catch((err) => {
        console.error("Unexpected error:", err)
        process.exit(1)
    })
}
