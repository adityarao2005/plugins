import fs from "node:fs"
import path from "node:path"
import { ZipArchive } from "./zip"

export interface PackPluginOptions {
    entryPath: string
    packageJsonPath: string
    assetDirs?: string[]
    outputPath?: string
}

export interface PackResultFile {
    path: string
    size: number
}

export interface PackResult {
    outputPath: string
    name: string
    version: string
    fileCount: number
    totalBytes: number
    files: PackResultFile[]
}

export interface PackageManifest {
    name?: string
    version?: string
    description?: string
    main?: string
    [key: string]: unknown
}

function getAllFilesRecursively(dir: string, baseDir = dir): string[] {
    const results: string[] = []
    if (!fs.existsSync(dir)) return results

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            results.push(...getAllFilesRecursively(fullPath, baseDir))
        } else if (entry.isFile()) {
            results.push(fullPath)
        }
    }
    return results
}

export async function packPlugin(options: PackPluginOptions): Promise<PackResult> {
    const entryPath = path.resolve(options.entryPath)
    const packageJsonPath = path.resolve(options.packageJsonPath)

    // 1. Validate entry file
    if (!fs.existsSync(entryPath)) {
        throw new Error(`Entry file not found: ${entryPath}`)
    }
    const entryStat = fs.statSync(entryPath)
    if (!entryStat.isFile()) {
        throw new Error(`Entry path must be a file: ${entryPath}`)
    }
    const entryBytes = fs.readFileSync(entryPath)

    // 2. Validate and parse package.json
    if (!fs.existsSync(packageJsonPath)) {
        throw new Error(`package.json not found: ${packageJsonPath}`)
    }
    let pkgData: PackageManifest
    try {
        const rawPkg = fs.readFileSync(packageJsonPath, "utf-8")
        pkgData = JSON.parse(rawPkg) as PackageManifest
    } catch (err: any) {
        throw new Error(`Failed to parse package.json at ${packageJsonPath}: ${err.message}`)
    }

    const name = pkgData.name ?? "unnamed-plugin"
    const version = pkgData.version ?? "0.0.0"

    // Construct manifest for the plugin archive
    const manifest: PackageManifest = {
        name,
        version,
        main: "index.js",
        description: pkgData.description,
        ...pkgData
    }
    manifest.main = "index.js" // Ensure main always points to index.js in root
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2))

    // 3. Create ZIP archive
    const archive = new ZipArchive()
    const resultFiles: PackResultFile[] = []

    // Add /index.js
    archive.addFile("index.js", entryBytes)
    resultFiles.push({ path: "index.js", size: entryBytes.byteLength })

    // Add /package.json
    archive.addFile("package.json", manifestBytes)
    resultFiles.push({ path: "package.json", size: manifestBytes.byteLength })

    // 4. Gather assets from all asset directories
    const assetDirs = options.assetDirs ?? []
    const seenAssetPaths = new Set<string>()

    for (const assetDir of assetDirs) {
        const resolvedAssetDir = path.resolve(assetDir)
        if (!fs.existsSync(resolvedAssetDir)) {
            continue
        }

        const stat = fs.statSync(resolvedAssetDir)
        if (stat.isFile()) {
            // If an individual asset file was passed
            const fileName = path.basename(resolvedAssetDir)
            const zipPath = `assets/${fileName}`
            if (!seenAssetPaths.has(zipPath)) {
                seenAssetPaths.add(zipPath)
                const content = fs.readFileSync(resolvedAssetDir)
                archive.addFile(zipPath, content)
                resultFiles.push({ path: zipPath, size: content.byteLength })
            }
        } else if (stat.isDirectory()) {
            const files = getAllFilesRecursively(resolvedAssetDir)
            for (const file of files) {
                const relativePath = path.relative(resolvedAssetDir, file).replace(/\\/g, "/")
                const zipPath = `assets/${relativePath}`
                if (!seenAssetPaths.has(zipPath)) {
                    seenAssetPaths.add(zipPath)
                    const content = fs.readFileSync(file)
                    archive.addFile(zipPath, content)
                    resultFiles.push({ path: zipPath, size: content.byteLength })
                }
            }
        }
    }

    // 5. Determine output path
    const sanitizedName = name.replace(/[@/\\:]/g, "-").replace(/^-+/, "")
    const defaultOutputName = `${sanitizedName}-${version}.plugin`
    const outputPath = options.outputPath
        ? path.resolve(options.outputPath)
        : path.resolve(process.cwd(), defaultOutputName)

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
    }

    // 6. Build and write zip file
    const zipBytes = await archive.build()
    fs.writeFileSync(outputPath, zipBytes)

    return {
        outputPath,
        name,
        version,
        fileCount: resultFiles.length,
        totalBytes: zipBytes.byteLength,
        files: resultFiles
    }
}
