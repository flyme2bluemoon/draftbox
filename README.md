# Draftbox

Draftbox uploads, versions, and shares single-file HTML pages. Manage them with the `draftbox` CLI. Anyone with the link can open a page.

## Usage

```sh
pnpx draftbox login
pnpx draftbox upload ./page.html
pnpx draftbox list
```

Upload the same file path from the same machine again and Draftbox adds a new version to the existing artifact. Pass `--artifact` to attach a file as a version of an already existing artifact. That does not bind the file's hostname or path to the artifact.

Credentials live in `${XDG_CONFIG_HOME:-~/.config}/draftbox/credentials.json` with owner-only permissions. Set `DRAFTBOX_CONFIG_DIR` to change the directory.

Deletion is permanent. The CLI prompts unless you pass `--yes`. Uploading a version, including one matched from the same machine and path, never changes artifact metadata. Use `edit` for that.

### Commands

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
pnpm run --filter draftbox cli --help
```

To point the CLI at a local Worker or another deployment:

```sh
export DRAFTBOX_API_URL="http://localhost:8787"
export DRAFTBOX_WORKOS_AUTHKIT_URL="https://your-domain.authkit.app"
export DRAFTBOX_WORKOS_CLIENT_ID="client_..."
```
