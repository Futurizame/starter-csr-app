# Starter CSR App

<!-- setup:description -->

Client-rendered web app: Vite + React + React Router, prerendered to static
files and served from S3 + CloudFront.

<!-- setup:template-start -->

## Start a new project from this template

```bash
curl -fsSL https://raw.githubusercontent.com/Futurizame/starter-csr-app/main/scripts/setup.ts | npx tsx
```

One command, from any directory. It asks for the project's details up front, then
creates the GitHub repository, rewrites this scaffold's metadata, deploys the AWS
infrastructure and cuts the first release. Nothing is created until the questions and
the prerequisite checks have both passed, and `--dry-run` stops before anything is.

See [docs/SCAFFOLD.md](docs/SCAFFOLD.md) for what each step does and what it needs.

This section, that document and `scripts/setup.ts` all remove themselves once setup has
run: they describe the scaffold, not the project it produces.

<!-- setup:template-end -->

## Running locally

```bash
npm install
npm run dev
```

## Project structure

```
app/routes/       route modules: loaders, meta, the only router imports
app/features/     components and hooks, plain React
app/components/   presentational only, no data access
app/lib/          plain TypeScript: API client, storage, SEO, config
infra/            CDK stacks
scripts/          setup.ts, the entry point; lib/ holds the operational scripts
```

`app/lib/site.ts` holds this project's name, description and social metadata.
`infra/cdk.json` holds the domain and AWS settings. Leaving `domain` empty is
supported: the stack then creates no hosted zone or certificate and the site is
served at the CloudFront distribution's own URL.

## Commands

| Command             | Does                                   |
| ------------------- | -------------------------------------- |
| `npm run dev`       | dev server                             |
| `npm run build`     | prerender + bundle into `build/client` |
| `npm test`          | Vitest (`test:watch` to watch)         |
| `npm run lint`      | ESLint                                 |
| `npm run typecheck` | route typegen + `tsc`                  |
| `npm run format`    | Prettier                               |

Operational tasks are not npm scripts — they need AWS credentials and run
rarely:

| Command                        | Does                                     |
| ------------------------------ | ---------------------------------------- |
| `scripts/deploy.sh`            | upload + invalidate (CI does this)       |
| `npx cdk diff` (in `infra/`)   | diff the stacks against what is deployed |
| `npx cdk deploy` (in `infra/`) | apply infrastructure changes             |

## Deploying

```bash
git tag v1.0.0 && git push --tags
```

That runs lint, typecheck, tests and build; uploads the site with per-file
cache headers; invalidates CloudFront; and cuts a GitHub release.

CI publishes; it never changes infrastructure. The deploy role can write to the
bucket and invalidate the distribution, and holds no CloudFormation permissions
at all. Infrastructure changes are `npx cdk deploy` in `infra/`, run by someone
with credentials.

Tag pushes are the only deploy path. A branch push cannot deploy: the AWS role's
trust policy only accepts tokens issued for `refs/tags/v*`, so a workflow edited
on a branch gets no credentials at all.

## Requirements

Node 22 (see `.nvmrc`) and the AWS CLI.
