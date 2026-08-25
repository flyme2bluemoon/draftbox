#!/usr/bin/env node

import { createInterface } from "node:readline/promises";

import { Command, InvalidArgumentError } from "commander";

import packageJson from "../package.json" with { type: "json" };
import { DraftboxApi, type Artifact, type Version } from "./api.js";
import { login, logout } from "./auth.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const api = new DraftboxApi(config);

function formatBytes(bytes: number): string {
    if (bytes < 1_024) {
        return `${bytes} B`;
    }
    if (bytes < 1_024 * 1_024) {
        return `${(bytes / 1_024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}

function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}\u2026`;
}

const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return timestamp;
    }
    const day = String(date.getDate()).padStart(2, "0");
    const month = MONTHS[date.getMonth()]!;
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day} ${month} ${date.getFullYear()} ${hours}:${minutes}`;
}

function printRows(rows: string[][]): void {
    const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
    for (const row of rows) {
        const line = row
            .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!)))
            .join("  ");
        console.log(line.trimEnd());
    }
}

function printArtifact(artifact: Artifact): void {
    console.log(`ID:          ${artifact.id}`);
    console.log(`Name:        ${artifact.filename}`);
    console.log(`Description: ${artifact.description || "-"}`);
    console.log(`Current:     v${artifact.currentVersion}`);
    console.log(`Link:        ${artifact.url}`);
    console.log(`Created:     ${artifact.createdAt}`);
    console.log(`Updated:     ${artifact.updatedAt}`);
}

function printVersion(version: Version): void {
    console.log(`Version: v${version.version}`);
    console.log(`Size:    ${formatBytes(version.size)}`);
    console.log(`Hash:    ${version.contentHash}`);
    console.log(`Created: ${version.createdAt}`);
    console.log(`Link:    ${version.url}`);
}

function parseVersion(value: string): number {
    if (!/^[1-9]\d*$/.test(value)) {
        throw new InvalidArgumentError("Version must be a positive integer");
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new InvalidArgumentError("Version is too large");
    }
    return parsed;
}

async function confirmDeletion(message: string): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("Deletion requires an interactive terminal or --yes");
    }

    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await prompt.question(`${message} [y/N] `);
        if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") {
            throw new Error("Deletion cancelled");
        }
    } finally {
        prompt.close();
    }
}

export function createProgram(): Command {
    const program = new Command()
        .name("draftbox")
        .description("Upload and manage HTML artifacts on Draftbox")
        .version(packageJson.version)
        .enablePositionalOptions();

    program.command("login")
        .description("Sign in with WorkOS AuthKit")
        .action(async () => {
            await login(config);
        });

    program.command("logout")
        .description("Remove the saved Draftbox session")
        .action(logout);

    program.command("whoami")
        .description("Show the signed-in user")
        .action(async () => {
            const { user } = await api.whoami();
            console.log(user.email === null ? user.id : `${user.email} (${user.id})`);
        });

    program.command("upload")
        .description("Create an artifact or add a version")
        .argument("<file>", "HTML file to upload")
        .option("--artifact <artifact-id>", "add a version to an existing artifact")
        .option("--name <filename>", "artifact filename")
        .option("--description <description>", "artifact description")
        .action(async (
            file: string,
            options: { artifact?: string; name?: string; description?: string },
        ) => {
            const result = await api.upload(file, {
                ...(options.artifact === undefined ? {} : { artifactId: options.artifact }),
                ...(options.name === undefined ? {} : { filename: options.name }),
                ...(options.description === undefined
                    ? {}
                    : { description: options.description }),
            });
            printArtifact(result.artifact);
            console.log("");
            printVersion(result.version);
        });

    program.command("list")
        .description("List your artifacts")
        .action(async () => {
            const { artifacts } = await api.listArtifacts();
            if (artifacts.length === 0) {
                console.log("No artifacts.");
                return;
            }
            printRows([
                ["NAME", "VER", "UPDATED", "ID"],
                ...artifacts.map((artifact) => [
                    truncate(artifact.filename, 40),
                    `v${artifact.currentVersion}`,
                    formatTimestamp(artifact.updatedAt),
                    artifact.id,
                ]),
            ]);
            console.log("");
            console.log("Details and links: draftbox versions <id>");
        });

    program.command("versions")
        .description("List an artifact's surviving versions")
        .argument("<artifact-id>")
        .action(async (artifactId: string) => {
            const { artifact, versions } = await api.listVersions(artifactId);
            console.log(`${artifact.filename} (${artifact.id}), current v${artifact.currentVersion}`);
            printRows([
                ["VERSION", "SIZE", "CREATED", "LINK"],
                ...versions.map((version) => [
                    `v${version.version}`,
                    formatBytes(version.size),
                    formatTimestamp(version.createdAt),
                    version.url,
                ]),
            ]);
        });

    program.command("edit")
        .description("Edit artifact metadata")
        .argument("<artifact-id>")
        .option("--name <filename>", "new filename")
        .option("--description <description>", "new description")
        .action(async (
            artifactId: string,
            options: { name?: string; description?: string },
        ) => {
            if (options.name === undefined && options.description === undefined) {
                throw new Error("Provide --name or --description");
            }
            const { artifact } = await api.edit(artifactId, {
                ...(options.name === undefined ? {} : { filename: options.name }),
                ...(options.description === undefined
                    ? {}
                    : { description: options.description }),
            });
            printArtifact(artifact);
        });

    program.command("rotate-link")
        .description("Replace an artifact's public share secret")
        .argument("<artifact-id>")
        .action(async (artifactId: string) => {
            const { artifact } = await api.rotateLink(artifactId);
            console.log(`New link: ${artifact.url}`);
        });

    program.command("delete")
        .description("Permanently delete an artifact or version")
        .argument("<artifact-id>")
        .option("--version <number>", "delete one version", parseVersion)
        .option("--yes", "skip the confirmation prompt")
        .action(async (
            artifactId: string,
            options: { version?: number; yes?: boolean },
        ) => {
            const target = options.version === undefined
                ? `artifact ${artifactId} and all of its versions`
                : `version v${options.version} of artifact ${artifactId}`;
            if (options.yes !== true) {
                await confirmDeletion(`Permanently delete ${target}?`);
            }
            if (options.version === undefined) {
                await api.deleteArtifact(artifactId);
            } else {
                await api.deleteVersion(artifactId, options.version);
            }
            console.log(`Deleted ${target}.`);
        });

    return program;
}

async function main(): Promise<void> {
    await createProgram().parseAsync(process.argv);
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "An unexpected error occurred");
    process.exitCode = 1;
});
