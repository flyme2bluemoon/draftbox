import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliDir = path.join(root, "packages/cli");
const bump = process.argv[2];

if (!["patch", "minor", "major"].includes(bump)) {
    console.error("Usage: pnpm release:<patch|minor|major>");
    process.exit(1);
}

function run(command, args, cwd = root) {
    const result = spawnSync(command, args, { cwd, stdio: "inherit" });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
});
if (status.status !== 0) {
    process.exit(status.status ?? 1);
}
if (status.stdout.trim() !== "") {
    console.error("Working tree is dirty. Commit or stash first.");
    process.exit(1);
}

run("npm", ["version", bump, "-m", "release %s"], cliDir);
run("git", ["push", "--follow-tags"]);
