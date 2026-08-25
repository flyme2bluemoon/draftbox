import { userResponseSchema } from "@draftbox/contracts";
import { Hono } from "hono";

import {
    addVersion,
    createArtifact,
    deleteArtifact,
    deleteVersion,
    editArtifact,
    listArtifacts,
    listVersions,
    rotateLink,
} from "./artifacts";
import { ApiError, apiErrorResponse, jsonResponse } from "./http";
import type { Authenticate, AuthenticatedUser, Env } from "./types";

export interface WorkerHonoEnv {
    Bindings: Env;
    Variables: {
        user: AuthenticatedUser;
    };
}

function endpointNotFound(): never {
    throw new ApiError(404, "not_found", "Endpoint not found.");
}

export function createApi(authenticate: Authenticate): Hono<WorkerHonoEnv> {
    const api = new Hono<WorkerHonoEnv>();

    api.onError((error) => apiErrorResponse(error));
    api.use("*", async (context, next) => {
        const user = await authenticate(context.req.raw, context.env);
        context.set("user", user);

        if (context.req.raw.method === "HEAD") {
            return endpointNotFound();
        }

        await next();
    });

    api.get("/whoami", (context) =>
        jsonResponse(userResponseSchema, { user: context.var.user }));

    api.get("/artifacts", (context) =>
        listArtifacts(context.req.raw, context.env, context.var.user));
    api.post("/artifacts", (context) =>
        createArtifact(context.req.raw, context.env, context.var.user));

    api.get("/artifacts/:artifactId/versions", (context) =>
        listVersions(
            context.req.raw,
            context.env,
            context.var.user,
            context.req.param("artifactId"),
        ));
    api.post("/artifacts/:artifactId/versions", (context) =>
        addVersion(
            context.req.raw,
            context.env,
            context.var.user,
            context.req.param("artifactId"),
        ));

    api.patch("/artifacts/:artifactId", (context) =>
        editArtifact(
            context.req.raw,
            context.env,
            context.var.user,
            context.req.param("artifactId"),
        ));
    api.delete("/artifacts/:artifactId", (context) =>
        deleteArtifact(
            context.env,
            context.var.user,
            context.req.param("artifactId"),
        ));

    api.post("/artifacts/:artifactId/rotate-link", (context) =>
        rotateLink(
            context.req.raw,
            context.env,
            context.var.user,
            context.req.param("artifactId"),
        ));

    api.delete("/artifacts/:artifactId/versions/:version", (context) => {
        const version = context.req.param("version");
        if (!/^[1-9]\d*$/.test(version)) {
            return endpointNotFound();
        }

        return deleteVersion(
            context.env,
            context.var.user,
            context.req.param("artifactId"),
            Number(version),
        );
    });

    api.all("*", endpointNotFound);

    return api;
}
