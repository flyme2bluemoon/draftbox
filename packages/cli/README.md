# Draftbox

Upload, version, and share single-file HTML pages. Anyone with the link can open a page.

## Usage

Login:

```sh
npx draftbox login
```

Upload a page:

```sh
npx draftbox upload ./page.html
```

Optional name and description. On a new artifact they set the metadata. When adding a version, passing them updates it; omitting them leaves the existing values alone:

```sh
npx draftbox upload ./page.html --name page.html --description "Codebase Architecture Review Report"
```

Upload the same file path from the same machine again and Draftbox adds a new version to the existing artifact. Pass `--artifact` to attach a file as a version of an already existing artifact. That does not bind the file's hostname or path to the artifact.

```sh
npx draftbox upload ./page.html --artifact <artifact-id>
```

List your artifacts:

```sh
npx draftbox list
```

Other commands:

```text
draftbox logout
draftbox whoami
draftbox versions <artifact-id>
draftbox edit <artifact-id> [--name <filename>] [--description <text>]
draftbox rotate-link <artifact-id>
draftbox delete <artifact-id> [--version <number>] [--yes]
```

Deletion is permanent. The CLI prompts unless you pass `--yes`. Use `edit` to change metadata without uploading.

Credentials live in `${XDG_CONFIG_HOME:-~/.config}/draftbox/credentials.json` with owner-only permissions. Set `DRAFTBOX_CONFIG_DIR` to change the directory.

The CLI defaults to the hosted Draftbox API. Override for a local Worker or another deployment:

```sh
export DRAFTBOX_API_URL="http://localhost:8787"
export DRAFTBOX_WORKOS_AUTHKIT_URL="https://your-domain.authkit.app"
export DRAFTBOX_WORKOS_CLIENT_ID="client_..."
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
