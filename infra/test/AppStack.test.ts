import assert from "node:assert/strict";
import test from "node:test";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { AppStack } from "../lib/AppStack";
import { readConfig, type InfraConfig } from "../lib/config";

const config: InfraConfig = {
  project: "test-app",
  domain: "test-app.com",
  githubOwner: "Futurizame",
  githubRepo: "test-app",
  githubOwnerId: "131929005",
  githubRepoId: "1354786174",
  account: "000000000000",
  region: "us-east-1",
  tags: {
    Scope: "project",
    ManagedBy: "cdk",
    Project: "test-app",
    StackName: "test-app",
  },
};

function synth(overrides: Partial<InfraConfig> = {}): Template {
  const app = new cdk.App();
  const merged = { ...config, ...overrides };
  const stack = new AppStack(app, merged.project, merged, {
    env: { account: merged.account, region: merged.region },
    tags: merged.tags,
  });
  return Template.fromStack(stack);
}

test("the stack name matches the project slug", () => {
  const app = new cdk.App();
  const stack = new AppStack(app, config.project, config, {
    env: { account: config.account, region: config.region },
  });
  // The CDK CLI selects by construct id and the AWS CLI by stack name. Keeping them
  // equal is what lets the ops scripts use one string for both.
  assert.equal(stack.stackName, config.project);
  assert.equal(stack.node.id, config.project);
});

test("CI can publish the site and nothing else", () => {
  const policies = synth().findResources("AWS::IAM::Policy");
  const actions = Object.values(policies)
    .flatMap((p) => p.Properties.PolicyDocument.Statement)
    .flatMap((s: { Action: string | string[] }) =>
      typeof s.Action === "string" ? [s.Action] : s.Action,
    );

  // A tag build may read its own stack's outputs and nothing else in CloudFormation.
  // What it must never get is sts:AssumeRole on the bootstrapped cdk-* roles: that
  // inherits the CFN execution role, which is AdministratorAccess by default, and
  // hands the whole account to anyone who can push a v* tag.
  for (const action of actions) {
    assert.ok(
      /^(s3|cloudfront):|^cloudformation:DescribeStacks$/.test(action),
      `deploy role granted an action outside s3/cloudfront/DescribeStacks: ${action}`,
    );
  }
});

// GitHub's default OIDC subject embeds the immutable owner and repo ids beside their
// names. A name-only pattern matches nothing, and the failure only surfaces at the
// first tag build as an opaque AccessDenied from STS.
test("only tag builds in the configured repository may assume the deploy role", () => {
  synth().hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
            StringLike: {
              "token.actions.githubusercontent.com:sub":
                "repo:Futurizame@131929005/test-app@1354786174:ref:refs/tags/v*",
            },
          },
        },
      ],
    },
  });
});

test("the website bucket is private and reachable only through CloudFront", () => {
  synth().hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
  synth().resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
});

test("both apex and www are served and resolvable", () => {
  const template = synth();
  template.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: { Aliases: ["test-app.com", "www.test-app.com"] },
  });
  // A + AAAA for each of the two names.
  template.resourceCountIs("AWS::Route53::RecordSet", 4);
});

test("without a domain there is no zone, certificate or DNS record", () => {
  const template = synth({ domain: undefined });

  // The whole domain half of the stack disappears, so an MVP can ship before anyone
  // has bought a name for it.
  template.resourceCountIs("AWS::Route53::HostedZone", 0);
  template.resourceCountIs("AWS::CertificateManager::Certificate", 0);
  template.resourceCountIs("AWS::Route53::RecordSet", 0);

  // What remains still serves the site, at the distribution's own name.
  template.resourceCountIs("AWS::CloudFront::Distribution", 1);
  const config = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0] as {
    Properties: { DistributionConfig: Record<string, unknown> };
  };
  assert.equal(config.Properties.DistributionConfig.Aliases, undefined);
  assert.equal(
    (config.Properties.DistributionConfig.ViewerCertificate as { AcmCertificateArn?: unknown })
      ?.AcmCertificateArn,
    undefined,
  );
});

test("the domain outlives the app: zone, certificate and bucket are retained", () => {
  const resources = synth().toJSON().Resources as Record<string, { DeletionPolicy?: string }>;
  const retained = Object.entries(resources)
    .filter(([, r]) => r.DeletionPolicy === "Retain")
    .map(([id]) => id.replace(/[0-9A-F]{8}$/, ""));

  for (const expected of ["DomainHostedZone", "DomainCertificate", "HostingWebsiteBucket"]) {
    assert.ok(
      retained.some((id) => id.startsWith(expected)),
      `expected ${expected} to be RETAIN, retained: ${retained.join(", ")}`,
    );
  }
});

test("readConfig builds the account-wide tag schema", () => {
  const app = new cdk.App({
    context: {
      project: "test-app",
      domain: "test-app.com",
      githubOwner: "Futurizame",
      githubRepo: "test-app",
      githubOwnerId: "131929005",
      githubRepoId: "1354786174",
      account: "000000000000",
      tags: { Scope: "project", ManagedBy: "cdk" },
    },
  });
  const built = readConfig(app);

  // The same four keys on every stack in the account, so a cost report or a resource
  // query filtering on any of them has no holes.
  assert.deepEqual(Object.keys(built.tags).sort(), ["ManagedBy", "Project", "Scope", "StackName"]);
  // Derived, so they cannot drift from the stack they label.
  assert.equal(built.tags.Project, built.project);
  assert.equal(built.tags.StackName, built.project);
});

test("the account-global OIDC provider is imported, never created", () => {
  const template = synth();
  // Exactly one exists per AWS account, owned by the baseline stack. Creating a second
  // here would fail with EntityAlreadyExists.
  template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
  template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
  // No custom resource means no Lambda and no execution role backing one either.
  template.resourceCountIs("AWS::Lambda::Function", 0);
});

test("the deploy role trusts the imported ARN, not a stack-local resource", () => {
  const roles = synth().findResources("AWS::IAM::Role");
  const federated = Object.values(roles)
    .flatMap((r) => r.Properties.AssumeRolePolicyDocument.Statement)
    .map((s: { Principal?: { Federated?: unknown } }) => s.Principal?.Federated)
    .filter(Boolean);

  // A literal string, not a { Ref: ... }: proof the provider comes from another stack.
  assert.deepEqual(federated, [
    `arn:aws:iam::${config.account}:oidc-provider/token.actions.githubusercontent.com`,
  ]);
});
