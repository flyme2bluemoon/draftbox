# Draftbox

Draftbox is a small Cloudflare-hosted service for uploading, versioning, and sharing single-file HTML artifacts. Management happens through a TypeScript CLI; public pages need only an unguessable link.

The implementation consists of:

- one Cloudflare Worker for the authenticated `/api/*` routes and public `/p/*` routes;
- D1 for ownership, artifact metadata, version records, and share secrets;
- R2 for uploaded bytes;
- WorkOS AuthKit and a public WorkOS Connect OAuth application for CLI device authentication;
- a shared `@draftbox/contracts` package for API schemas and inferred TypeScript types; and
- a Commander-based CLI published as the `draftbox` package.

## Development

Requirements: Node.js 22.11 or newer and pnpm.

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

The Worker integration tests run against local D1 and R2 instances in Cloudflare's Workers runtime. They do not use hosted resources.

To run the CLI from a checkout:

```sh
pnpm --filter draftbox build
node packages/cli/dist/index.js --help
```

## WorkOS setup

1. Create an AuthKit environment and configure its hosted domain.
2. In Authentication settings, turn off **Sign up**. Invite users from **Users → Invites** in the WorkOS dashboard.
3. Under Connect, create a first-party OAuth application for the CLI and configure it as a **Public** application. Record its client ID. No client secret belongs in the CLI.
4. Ensure the application can request `openid profile email offline_access`.
5. Confirm that `apps/worker/wrangler.jsonc` contains the access-token audience, public OAuth client ID, and URLs from the same WorkOS environment. The audience is the access token's `aud` claim. It is not necessarily the OAuth application's client ID.

```json
{
    "WORKOS_AUDIENCE": "client_api_...",
    "WORKOS_CLIENT_ID": "client_oauth_...",
    "WORKOS_ISSUER": "https://your-domain.authkit.app",
    "WORKOS_JWKS_URL": "https://your-domain.authkit.app/oauth2/jwks"
}
```

The CLI uses WorkOS's standard device authorization and token endpoints directly. The WorkOS Node SDK is useful for secret-bearing server integrations, but it does not simplify this public OAuth client enough to justify shipping it. The Worker uses `jose` for verified JWT parsing rather than implementing cryptography itself.

## Cloudflare setup and deployment

Create the resources from `apps/worker`:

```sh
pnpm exec wrangler d1 create draftbox
pnpm exec wrangler r2 bucket create draftbox-artifacts
```

Copy the returned D1 database ID into `apps/worker/wrangler.jsonc`, then apply the migration and deploy:

```sh
pnpm exec wrangler d1 migrations apply draftbox --remote
pnpm exec wrangler deploy
```

After the first deployment, put the assigned `workers.dev` URL into `packages/cli/src/config.ts` before publishing the CLI. `@draftbox/contracts` stays private; the CLI build bundles it into `draftbox` so installs do not need that package on the registry.

```sh
pnpm --filter draftbox pack
pnpm --filter draftbox publish
```

For local development or a different deployment, override the source defaults with environment variables:

```sh
export DRAFTBOX_API_URL="https://draftbox.example.workers.dev"
export DRAFTBOX_WORKOS_AUTHKIT_URL="https://your-domain.authkit.app"
export DRAFTBOX_WORKOS_CLIENT_ID="client_..."
```

Then authenticate and upload:

```sh
pnpx draftbox login
pnpx draftbox upload ./page.html
pnpx draftbox list
```

Uploading the same canonical file path from the same machine again adds a new version to its existing artifact. Use `--artifact` to add a file as a version of a different artifact.

Credentials are stored in `${XDG_CONFIG_HOME:-~/.config}/draftbox/credentials.json` with owner-only permissions. Set `DRAFTBOX_CONFIG_DIR` to change that directory.

## CLI commands

```text
draftbox login
draftbox logout
draftbox whoami
draftbox upload <file> [--name <filename>] [--description <text>]
draftbox upload <file> --artifact <artifact-id>
draftbox list
draftbox versions <artifact-id>
draftbox edit <artifact-id> [--name <filename>] [--description <text>]
draftbox rotate-link <artifact-id>
draftbox delete <artifact-id> [--version <number>] [--yes]
```

Deletion is permanent and prompts unless `--yes` is supplied. Uploading a version, including one detected from the same machine and canonical file path, never changes artifact metadata. Use `edit` separately.
