import AdmZip from 'adm-zip';
import path from 'node:path';

export class ZipExtractionError extends Error {}

/**
 * Extracts a .zip archive into `targetDir`, refusing entries that would escape
 * the target directory (zip-slip protection).
 */
export function extractZip(zipFile: string, targetDir: string): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipFile);
  } catch (err) {
    throw new ZipExtractionError(`Cannot read zip archive ${zipFile}: ${(err as Error).message}`);
  }
  const resolvedTarget = path.resolve(targetDir);
  for (const entry of zip.getEntries()) {
    const destination = path.resolve(resolvedTarget, entry.entryName);
    if (destination !== resolvedTarget && !destination.startsWith(resolvedTarget + path.sep)) {
      throw new ZipExtractionError(
        `Zip entry "${entry.entryName}" escapes the extraction directory (zip-slip)`,
      );
    }
  }
  zip.extractAllTo(resolvedTarget, /* overwrite */ true);
}
