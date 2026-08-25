import {
    apiErrorResponseSchema,
    type ApiErrorCode,
    type ContractSchema,
} from "@draftbox/contracts";

export class ApiError extends Error {
    readonly status: number;
    readonly code: ApiErrorCode;

    constructor(status: number, code: ApiErrorCode, message: string) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

export function jsonResponse<T>(
    schema: ContractSchema<T>,
    value: T,
    init: ResponseInit = {},
): Response {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "no-store");

    return new Response(JSON.stringify(schema.parse(value)), {
        ...init,
        headers,
    });
}

export function apiErrorResponse(error: unknown): Response {
    if (error instanceof ApiError) {
        return jsonResponse(
            apiErrorResponseSchema,
            {
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            { status: error.status },
        );
    }

    console.error(error);
    return jsonResponse(
        apiErrorResponseSchema,
        {
            error: {
                code: "internal_error",
                message: "An unexpected error occurred.",
            },
        },
        { status: 500 },
    );
}

export function publicNotFound(): Response {
    return new Response("Not Found", {
        status: 404,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
    });
}
