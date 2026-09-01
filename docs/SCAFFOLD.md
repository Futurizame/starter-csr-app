# About this scaffold

Notes for whoever adopts this scaffold for a new project. Once you are set up
and deploying, delete this file — it is about the scaffold, not about your app.

## Setting up a new project

Buy the domain if you want one, install the prerequisites below, then run one command:

```bash
curl -fsSL https://raw.githubusercontent.com/Futurizame/starter-csr-app/main/scripts/setup.ts | npx tsx
```

It runs from any directory and creates the project in a new folder named after the
repository. Five steps, and nothing is created until the first two have passed:

1. **Questions** — every answer is collected up front, before a single resource exists.
   The repository name and AWS profile have no default; everything else does, or can be
   skipped
2. **Verify** — prerequisites, GitHub auth, AWS credentials under the chosen profile,
   that the repository name and target directory are free, that the account-global OIDC
   provider exists, and that no orphaned hosted zone would collide
3. **Repository** — `gh repo create --template`, then rewrites `app/lib/site.ts`,
   `infra/cdk.json`, `package.json`, `package-lock.json` and `README.md`,
   installs, commits and pushes
4. **Infrastructure** — `cdk bootstrap`, then the stack. With a domain it publishes the
   hosted zone's nameservers and waits for the delegation while the deploy is still
   running
5. **Release** — tags `v0.0.1`, which is what actually publishes the site, and watches
   the workflow to the end

`setup.ts` is a single self-contained file on purpose: it is piped from a URL and runs
before any checkout exists, and Node resolves a piped script's relative imports against
the current directory, so it can have none. It deletes itself from the project it
creates, along with this file.

Every answer is also a flag, and `--yes` takes every default:

```bash
curl -fsSL .../scripts/setup.ts | npx tsx - --yes --repo my-app --profile my-sso --domain my-app.com
```

| Flag        | Effect                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `--dry-run` | Runs every read-only check for real, reports what would happen, and stops before creating anything. |
| `--yes`     | Takes every default instead of prompting. `--repo` and `--profile` have no default, so pass them.   |

This repository is a GitHub template, and `--template` is what gives the new project a
single clean commit with an origin of its own. Cloning the scaffold directly is not a
substitute: it carries this repository's history.

### Publishing without a domain

The domain prompt has no default on purpose. Guessing `my-app.com` invites accepting a
name nobody owns, and the stack would then create a hosted zone for it and wait forever
for a delegation that never arrives.

Skip it and the stack drops its whole domain half — no hosted zone, no certificate, no
DNS records, 8 resources instead of 14 — and the site is served at the CloudFront
distribution's own `*.cloudfront.net` URL, which `setup.ts` prints when it finishes.
That is the right mode for an MVP that does not have a name yet.

Two things change in the build: `robots.txt` is emitted without a `Sitemap:` line and no
`sitemap.xml` is written, because a sitemap needs absolute URLs and the distribution's
name is not known at build time. For the same reason `app/lib/seo.ts` omits the
canonical, `og:url` and image tags rather than emitting wrong ones.

To adopt a domain later, set `domain` in `infra/cdk.json` and redeploy: the zone,
certificate and records are added to the existing stack, and the distribution keeps
working throughout.

Step 4 is where AWS is first touched. It asks once, before that, whether to go ahead —
the single point of no return. Everything before it is read-only.

It deliberately does not build or upload the site. Pushing a `v*` tag is the only deploy
path, which keeps CI the only thing that ever writes to the bucket. Until your first tag
the bucket is empty and the domain serves nothing:

```bash
git tag v1.0.0 && git push --tags
```

The stack is one `cdk deploy` covering the hosted zone, certificate, bucket,
distribution and CI role. Because the certificate validates against the zone the
same deploy is creating, CloudFormation pauses at the certificate until the
registrar points at the new nameservers. The script does not make that your
problem: it watches for the zone to appear and publishes its nameservers while
the deploy is still waiting, so it stays one unattended command.

Idempotent, so a failed run is simply re-run.

## Prerequisites

`setup.ts` checks everything it needs in step 2 and refuses to start until it all
passes, listing what is missing at once. A script that stops halfway because a tool is
absent leaves half a project behind.

| Needs           | Why                                                  |
| --------------- | ---------------------------------------------------- |
| `git`           | history and the first commit                         |
| AWS CLI         | the deploy scripts shell out to it                   |
| AWS credentials | `aws sts get-caller-identity` must succeed           |
| GitHub CLI      | creating the repository, setting the deploy variable |
| GitHub auth     | `gh auth login`, or a `GH_TOKEN` in the environment  |

Two more that nothing can check for you: the domain must already be registered
(step 4 asks you to confirm), and Node 22 (see `.nvmrc`).

The delegation is a manual step by design. Step 4 prints the hosted zone's four
nameservers, reprints them every 30 seconds while it waits, and polls a public
resolver until they go live — you paste them into the registrar once and the
deploy carries on. Nothing automates the registrar side: Namecheap's API needs a
whitelisted static IP and an eligible account (20+ domains, $50 lifetime spend,
or $50 balance), which is not worth building against for a step you do once per
project.

### Preventing accidental teardown

The stack sets `terminationProtection: true`, so `cdk destroy` fails:

```
Stack [my-app] cannot be deleted while TerminationProtection is enabled
```

There is also no `npm run destroy` — the scaffold ships no one-word command for
an irreversible action. Tearing down is therefore three deliberate steps by
someone who means it:

```bash
aws cloudformation update-termination-protection \
  --stack-name my-app --no-enable-termination-protection
cd infra && npx cdk deploy   # optional: re-enable later by redeploying
cd infra && npx cdk destroy
```

**Termination protection is a safety catch, not an authorization boundary.**
Anyone holding `cloudformation:UpdateTerminationProtection` can switch it off.
Making it a permission means denying that action, and `DeleteStack`, to everyone
except the people who should have it:

```json
{
  "Effect": "Deny",
  "Action": [
    "cloudformation:DeleteStack",
    "cloudformation:UpdateTerminationProtection",
    "route53:DeleteHostedZone",
    "s3:DeleteBucket"
  ],
  "Resource": "*",
  "Condition": {
    "ArnNotLike": { "aws:PrincipalArn": "arn:aws:iam::<account>:role/<break-glass-role>" }
  }
}
```

Attach that to the permission set or group your team uses day to day. Where it
lives depends on how you manage identities — an SSO permission set, an IAM
group, or a Service Control Policy if the account is in an Organization — which
is why the scaffold documents it rather than deploying it.

Note that the CI deploy role is unaffected either way: it can write to the
bucket and invalidate the distribution, and holds no CloudFormation permissions
at all. A tag build cannot reach `DeleteStack`, or any other stack operation.

Infrastructure is deployed by a person, from `infra/`, with `npx cdk deploy`.
That is why the deploy role needs no `sts:AssumeRole` on the bootstrapped
`cdk-*` roles: that grant would reach the CloudFormation execution role, which
is `AdministratorAccess` by default, and would make every tag build an
account-level trust decision.

### What survives `cdk destroy`

Four resources are `RETAIN`, because their lifetime is longer than this
application's:

| Resource    | Why                                              |
| ----------- | ------------------------------------------------ |
| Hosted zone | nameservers are set at the registrar once, ever  |
| Certificate | free, and reusable by whatever replaces this app |
| S3 bucket   | holds the deployed site                          |

The GitHub OIDC provider used to be on this list. It is not created here at all
any more: exactly one exists per AWS account, so it belongs to the account-global
baseline stack, deployed once per account. This stack imports it by its
deterministic ARN and never owns it, which is why destroying this stack cannot
break another project's CI.

So a full teardown is `cdk destroy` followed by deleting the zone, certificate
and bucket in the console. Deliberate, not accidental. The zone costs $0.50 a
month if you forget it; the rest is free.

Route53 refuses to delete a zone that still holds records, so the order matters:
destroy the stack first — that removes the `A`/`AAAA` records — then the zone.

### Migrating to another stack, or another repository

The scaffold assumes it will eventually be replaced — a move to Next.js, or to a
compute origin. Because the zone and certificate are `RETAIN`, that migration
never touches DNS and never returns to the registrar:

1. Remove `DomainResources` from this stack and `cdk deploy`. CloudFormation
   drops the zone and certificate from the stack and leaves the real ones alone.
2. In the new repository, declare an equivalent hosted zone, then
   `cdk import` and give it the existing zone id. The new stack now owns it.
3. Deploy the new stack. It creates its own distribution, validated against the
   same zone. The live site is untouched.
4. Point the `A`/`AAAA` records at the new distribution, then `cdk destroy` the
   old stack.

The domain never goes dark and nobody visits Namecheap.

If a deploy rolls back after creating the zone, the zone survives — it is
`RETAIN` — but the stack no longer exists to own it. `setup.ts` detects that
case and refuses to run rather than silently creating a second zone with
different nameservers; it tells you to `cdk import` the existing one or delete
it.

## Scope

Single repo, single AWS account, single environment. Two environments (deploy
`dev-*` and `prod-*` tags separately) is a known upgrade: one shared hosted zone
with dev as a subdomain, per-environment `AppStack` and OIDC role with trust
scoped to the tag prefix, GitHub Environments for a prod approval gate, and
`noindex` forced on non-prod.
