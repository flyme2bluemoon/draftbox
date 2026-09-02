import { ApiError } from "./http";
import type { Env } from "./types";

// Cloudflare's R2 free allowance is 10 GB-month. Cap below that so object
// metadata and concurrent uploads cannot bill.
// https://developers.cloudflare.com/r2/pricing/
export const R2_FREE_STORAGE_BYTES = 9_000_000_000;

function errorText(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }

    const cause = error.cause instanceof Error ? error.cause.message : "";
    return `${error.message}\n${cause}`;
}

export function isD1FreeTierError(error: unknown): boolean {
    return d1FreeTierApiError(error) !== undefined;
}

export function d1FreeTierApiError(error: unknown): ApiError | undefined {
    const text = errorText(error);
    if (text.includes("exceeded D1's free tier daily row read limit")) {
        return new ApiError(
            429,
            "quota_exceeded",
            "D1 daily row reads would exceed the Cloudflare free-tier allowance of 5 million.",
        );
    }
    if (text.includes("exceeded D1's free tier daily row write limit")) {
        return new ApiError(
            429,
            "quota_exceeded",
            "D1 daily row writes would exceed the Cloudflare free-tier allowance of 100,000.",
        );
    }
    if (
        text.includes("exceeded D1's maximum account storage limit") ||
        text.includes("Exceeded maximum DB size")
    ) {
        return new ApiError(
            507,
            "quota_exceeded",
            "D1 storage would exceed the Cloudflare free-tier database size of 500 MB.",
        );
    }

    return undefined;
}

export async function assertUploadFitsStorage(env: Env, uploadBytes: number): Promise<void> {
    const row = await env.DB.prepare(
        "SELECT COALESCE(SUM(byte_size), 0) AS r2_storage_bytes FROM versions",
    ).first<{ r2_storage_bytes: number }>();
    const storedBytes = Number(row?.r2_storage_bytes);
    if (!Number.isFinite(storedBytes)) {
        throw new Error("Failed to read storage usage.");
    }

    if (storedBytes + uploadBytes > R2_FREE_STORAGE_BYTES) {
        throw new ApiError(
            507,
            "quota_exceeded",
            "R2 storage would exceed the 9 GB free-tier cap.",
        );
    }
}
