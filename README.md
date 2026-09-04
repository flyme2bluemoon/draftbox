# Draftbox

Draftbox uploads, versions, and shares single-file HTML pages on Cloudflare. You manage artifacts with a TypeScript CLI. Anyone with the link can open a page; the link is hard to guess, not password-gated.

Stack:

- one Cloudflare Worker for authenticated `/api/*` routes and public `/p/*` routes
- D1 for ownership, artifact metadata, versions, and share secrets
- R2 for uploaded bytes
- WorkOS AuthKit plus a public WorkOS Connect OAuth app for CLI device login
- `@draftbox/contracts` for API schemas and the TypeScript types inferred from them
- a Commander CLI published as the `draftbox` package

## Development

Requirements: Node.js 22.11 or newer and pnpm.

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

Worker integration tests use local D1 and R2 inside Cloudflare's Workers runtime. They never touch hosted resources.

Run the CLI from a checkout:

```sh
pnpm --filter draftbox build
node packages/cli/dist/index.js --help
```

## WorkOS setup

1. Create an AuthKit environment and configure its hosted domain.
2. In Authentication settings, turn off **Sign up**. Invite users from **Users → Invites** in the WorkOS dashboard.
3. Under Connect, create a first-party OAuth application for the CLI. Make it a **Public** application. Save the client ID. The CLI must not hold a client secret.
4. Allow the scopes `openid profile email offline_access`.
5. Put the access-token audience and AuthKit URLs from that same WorkOS environment into `apps/worker/wrangler.jsonc`. The audience is the access token's `aud` claim, not the CLI OAuth app's client ID. Put the client ID in CLI config or `DRAFTBOX_WORKOS_CLIENT_ID`.

```json
{
  "WORKOS_AUDIENCE": "client_api_...",
  "WORKOS_ISSUER": "https://your-domain.authkit.app",
  "WORKOS_JWKS_URL": "https://your-domain.authkit.app/oauth2/jwks"
}
```

The CLI talks to WorkOS's device authorization and token endpoints directly. The Worker verifies JWTs with `jose`.

## Cloudflare setup and deployment

From `apps/worker`, create the resources:

```sh
pnpm exec wrangler d1 create draftbox
pnpm exec wrangler r2 bucket create draftbox-artifacts
```

Paste the D1 database ID into `apps/worker/wrangler.jsonc`, then migrate and deploy:

```sh
pnpm exec wrangler d1 migrations apply draftbox --remote
pnpm run deploy
```

`pnpm run deploy` builds `@draftbox/contracts` first. Wrangler loads that package from `dist/index.js`. A bare `wrangler deploy` fails until contracts are built.

### Workers Builds (Git integration)

If the Worker is wired to this repo in the Cloudflare dashboard, set the root directory to `apps/worker` and:

| Setting        | Command                     |
| -------------- | --------------------------- |
| Build command  | `pnpm run build:deps`       |
| Deploy command | `pnpm exec wrangler deploy` |

Or set the deploy command to `pnpm run deploy` and leave the build command empty. Either way, contracts must exist before Wrangler runs.

The Worker refuses uploads that would take stored artifact bytes over 9 GB, leaving 1 GB of headroom under Cloudflare's 10 GB R2 free allowance. Deleting artifacts or versions still works so stored usage can be reduced. Cloudflare itself blocks D1 once daily row limits are hit; the API returns `quota_exceeded` for those errors.

After the first deploy, put the assigned `workers.dev` URL into `packages/cli/src/config.ts` before you publish the CLI. `@draftbox/contracts` stays private. The CLI build bundles it into `draftbox`, so installs do not need that package on the registry.

```sh
pnpm --filter draftbox pack
pnpm --filter draftbox publish
```

For local work or another deployment, override the baked-in defaults:

```sh
export DRAFTBOX_API_URL="https://draftbox.example.workers.dev"
export DRAFTBOX_WORKOS_AUTHKIT_URL="https://your-domain.authkit.app"
export DRAFTBOX_WORKOS_CLIENT_ID="client_..."
```

Then log in and upload:

```sh
pnpx draftbox login
pnpx draftbox upload ./page.html
pnpx draftbox list
```

Upload the same canonical file path from the same machine again and Draftbox adds a new version to the existing artifact. Pass `--artifact` to attach a file as a version of an already existing artifact (note this does not bind the file provenance (hostname/filepath) to the artifact).

Credentials live in `${XDG_CONFIG_HOME:-~/.config}/draftbox/credentials.json` with owner-only permissions. Set `DRAFTBOX_CONFIG_DIR` to change the directory.

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

Deletion is permanent. The CLI prompts unless you pass `--yes`. Uploading a version, including one matched from the same machine and canonical path, never changes artifact metadata. Use `edit` for that.
