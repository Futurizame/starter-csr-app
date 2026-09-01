/**
 * Creates a new project from this template.
 *
 *   curl -fsSL https://raw.githubusercontent.com/Futurizame/starter-csr-app/main/scripts/setup.ts | npx tsx
 *
 * Five steps, in order. Steps 1 and 2 create nothing; step 3 is the first to write:
 *
 *   1. Questions      every answer collected up front
 *   2. Verify         prerequisites, credentials, and that the name is free
 *   3. Repository     create from the template, rewrite the metadata, push
 *   4. Infrastructure cdk bootstrap + deploy, and the DNS delegation
 *   5. Release        tag v0.0.1, which is what actually publishes the site
 *
 * This file is deliberately one self-contained script with no relative imports. It is
 * piped from a URL, so it runs before any checkout exists — and Node resolves a piped
 * script's relative imports against the *current directory*, not the script, so
 * `./lib/shell` would fail on a machine that has never seen this project. So everything
 * it needs lives here, and the project it creates ships only `scripts/deploy.sh`.
 *
 * That also means normal file-length rules do not apply here. This is a one-shot
 * bootstrapper, not application code; being readable top-to-bottom in one file is the
 * point.
 *
 *   --dry-run   run every read-only check for real, report what would happen, and stop
 *               before anything is created. Needs no credentials.
 *   --yes       take every default instead of prompting. --repo has no default, so it
 *               must be passed; so must --profile, unless $AWS_PROFILE is set.
 *
 * Every question is also a flag:
 *
 *   --repo          repository name, and the S3 bucket, stack and package name
 *   --profile       AWS profile for the deploy (defaults to $AWS_PROFILE)
 *   --domain        apex domain; skip to publish at the CloudFront URL
 *   --app-name      display name (defaults to the title-cased repository name)
 *   --description   one-sentence description (defaults to the app name)
 *   --author        npm metadata
 *   --keywords      npm metadata, comma separated
 *   --theme-color   mobile browser UI colour (defaults to #18181b)
 */
import { execFileSync, spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";

/** The repository this script was fetched from, and the template every project starts as. */
const TEMPLATE = "Futurizame/starter-csr-app";

/** The tag cut by step 5. `v*` is what the deploy role's trust policy accepts. */
const FIRST_VERSION = "0.0.1";

const dryRun = process.argv.includes("--dry-run");
const assumeDefaults = process.argv.includes("--yes");

// ---------------------------------------------------------------------------
// §0  Helpers
//
// Nothing here is specific to setup; it is the usual "run a command, ask a
// question, give up loudly" layer.
// ---------------------------------------------------------------------------

const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

const TOTAL_STEPS = 5;

/** How far the run got. Read by main()'s catch to describe what was left behind. */
let currentStep = 0;

function step(current: number, title: string): void {
  currentStep = current;
  console.log(`\n${bold(`[${current}/${TOTAL_STEPS}] ${title}`)}`);
}

/**
 * Runs a command, streaming its output. Throws if it fails.
 *
 * stdin is deliberately not inherited. This script is normally piped from curl, so its
 * own stdin is the spent pipe the script arrived on — never a terminal. A child that
 * inherited it and then tried to prompt would block forever on input nobody can type,
 * with no output to say what it wanted. Nothing run here reads stdin, and the script's
 * own prompts go through /dev/tty rather than stdin, so closing it costs nothing and
 * turns a silent hang into a loud failure.
 */
function run(command: string, args: string[], cwd?: string): void {
  execFileSync(command, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
}

/** Runs a command and captures stdout. Returns undefined if it fails. */
function capture(command: string, args: string[], cwd?: string): string | undefined {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function has(command: string): boolean {
  return capture("which", [command]) !== undefined;
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * A terminal to prompt on.
 *
 * When this script is piped — the documented way to run it — the *script itself* is on
 * stdin, so reading answers from stdin gets EOF and every prompt resolves to nothing.
 * `/dev/tty` is the controlling terminal regardless of what stdin was redirected to,
 * which is the same trick `curl | sh` installers use. Falls back to stdin for the
 * ordinary case of running this file directly, where stdin really is the terminal.
 */
function openPrompt(): Interface | undefined {
  if (process.stdin.isTTY) {
    return createInterface({ input: process.stdin, output: process.stdout });
  }
  // openSync first, and deliberately not createReadStream("/dev/tty"): the stream form
  // reports a missing terminal through an async "error" event, which no try/catch here
  // can see, and the unhandled event then kills the process long after this returned.
  // openSync throws ENXIO synchronously, which is catchable. Separate fds for read and
  // write so closing one does not close the other.
  try {
    return createInterface({
      input: createReadStream("", { fd: openSync("/dev/tty", "r") }),
      output: createWriteStream("", { fd: openSync("/dev/tty", "w") }),
    });
  } catch {
    return undefined;
  }
}

let prompt: Interface | undefined;

/** Yes/no. Non-interactive runs take the default rather than blocking forever. */
async function confirm(question: string, fallback = true): Promise<boolean> {
  if (assumeDefaults || !prompt) return fallback;
  const answer = (await prompt.question(`${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).trim();
  return (answer || (fallback ? "y" : "n")).toLowerCase().startsWith("y");
}

// ---------------------------------------------------------------------------
// §1  Questions
//
// Everything is asked here, before a single resource exists. A question that
// cannot be answered from a default is a hard stop now, rather than a failure
// after the repository has been created and half the metadata rewritten.
// ---------------------------------------------------------------------------

type Field = {
  key: string;
  flag: string;
  question: string;
  fallback: (answers: Answers) => string;
  validate?: (value: string) => string | undefined;
  /** Accepts an empty answer, shown as [skip]. */
  optional?: boolean;
  /** Printed above the prompt, for an answer that needs more than one line of context. */
  hint?: () => string | undefined;
};

type Answers = Record<string, string>;

/**
 * The repository name is also the project slug: it becomes the S3 bucket, the
 * CloudFormation stack and the npm package name. CloudFormation is the strictest of the
 * three — it requires a leading letter (`[a-zA-Z][-a-zA-Z0-9]*`) where S3 would accept a
 * leading digit — so its rule is the one enforced. Catching it at the prompt beats
 * failing at `cdk deploy`, after the account is bootstrapped and the domain confirmed.
 */
function validateSlug(value: string): string | undefined {
  return /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(value)
    ? undefined
    : "3-32 characters: lowercase letters, digits and hyphens, e.g. cdk-something. Must " +
        "start with a letter (CloudFormation rejects stack names that do not) and must " +
        "not end with a hyphen.";
}

/** Only called for a non-empty answer; skipping the domain is handled by `optional`. */
function validateDomain(value: string): string | undefined {
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(value)
    ? undefined
    : "Pass the apex domain, e.g. my-app.com — not a URL and not a subdomain of one you do not own.";
}

/**
 * What the AWS CLI has configured locally. Reading it is a file lookup, not an API call,
 * so it costs nothing and works with no credentials — a dry run stays credential free.
 */
const awsProfiles = has("aws")
  ? (capture("aws", ["configure", "list-profiles"]) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  : [];

function validateProfile(value: string): string | undefined {
  return awsProfiles.length === 0 || awsProfiles.includes(value)
    ? undefined
    : `No profile named "${value}". Configured: ${awsProfiles.join(", ")}. ` +
        'Add one with "aws configure sso".';
}

const fields: Field[] = [
  {
    key: "repo",
    flag: "repo",
    question: "Repository name (also the S3 bucket, stack and package name)",
    // No default. This is the project's identity and the one thing nobody else can
    // guess; every other answer can reasonably fall back to something.
    fallback: () => "",
    validate: validateSlug,
  },
  {
    key: "awsProfile",
    flag: "profile",
    question: "AWS profile for the infrastructure deploy",
    // Defaults to the environment when it is already pointing somewhere. With no
    // AWS_PROFILE and no answer there is nothing to deploy with, so §2 stops.
    fallback: () => process.env.AWS_PROFILE ?? "",
    validate: validateProfile,
    hint: () => (awsProfiles.length ? `  Configured: ${awsProfiles.join(", ")}` : undefined),
  },
  {
    key: "domain",
    flag: "domain",
    question: "Apex domain, or skip to publish at the CloudFront URL",
    // Deliberately no default. Guessing `${repo}.com` invites accepting a domain nobody
    // owns, and the stack would then create a hosted zone for it and wait forever for a
    // delegation that never comes. Skipping is a supported mode: no zone, no
    // certificate, no DNS records — just the distribution's own URL.
    fallback: () => "",
    optional: true,
    validate: validateDomain,
  },
  {
    key: "appName",
    flag: "app-name",
    question: "App name, as people should see it",
    // The repository name is a slug; this is the display form. Title-casing the slug is
    // right often enough to be a useful default and always easy to override.
    fallback: (a) =>
      a.repo
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
  },
  {
    key: "description",
    flag: "description",
    question: "One-sentence description (meta description, npm, link previews)",
    // Empty is allowed: site.ts and the README both fall back to the app name.
    fallback: () => "",
    optional: true,
  },
  {
    key: "author",
    flag: "author",
    question: "Author (npm metadata)",
    fallback: () => "",
    optional: true,
  },
  {
    key: "keywords",
    flag: "keywords",
    question: "Keywords, comma separated (npm metadata)",
    fallback: () => "",
    optional: true,
  },
  {
    key: "themeColor",
    flag: "theme-color",
    question: "Theme colour (mobile browser UI)",
    fallback: () => "#18181b",
  },
];

async function askQuestions(): Promise<Answers> {
  const answers: Answers = {};

  if (!assumeDefaults && !prompt) {
    fail(
      `No terminal to prompt on.\n\n` +
        `Pass --yes with the flags you want instead:\n\n` +
        `  ... | npx tsx - --yes --repo my-app --profile my-sso-profile --domain my-app.com`,
    );
  }

  if (prompt && !assumeDefaults) {
    console.log(`\n${bold("Setting up a new project")}`);
    console.log(dim(`  Enter accepts the suggestion in brackets. Nothing is created yet.\n`));
  }

  for (const field of fields) {
    const fallback = field.fallback(answers);
    const given = flag(field.flag);
    let value = given ?? fallback;

    if (given === undefined && prompt && !assumeDefaults) {
      const suffix = fallback ? ` [${fallback}]` : field.optional ? " [skip]" : "";
      const hint = field.hint?.();
      if (hint) console.log(hint);

      for (;;) {
        const reply = (await prompt.question(`${field.question}${suffix}: `)).trim();
        value = reply || fallback;

        if (!value && !field.optional) {
          console.log(`  Required.`);
          continue;
        }
        const problem = value ? field.validate?.(value) : undefined;
        if (problem) {
          console.log(`  ${problem}`);
          continue;
        }
        break;
      }
    } else {
      if (!value && !field.optional) {
        fail(`--${field.flag} is required and has no default.`);
      }
      const problem = value ? field.validate?.(value) : undefined;
      if (problem) fail(`--${field.flag}: ${problem}`);
    }

    answers[field.key] = value;
  }

  return answers;
}

// ---------------------------------------------------------------------------
// §2  Verify
//
// Every check is read-only, and they all run before step 3 creates anything. The
// point is that a run either gets all the way to a deployed stack or stops here
// having changed nothing — never something in between.
// ---------------------------------------------------------------------------

type Check = {
  label: string;
  ok: () => boolean;
  fix: string;
};

/**
 * The account-global GitHub OIDC provider, owned by the baseline stack rather than by
 * this project. Its absence does not fail a deploy — the trust policy holds only an ARN
 * string — so without this check the stack goes green and every CI run then dies with
 * "Not authorized to perform sts:AssumeRoleWithWebIdentity".
 */
function oidcProviderExists(): boolean {
  const arns = capture("aws", [
    "iam",
    "list-open-id-connect-providers",
    "--query",
    "OpenIDConnectProviderList[].Arn",
    "--output",
    "text",
  ]);
  return Boolean(arns?.includes("token.actions.githubusercontent.com"));
}

function hostedZoneId(domain: string): string | undefined {
  const id = capture("aws", [
    "route53",
    "list-hosted-zones-by-name",
    "--dns-name",
    domain,
    "--query",
    `HostedZones[?Name=='${domain}.'].Id | [0]`,
    "--output",
    "text",
  ]);
  return !id || id === "None" ? undefined : id.replace(/^\/hostedzone\//, "");
}

function verify(a: Answers): { owner: string } {
  step(2, "Verify");

  // Exported before the credential checks below, and inherited by every child process
  // from here on: the cdk and aws calls in step 4 resolve the same profile this
  // answered. Nothing writes it to disk — cdk.json is committed and shared, and CI
  // authenticates with OIDC, where no profile exists.
  if (a.awsProfile) process.env.AWS_PROFILE = a.awsProfile;

  if (!a.awsProfile) {
    fail(
      `No AWS profile.\n\n` +
        `Nothing can be deployed without one. Either set AWS_PROFILE, pass --profile,\n` +
        `or configure one:\n\n` +
        `  aws configure sso`,
    );
  }

  const checks: Check[] = [
    { label: "git", ok: () => has("git"), fix: "Install git." },
    {
      label: "GitHub CLI",
      ok: () => has("gh"),
      fix: "Install the GitHub CLI: https://cli.github.com",
    },
    {
      label: "GitHub authentication",
      ok: () =>
        Boolean(process.env.GH_TOKEN) ||
        (has("gh") && capture("gh", ["auth", "status"]) !== undefined),
      fix: 'Authenticate: "gh auth login", then re-run.',
    },
    {
      label: "AWS CLI",
      ok: () => has("aws"),
      fix: "Install the AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
    },
    {
      label: `AWS credentials (${a.awsProfile})`,
      ok: () => has("aws") && capture("aws", ["sts", "get-caller-identity"]) !== undefined,
      fix:
        `Profile "${a.awsProfile}" has no valid session:\n` +
        `    aws sso login --profile ${a.awsProfile}`,
    },
  ];

  const missing = checks.filter((check) => !check.ok());
  for (const check of checks) {
    console.log(`  ${missing.includes(check) ? "✗" : "✓"} ${check.label}`);
  }

  if (missing.length > 0) {
    fail(
      `Missing ${missing.length === 1 ? "a prerequisite" : `${missing.length} prerequisites`}:\n\n` +
        missing.map((check) => `  ${check.label}\n    ${check.fix}`).join("\n\n"),
    );
  }

  // Whose account the repository lands in. Asking would let the answer disagree with
  // the credentials actually in play; deriving it cannot.
  const owner = capture("gh", ["api", "user", "--jq", ".login"]);
  if (!owner) fail(`Could not read the authenticated GitHub user. Try "gh auth status".`);

  // The three ways this run could collide with something that already exists. Each is
  // cheap to check and expensive to discover later: the first two would fail *after*
  // twelve questions, and the third silently creates a second hosted zone.
  if (capture("gh", ["repo", "view", `${owner}/${a.repo}`, "--json", "name"]) !== undefined) {
    fail(`${owner}/${a.repo} already exists. Pick another name, or delete it first.`);
  }
  console.log(`  ✓ ${owner}/${a.repo} is available`);

  if (existsSync(join(process.cwd(), a.repo))) {
    fail(`./${a.repo} already exists here. Move it, or run this from another directory.`);
  }
  console.log(`  ✓ ./${a.repo} is free`);

  if (oidcProviderExists()) {
    console.log(`  ✓ GitHub OIDC provider`);
  } else {
    const problem =
      `No GitHub OIDC provider in this AWS account.\n\n` +
      `It is account-global: exactly one exists per account, owned by the baseline\n` +
      `stack rather than by any project. Deploy that stack first, then re-run.`;
    // A dry run reports it and keeps going, so the remaining steps stay visible.
    if (dryRun) console.log(`  ✗ ${problem.split("\n")[0]} (would block a real run)`);
    else fail(problem);
  }

  /**
   * A hosted zone with no stack owning it is the residue of a rolled-back deploy: the
   * zone is RETAIN, so it survived. Deploying now would create a second zone for the
   * same domain, with different nameservers, and Route53 allows that silently.
   */
  if (a.domain) {
    const orphan = hostedZoneId(a.domain);
    if (orphan) {
      fail(
        `A hosted zone for ${a.domain} already exists (${orphan}).\n` +
          `Deploying would create a second zone with different nameservers.\n\n` +
          `Delete it in the Route53 console, or adopt it with "npx cdk import" after\n` +
          `the stack exists, then re-run.`,
      );
    }
    console.log(`  ✓ no existing hosted zone for ${a.domain}`);
  }

  return { owner };
}

// ---------------------------------------------------------------------------
// §3  Repository
//
// The first step that creates anything. From here on a failure leaves something
// behind, which is why everything above had to pass first.
// ---------------------------------------------------------------------------

/** Set once the clone exists; every path below is relative to it. */
let projectDir = "";

/** "owner/repo", known from §2 onward. Used by main()'s catch to name what exists. */
let slug = "";

const root = (path: string) => join(projectDir, path);

function editJson(path: string, edit: (json: Record<string, unknown>) => void): void {
  const file = root(path);
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  edit(json);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function editText(path: string, edit: (text: string) => string): void {
  const file = root(path);
  if (!existsSync(file)) return;
  writeFileSync(file, edit(readFileSync(file, "utf8")));
}

/**
 * `gh repo create --template` returns as soon as GitHub accepts the request, but the
 * template copy itself is asynchronous — the clone can land before the files do. Waiting
 * for a file that only a populated repository has turns a confusing empty checkout into
 * a bounded wait.
 */
async function waitForTemplate(): Promise<void> {
  const marker = root("infra/cdk.json");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (existsSync(marker)) return;
    await sleep(1_000);
    capture("git", ["pull", "--ff-only"], projectDir);
  }
  fail(
    `${projectDir} is still empty 30s after creation.\n\n` +
      `GitHub copies a template asynchronously and this one has not landed. Check the\n` +
      `repository on GitHub; if the files are there, re-run inside the clone.`,
  );
}

async function createRepository(a: Answers, owner: string): Promise<void> {
  step(3, "Repository");

  run("gh", [
    "repo",
    "create",
    slug,
    "--template",
    TEMPLATE,
    "--private",
    "--clone",
    "--description",
    a.description || a.appName,
  ]);
  projectDir = join(process.cwd(), a.repo);
  console.log(`  created ${slug}`);

  await waitForTemplate();

  /**
   * GitHub's immutable numeric ids for the owner and repository. The OIDC subject claim
   * a workflow presents carries them — "repo:OWNER@OWNER-ID/REPO@REPO-ID:ref:..." — so
   * the deploy role's trust policy has to match on them, not on the names alone.
   *
   * Derived from the API rather than asked for: they are facts about the repository, and
   * a typed-in id that disagrees with reality fails at the first tag build with an
   * unhelpful AccessDenied.
   */
  const ids = capture("gh", ["api", `repos/${slug}`, "--jq", "[.owner.id, .id] | @tsv"]);
  const [ownerId, repoId] = ids?.split("\t") ?? [];
  if (!ownerId || !repoId) {
    fail(
      `Could not read the GitHub ids for ${slug}.\n\n` +
        `They are needed for the deploy role's trust policy:\n\n` +
        `  gh api repos/${slug}`,
    );
  }

  /** What the template calls itself right now. Read before anything is rewritten. */
  const current = (() => {
    const site = readFileSync(root("app/lib/site.ts"), "utf8");
    const context = (
      JSON.parse(readFileSync(root("infra/cdk.json"), "utf8")) as {
        context: Record<string, string>;
      }
    ).context;
    const field = (name: string) => new RegExp(`${name}: "([^"]*)"`).exec(site)?.[1] ?? "";

    return {
      project: context.project ?? "",
      domain: context.domain ?? "",
      appName: field("name"),
      description: field("description"),
    };
  })();

  const quote = (value: string) => JSON.stringify(value);

  // app/lib/site.ts is the app's own metadata: rewritten as literals so it stays typed
  // and reviewable rather than resolved at runtime.
  editText("app/lib/site.ts", (text) =>
    text
      .replace(/(export const site: Site = \{[\s\S]*?name: )"[^"]*"/, `$1${quote(a.appName)}`)
      .replace(/(description: )"[^"]*"/, `$1${quote(a.description || a.appName)}`)
      .replace(/(themeColor: )"[^"]*"/, `$1${quote(a.themeColor)}`)
      // Empty without a custom domain, which app/lib/site.ts documents as "omit the
      // URL-dependent tags" rather than guess at the distribution's generated name.
      .replace(/(siteUrl: )"[^"]*"/, `$1${quote(a.domain ? `https://${a.domain}` : "")}`),
  );

  // infra/cdk.json owns everything the stacks need, the domain included.
  editJson("infra/cdk.json", (json) => {
    const context = json.context as Record<string, string>;
    context.project = a.repo;
    context.domain = a.domain;
    context.githubOwner = owner;
    context.githubRepo = a.repo;
    context.githubOwnerId = ownerId;
    context.githubRepoId = repoId;
  });

  editJson("package.json", (json) => {
    json.name = a.repo;
    // Matches the tag step 5 pushes, so the first release and package.json agree.
    json.version = FIRST_VERSION;
    json.description = a.description || a.appName;
    // MVPs are private by default; app/lib/site.ts likewise keeps the "en" locale.
    json.license = "UNLICENSED";
    json.homepage = a.domain ? `https://${a.domain}` : `https://github.com/${slug}`;
    json.repository = { type: "git", url: `git+https://github.com/${slug}.git` };
    json.bugs = { url: `https://github.com/${slug}/issues` };

    if (a.author) json.author = a.author;
    else delete json.author;

    const keywords = a.keywords
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    if (keywords.length) json.keywords = keywords;
    else delete json.keywords;
  });

  // npm rewrites this on the next install, but a stale name makes `npm ci` noisy in the
  // meantime.
  editJson("package-lock.json", (json) => {
    json.name = a.repo;
    json.version = FIRST_VERSION;
    const packages = json.packages as Record<string, { name?: string; version?: string }>;
    if (packages?.[""]) {
      packages[""].name = a.repo;
      packages[""].version = FIRST_VERSION;
    }
  });

  /**
   * Replaces whatever the template currently calls itself, read before anything was
   * rewritten — not hardcoded literals, which would leave README.md on the template's
   * name if it were ever renamed.
   */
  const rename = (from: string, to: string) => (text: string) =>
    from && from !== to ? text.replaceAll(from, to) : text;

  const rebrand = (text: string) =>
    [
      rename(current.project, a.repo),
      rename(current.appName, a.appName),
      rename(current.domain, a.domain),
      rename(current.description, a.description || a.appName),
    ].reduce((acc, apply) => apply(acc), text);

  /**
   * The "start a new project" section is about the scaffold, so it goes the same way as
   * SCAFFOLD.md and this script. Stripped before rebranding: it names the template
   * repository in a URL, which rebrand would happily rewrite to point at a raw file
   * that does not exist.
   */
  const stripTemplateSection = (text: string) =>
    text.replace(/<!-- setup:template-start -->[\s\S]*?<!-- setup:template-end -->\n+/, "");

  editText("README.md", (text) =>
    rebrand(stripTemplateSection(text)).replace(
      "<!-- setup:description -->",
      a.description || a.appName,
    ),
  );

  // All three describe the scaffold, not the project it produced. This script in
  // particular can only ever run once per repository.
  for (const file of ["scripts/setup.ts", "scripts/setup.test.ts", "docs/SCAFFOLD.md"]) {
    capture("git", ["rm", "-q", file], projectDir);
  }

  const touched = [
    "app/lib/site.ts",
    "infra/cdk.json",
    "package.json",
    "package-lock.json",
    "README.md",
  ];
  for (const file of touched) console.log(`  ${file}`);

  console.log(`\n  installing dependencies`);
  run("npm", ["install"], projectDir);

  // package-lock.json is left alone; npm owns its formatting. --ignore-unknown keeps
  // an unparseable file from failing the run.
  run(
    "npx",
    [
      "prettier",
      "--write",
      ...touched.filter((file) => file !== "package-lock.json"),
      "--ignore-unknown",
      "--log-level",
      "warn",
    ],
    projectDir,
  );

  run("git", ["add", "-A"], projectDir);
  run("git", ["commit", "-qm", `Initial commit: ${a.appName}`], projectDir);
  run("git", ["push", "-u", "origin", "main"], projectDir);
  console.log(`  pushed to ${slug}`);
}

// ---------------------------------------------------------------------------
// §4  Infrastructure
//
// The first step that touches AWS, and the only one that cannot be undone by
// deleting a repository.
// ---------------------------------------------------------------------------

/**
 * The CDK CLI normally exports CDK_DEFAULT_ACCOUNT for the app process, but that relies
 * on its own credential resolution, which does not always agree with the AWS CLI's: an
 * SSO profile can resolve for `aws` and not for `cdk`, and `readConfig` then throws
 * before anything is deployed. Resolving the account here and passing it as context
 * makes every cdk invocation independent of that difference. Read-only.
 */
function accountContext(): string[] {
  const account = capture("aws", [
    "sts",
    "get-caller-identity",
    "--query",
    "Account",
    "--output",
    "text",
  ]);
  return account ? ["-c", `account=${account}`] : [];
}

function nameservers(domain: string): string[] {
  const raw = capture("aws", [
    "route53",
    "get-hosted-zone",
    "--id",
    hostedZoneId(domain) ?? "",
    "--query",
    "DelegationSet.NameServers",
    "--output",
    "text",
  ]);
  return (raw ?? "").split(/\s+/).filter(Boolean);
}

/**
 * Polls a public resolver rather than the local one, which may have cached NXDOMAIN for
 * the zone from before it existed.
 */
async function delegated(domain: string, expected: string[]): Promise<boolean> {
  const want = new Set(expected.map((server) => server.replace(/\.$/, "").toLowerCase()));
  const resolver = new Resolver();
  resolver.setServers(["8.8.8.8"]);

  try {
    const servers = await resolver.resolveNs(domain);
    return servers.some((server) => want.has(server.replace(/\.$/, "").toLowerCase()));
  } catch {
    return false;
  }
}

/**
 * Waits for CloudFormation to create the zone, publishes its nameservers, then reports
 * until the delegation is visible. Never rejects: the deploy is the thing that succeeds
 * or fails, and this only exists to unblock it.
 *
 * The block is reprinted on every poll. CDK and this function share one terminal, and a
 * single printout gets scrolled away by stack events within seconds — which previously
 * meant going to the Route53 console to read nameservers this script had already
 * fetched. `--progress=errors-only` on the deploy keeps that scroll to a minimum.
 */
async function publishNameservers(domain: string, done: () => boolean): Promise<void> {
  while (!hostedZoneId(domain)) {
    if (done()) return;
    await sleep(5_000);
  }

  const servers = nameservers(domain);

  while (!done()) {
    if (await delegated(domain, servers)) {
      console.log(`\n  ${domain} is delegated. The certificate can validate now.\n`);
      return;
    }
    console.log(`\n${bold(`Waiting on the delegation for ${domain}`)}`);
    console.log(`  Set these four nameservers at the registrar:`);
    for (const server of servers) console.log(`    ${server}`);
    console.log(dim(`  Namecheap > Domain List > ${domain} > Manage > Nameservers > Custom DNS`));
    console.log(dim(`  The deploy is paused at the certificate until they go live.\n`));
    await sleep(30_000);
  }
}

/** Runs cdk deploy without blocking, so nameservers can be published meanwhile. */
function deployInBackground(context: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "cdk",
        "deploy",
        ...context,
        "--require-approval",
        "never",
        // Not the default progress bar: it redraws the terminal continuously and
        // overwrites the nameserver block printed alongside it.
        "--progress",
        "errors-only",
      ],
      { cwd: join(projectDir, "infra"), stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`cdk deploy exited with ${code}`)),
    );
  });
}

function stackOutput(stack: string, key: string): string | undefined {
  const value = capture("aws", [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stack,
    "--query",
    `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`,
    "--output",
    "text",
  ]);
  return !value || value === "None" ? undefined : value;
}

async function createInfrastructure(a: Answers, owner: string): Promise<void> {
  step(4, "Infrastructure");

  const context = accountContext();
  const infraDir = join(projectDir, "infra");

  run("npx", ["cdk", "bootstrap", ...context, "--require-approval", "never"], infraDir);

  if (a.domain) {
    let finished = false;
    const deploy = deployInBackground(context).finally(() => {
      finished = true;
    });
    await Promise.all([deploy, publishNameservers(a.domain, () => finished)]);
  } else {
    // Nothing to delegate, so nothing to publish alongside the deploy.
    await deployInBackground(context);
  }

  const roleArn = stackOutput(a.repo, "DeployRoleArn");
  if (!roleArn) fail(`${a.repo} deployed but has no DeployRoleArn output.`);

  const variableSet =
    capture("gh", [
      "variable",
      "set",
      "AWS_DEPLOY_ROLE_ARN",
      "--repo",
      `${owner}/${a.repo}`,
      "--body",
      roleArn,
    ]) !== undefined;

  if (variableSet) {
    console.log(`  AWS_DEPLOY_ROLE_ARN set on ${owner}/${a.repo}`);
  } else {
    // Not fatal — the stack is up and the value is recoverable — but silence here
    // resurfaces as an unexplained credentials failure at the first tag build.
    fail(
      `Could not set AWS_DEPLOY_ROLE_ARN on ${owner}/${a.repo}.\n\n` +
        `The infrastructure is deployed; CI just cannot authenticate without it. Set it\n` +
        `by hand, then push a tag:\n\n` +
        `  gh variable set AWS_DEPLOY_ROLE_ARN --repo ${owner}/${a.repo} \\\n` +
        `    --body ${roleArn}`,
    );
  }
}

// ---------------------------------------------------------------------------
// §5  Release
//
// The infrastructure is live but the bucket is empty, which CloudFront serves as
// an unhelpful 403. Pushing the first tag is what puts a site there, and it is
// the only path that ever writes to the bucket.
// ---------------------------------------------------------------------------

async function firstRelease(a: Answers, owner: string): Promise<void> {
  step(5, "Release");

  const tag = `v${FIRST_VERSION}`;

  if (!(await confirm(`  Push ${tag} to publish the site now?`, true))) {
    console.log(
      `  skipped. Publish whenever you are ready:\n\n    git tag ${tag} && git push --tags\n`,
    );
    return;
  }

  run("git", ["tag", tag], projectDir);
  run("git", ["push", "origin", tag], projectDir);
  console.log(`  pushed ${tag}`);

  // The run does not exist the instant the tag lands; GitHub needs a moment to queue it.
  let runId: string | undefined;
  for (let attempt = 0; attempt < 20 && !runId; attempt++) {
    await sleep(3_000);
    runId = capture(
      "gh",
      [
        "run",
        "list",
        "--branch",
        tag,
        "--limit",
        "1",
        "--json",
        "databaseId",
        "--jq",
        ".[0].databaseId",
      ],
      projectDir,
    );
  }

  if (!runId) {
    console.log(`  the deploy workflow has not appeared yet. Watch it with "gh run watch".`);
    return;
  }

  try {
    run("gh", ["run", "watch", runId, "--exit-status"], projectDir);
  } catch {
    fail(
      `The deploy workflow failed.\n\n` +
        `The infrastructure is up; only the upload failed, so re-running the tag is safe:\n\n` +
        `  gh run rerun ${runId} --repo ${owner}/${a.repo}`,
    );
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  prompt = openPrompt();

  try {
    step(1, "Questions");
    const a = await askQuestions();

    const { owner } = verify(a);
    slug = `${owner}/${a.repo}`;

    if (dryRun) {
      console.log(`\n${bold("Dry run")} — nothing was created.\n`);
      console.log(`  repository     ${owner}/${a.repo} (private, from ${TEMPLATE})`);
      console.log(`  app name       ${a.appName}`);
      console.log(`  description    ${a.description || dim("(falls back to the app name)")}`);
      console.log(`  domain         ${a.domain || dim("(none — served at the CloudFront URL)")}`);
      console.log(`  AWS profile    ${a.awsProfile}`);
      console.log(`  first release  v${FIRST_VERSION}`);
      console.log(`\nRe-run without --dry-run to apply.\n`);
      return;
    }

    // The last chance to stop. Everything above this line is read-only.
    //
    // Asked only when there is somebody to ask. `--yes` is the caller stating consent up
    // front, so prompting for it again — with a default of "no", which is right for an
    // interactive run — would abort every non-interactive one instead.
    if (!assumeDefaults) {
      const go = await confirm(
        `\nCreate ${owner}/${a.repo}` +
          `${a.domain ? ` and deploy to ${a.domain}` : " and deploy"}?`,
        false,
      );
      if (!go) fail(`Nothing was created.`);
    }

    await createRepository(a, owner);
    await createInfrastructure(a, owner);
    await firstRelease(a, owner);

    const url = a.domain
      ? `https://${a.domain}`
      : (stackOutput(a.repo, "SiteUrl") ?? "the CloudFront URL");

    console.log(`\n${bold("Done.")} ${a.appName} ${dim(`(${a.repo})`)}\n`);
    console.log(`  site    ${url}`);
    console.log(`  repo    https://github.com/${owner}/${a.repo}`);
    console.log(`  local   ./${a.repo}\n`);
    console.log(`Every deploy from here is a tag:\n`);
    console.log(`  cd ${a.repo} && git tag v0.0.2 && git push --tags\n`);
    if (a.awsProfile) {
      console.log(dim(`A new shell needs the profile again: export AWS_PROFILE=${a.awsProfile}\n`));
    }
  } catch (error) {
    /**
     * Everything foreseeable exits through fail(), which is why this is reached only by
     * the unforeseen: gh being down, a network drop mid-install, CDK erroring. Node's
     * default handler would print an ENOENT or a "Command failed" stack at somebody who
     * pasted a curl command, and say nothing about what now exists.
     */
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);

    // What survives depends on how far the run got, and each state has a different
    // next move. currentStep is set by step().
    const leftBehind =
      currentStep <= 2
        ? [`Nothing was created. Fix the above and run it again.`]
        : currentStep === 3
          ? [
              `The repository may exist and be half rewritten. To start over, delete`,
              `both and re-run:`,
              ``,
              `  gh repo delete ${slug} --yes`,
              `  rm -rf ./${slug.split("/")[1]}`,
            ]
          : currentStep === 4
            ? [
                `The repository is pushed; the infrastructure is partly deployed. Resume`,
                `it in place rather than starting over:`,
                ``,
                `  cd ${slug.split("/")[1]}/infra && npx cdk deploy`,
              ]
            : [
                `The repository and infrastructure are both up — only the release failed.`,
                `Retry it:`,
                ``,
                `  cd ${slug.split("/")[1]} && git push origin v${FIRST_VERSION}`,
              ];

    fail(
      `Step ${currentStep} failed.\n\n  ${message}\n\n` +
        leftBehind.map((l) => l && `  ${l}`).join("\n"),
    );
  } finally {
    prompt?.close();
  }
}

await main();
