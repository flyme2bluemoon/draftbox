import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist");

const contractsEntry = fileURLToPath(
    new URL("../contracts/src/index.ts", import.meta.url),
);
const license = fileURLToPath(new URL("../../LICENSE", import.meta.url));
await copyFile(license, "dist/LICENSE");

await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: "dist/index.js",
    external: ["commander"],
    alias: {
        "@draftbox/contracts": contractsEntry,
    },
    sourcemap: true,
    logLevel: "info",
});
