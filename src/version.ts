import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The repository root, resolved from this file rather than from cwd. */
export const ROOT: string = join(here, "..");

/**
 * The published set. Every served file is read from inside this directory and
 * nowhere else, so containment is a property of the constant rather than of
 * what a caller passed in.
 */
export const CONTENT_DIR: string = join(ROOT, "content");

/** The fields of `package.json` this server reads. */
interface PackageManifest {
  version: string;
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageManifest;

export const VERSION: string = pkg.version;
export const SERVER_NAME: string = "lxagents-shared-instruction";
