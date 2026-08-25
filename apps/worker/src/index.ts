import { Hono } from "hono";

import { createApi, type WorkerHonoEnv } from "./api";
import { authenticateRequest } from "./auth";
import { publicNotFound } from "./http";
import { servePublic } from "./serve";
import type { Authenticate, Env } from "./types";

export function createApp(
    authenticate: Authenticate = authenticateRequest,
): Hono<WorkerHonoEnv> {
    const app = new Hono<WorkerHonoEnv>();

    app.route("/api", createApi(authenticate));
    app.all("/p/*", (context) => servePublic(context.req.raw, context.env));
    app.notFound(publicNotFound);

    return app;
}

export async function handleRequest(
    request: Request,
    env: Env,
    authenticate: Authenticate = authenticateRequest,
): Promise<Response> {
    return createApp(authenticate).fetch(request, env);
}

export default createApp();
