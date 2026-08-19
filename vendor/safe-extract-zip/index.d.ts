export interface SafeExtractZipOptions {
  dir: string;
  onEntry?: (entry: unknown, zipFile: unknown) => void | Promise<void>;
}

declare function safeExtractZip(zipPath: string, options: SafeExtractZipOptions): Promise<void>;

export = safeExtractZip;
