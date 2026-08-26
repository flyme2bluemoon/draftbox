import { ApiError } from "./http";
import type { Env } from "./types";

// Free-tier numbers from Cloudflare docs:
// https://developers.cloudflare.com/r2/pricing/
// https://developers.cloudflare.com/d1/platform/pricing/
// https://developers.cloudflare.com/d1/platform/limits/
export const R2_FREE_STORAGE_BYTES = 10 * 1_000 * 1_000 * 1_000;
export const R2_FREE_CLASS_A_PER_MONTH = 1_000_000;
export const D1_FREE_DATABASE_BYTES = 500 * 1_000 * 1_000;
export const D1_UPLOAD_OVERHEAD_BYTES = 4_096;

export const R2_CLASS_A_METRIC = "r2_class_a";

interface QuotaUsageRow {
    r2_storage_bytes: number;
    d1_bytes: number;
}

function errorText(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }

    const cause = error.cause instanceof Error ? error.cause.message : "";
    return `${error.message}\n${cause}`;
}

export function utcMonthPeriod(now = new Date()): string {
    return now.toISOString().slice(0, 7);
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

async function readUsage(env: Env): Promise<QuotaUsageRow> {
    const result = await env.DB.prepare(
        "SELECT COALESCE(SUM(byte_size), 0) AS r2_storage_bytes FROM versions",
    ).all<{ r2_storage_bytes: number }>();
    const usage = {
        r2_storage_bytes: Number(result.results[0]?.r2_storage_bytes),
        d1_bytes: Number(result.meta.size_after),
    };
    if (!Number.isFinite(usage.r2_storage_bytes) || !Number.isFinite(usage.d1_bytes)) {
        throw new Error("Failed to read storage usage.");
    }

    return usage;
}

export async function reserveUploadQuota(env: Env, uploadBytes: number): Promise<void> {
    const month = utcMonthPeriod();
    const usage = await readUsage(env);

    if (usage.r2_storage_bytes + uploadBytes > R2_FREE_STORAGE_BYTES) {
        throw new ApiError(
            507,
            "quota_exceeded",
            "R2 storage would exceed the Cloudflare free-tier allowance of 10 GB.",
        );
    }

    if (usage.d1_bytes + D1_UPLOAD_OVERHEAD_BYTES > D1_FREE_DATABASE_BYTES) {
        throw new ApiError(
            507,
            "quota_exceeded",
            "D1 storage would exceed the Cloudflare free-tier database size of 500 MB.",
        );
    }

    const reserved = await env.DB.prepare(
        `INSERT INTO usage_counters (period, metric, value)
         VALUES (?, ?, 1)
         ON CONFLICT(period, metric) DO UPDATE SET
            value = value + 1
         WHERE usage_counters.value < ?
         RETURNING value`,
    )
        .bind(month, R2_CLASS_A_METRIC, R2_FREE_CLASS_A_PER_MONTH)
        .first<{ value: number }>();

    if (reserved === null) {
        throw new ApiError(
            429,
            "quota_exceeded",
            "R2 Class A operations would exceed the Cloudflare free-tier allowance of 1 million per month.",
        );
    }
}
