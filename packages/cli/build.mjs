import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

await rm("dist", { recursive: true, force: true });

const contractsEntry = fileURLToPath(
    new URL("../contracts/src/index.ts", import.meta.url),
);

await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: "dist/index.js",
    // Keep public registry deps external. Bundle private workspace code
    // (@draftbox/contracts) and its transitive deps (zod) into the binary.
    external: ["commander"],
    alias: {
        "@draftbox/contracts": contractsEntry,
    },
    sourcemap: true,
    logLevel: "info",
});
