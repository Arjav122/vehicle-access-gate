// Snapshot storage (brief §10.8). Keys look like 2026/11/25/<eventId>.jpg.
// Phase 2 implements the local folder (a Docker volume in production). The S3-compatible
// option arrives with deployment in Phase 8 (docs/decisions.md D15); config refuses "s3" until then.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export interface ImageType {
  ext: "jpg" | "png" | "webp";
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

/**
 * Recognise an image by its first bytes ("magic bytes"), not by the file name or the
 * Content-Type the client claims, which are both easy to fake.
 */
export function detectImageType(data: Buffer): ImageType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= 8 && png.every((b, i) => data[i] === b))
    return { ext: "png", contentType: "image/png" };
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

const KEY = /^\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** `<yyyy>/<mm>/<dd>/<eventId>.<ext>`, dated by when the camera captured it (UTC). */
export function snapshotKey(eventId: string, capturedAt: Date, ext: ImageType["ext"]): string {
  const d = capturedAt.toISOString();
  return `${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/${eventId}.${ext}`;
}

export function contentTypeOf(key: string): ImageType["contentType"] {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/** Absolute file path for a key. Rejects anything that is not a well-formed key (no "../"). */
function fileFor(key: string): string {
  if (!KEY.test(key)) throw new Error(`Invalid snapshot key: ${key}`);
  return path.resolve(config.SNAPSHOT_LOCAL_DIR, ...key.split("/"));
}

export async function saveSnapshot(key: string, data: Buffer): Promise<void> {
  const file = fileFor(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

/** The bytes, or null if the file is gone (e.g. removed by retention). */
export async function loadSnapshot(key: string): Promise<Buffer | null> {
  try {
    return await readFile(fileFor(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteSnapshot(key: string): Promise<void> {
  await rm(fileFor(key), { force: true });
}
