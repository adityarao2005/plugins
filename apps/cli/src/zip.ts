import JSZip from "jszip"

export interface ZipFileInfo {
    name: string
    size: number
}

export class ZipArchive {
    private zip = new JSZip()
    private files: ZipFileInfo[] = []

    addFile(name: string, data: Uint8Array | string): void {
        const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "")
        this.zip.file(normalized, data)
        const size = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength
        this.files.push({ name: normalized, size })
    }

    getFiles(): ReadonlyArray<ZipFileInfo> {
        return this.files
    }

    async build(): Promise<Uint8Array> {
        return await this.zip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
            compressionOptions: {
                level: 9
            }
        })
    }

    static async load(data: Uint8Array): Promise<JSZip> {
        return await JSZip.loadAsync(data)
    }
}
