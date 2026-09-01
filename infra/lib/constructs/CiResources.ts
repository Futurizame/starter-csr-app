import * as cdk from "aws-cdk-lib";
import type * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import type { InfraConfig } from "../config";

const GITHUB_ISSUER = "token.actions.githubusercontent.com";

type CiResourcesProps = {
  config: InfraConfig;
  bucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
};

/**
 * The project half of CI authentication: the role GitHub assumes. The trust anchor it
 * points at — the account's GitHub OIDC provider — belongs to the account-global
 * baseline stack, because one exists per account rather than per project.
 *
 * Replaces long-lived access keys in CI with a role GitHub can assume for the
 * duration of one workflow run. Nothing secret is stored in the repository:
 * GitHub signs a short-lived token, STS exchanges it for credentials that
 * expire in an hour, and only `AWS_DEPLOY_ROLE_ARN` — not a secret — is stored.
 *
 * The role can publish the site and nothing else. It cannot deploy the stack
 * that created it.
 */
export class CiResources extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: CiResourcesProps) {
    super(scope, id);

    const { config, bucket, distribution } = props;

    // IAM permits exactly one OIDC provider per issuer URL per account, so it is not
    // this project's to create. The account-global baseline stack owns it and is
    // deployed once per AWS account.
    //
    // Imported by its deterministic ARN rather than a CloudFormation export: an export
    // cannot be changed or removed while a consumer references it, which would make the
    // account's most shared stack the hardest one to evolve. Nothing here can verify the
    // provider exists — the ARN is only a string — so scripts/setup.ts checks
    // before deploying, otherwise the failure surfaces at the first CI run instead.
    const providerArn = `arn:aws:iam::${config.account}:oidc-provider/${GITHUB_ISSUER}`;
    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GithubProvider",
      providerArn,
    );

    // Only tag pushes may assume this role: a workflow edited on a branch
    // cannot deploy.
    this.role = new iam.Role(this, "DeployRole", {
      roleName: `${config.project}-github-deploy`,
      description: `Deploy role for ${config.githubOwner}/${config.githubRepo} tag builds`,
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          [`${GITHUB_ISSUER}:aud`]: "sts.amazonaws.com",
        },
        StringLike: {
          // GitHub's default subject claim carries each id alongside its name —
          // "repo:OWNER@OWNER-ID/REPO@REPO-ID:ref:refs/tags/v1.0.0" — so a
          // name-only pattern silently matches nothing and every tag build fails
          // at sts:AssumeRoleWithWebIdentity.
          [`${GITHUB_ISSUER}:sub`]:
            `repo:${config.githubOwner}@${config.githubOwnerId}/` +
            `${config.githubRepo}@${config.githubRepoId}:ref:refs/tags/v*`,
        },
      }),
    });

    // Publishing the site is the whole job: write the objects, drop the edge
    // cache. Deliberately no sts:AssumeRole on the bootstrapped cdk-* roles —
    // that would reach the CloudFormation execution role, which is
    // AdministratorAccess by default, and hand every tag build the account.
    bucket.grantReadWrite(this.role);

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
        resources: [
          `arn:aws:cloudfront::${config.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    // deploy.ts resolves the bucket and distribution from this stack's outputs, so
    // the role has to read its own stack — and only its own. Read-only: no
    // CreateChangeSet, no UpdateStack, and still no sts:AssumeRole on the cdk-*
    // roles, so the AdministratorAccess path above stays closed.
    //
    // The trailing /* is not optional: a stack ARN ends in a generated id
    // (stack/name/7ad4a5b0-...), and an ARN without it matches nothing.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [
          `arn:aws:cloudformation:${config.region}:${config.account}:stack/${config.project}/*`,
        ],
      }),
    );
  }
}
