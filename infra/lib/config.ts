import type * as cdk from "aws-cdk-lib";

/**
 * Every environment-specific value comes from cdk.json context or the CLI
 * (`--context domain=foo.com`), never from a hardcoded literal, so the scaffold
 * can be cloned without editing stack code.
 */
export type InfraConfig = {
  project: string;
  /**
   * Apex domain, or undefined to publish without one. Without it the stack creates no
   * hosted zone, certificate or DNS records, and the site is reachable only at the
   * CloudFront distribution's own URL — which is what you want for an MVP that does not
   * have a domain yet.
   */
  domain?: string;
  githubOwner: string;
  githubRepo: string;
  /**
   * GitHub's immutable numeric ids for the owner and repo. They appear in the OIDC
   * subject claim ("repo:OWNER@OWNER-ID/REPO@REPO-ID:ref:...") and are what the
   * deploy role's trust policy matches on: unlike the names, they survive a rename,
   * and a repo renamed away cannot take the trust with it.
   */
  githubOwnerId: string;
  githubRepoId: string;
  account: string;
  region: string;
  /** Applied at stack level so CloudFormation propagates them; see bin/Launcher.ts. */
  tags: Record<string, string>;
};

function required(app: cdk.App, key: string): string {
  const value = app.node.tryGetContext(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required context "${key}". Set it in infra/cdk.json.`);
  }
  return value;
}

export function readConfig(app: cdk.App): InfraConfig {
  const account =
    (app.node.tryGetContext("account") as string | undefined) ??
    process.env.CDK_DEFAULT_ACCOUNT ??
    process.env.AWS_ACCOUNT_ID;

  if (!account) {
    throw new Error(
      "No AWS account resolved. Configure credentials, or pass -c account=123456789012 " +
        "to synth without them (see the synth:offline script).",
    );
  }

  const project = required(app, "project");

  return {
    project,
    // Deliberately not `required`: an empty or absent domain is a supported mode.
    domain: (app.node.tryGetContext("domain") as string | undefined) || undefined,
    githubOwner: required(app, "githubOwner"),
    githubRepo: required(app, "githubRepo"),
    githubOwnerId: required(app, "githubOwnerId"),
    githubRepoId: required(app, "githubRepoId"),
    account,
    // CloudFront requires its ACM certificate in us-east-1, and keeping the
    // whole stack there avoids a cross-region certificate stack.
    region: "us-east-1",

    // Four keys, the same across every stack in the account: Project, StackName,
    // ManagedBy and Scope. Scope separates what dies with an app from what outlives
    // every app, which is the split cost reports and resource queries care about.
    // The free-form pair comes from context; the two that describe this stack are
    // derived, so they cannot drift from the stack they label. StackName matters
    // because CloudFormation does not add aws:cloudformation:* tags to every
    // resource type — the account-global OIDC provider has none.
    tags: {
      ...((app.node.tryGetContext("tags") as Record<string, string> | undefined) ?? {}),
      Project: project,
      StackName: project,
    },
  };
}
