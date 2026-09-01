import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";

import { CiResources } from "./constructs/CiResources";
import { DomainResources } from "./constructs/DomainResources";
import { HostingResources } from "./constructs/HostingResources";
import type { InfraConfig } from "./config";

/**
 * The whole project, in three constructs:
 *
 *   DomainResources    hosted zone and certificate — RETAIN, outlive the app
 *   HostingResources   bucket and distribution — the swappable layer
 *   CiResources        the role GitHub assumes to deploy
 *
 * One stack, one `cdk deploy`. Nothing here performs a context lookup, so the
 * template synthesizes without AWS credentials.
 */
export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: InfraConfig, props: cdk.StackProps) {
    super(scope, id, props);

    // No domain means no zone, no certificate and no DNS records — see InfraConfig.
    // Narrowed into a local so DomainResources can require the domain it depends on.
    const domainName = config.domain;
    const domain = domainName
      ? new DomainResources(this, "Domain", { ...config, domain: domainName })
      : undefined;

    const hosting = new HostingResources(this, "Hosting", {
      config,
      hostedZone: domain?.hostedZone,
      certificate: domain?.certificate,
    });

    const ci = new CiResources(this, "Ci", {
      config,
      bucket: hosting.bucket,
      distribution: hosting.distribution,
    });

    new cdk.CfnOutput(this, "DeployRoleArn", {
      value: ci.role.roleArn,
      description: "Set as the AWS_DEPLOY_ROLE_ARN repository variable in GitHub.",
    });
    new cdk.CfnOutput(this, "BucketName", { value: hosting.bucket.bucketName });
    new cdk.CfnOutput(this, "DistributionId", { value: hosting.distribution.distributionId });
    // Without a custom domain the distribution's own URL is the only way in.
    new cdk.CfnOutput(this, "SiteUrl", {
      value: config.domain
        ? `https://${config.domain}`
        : `https://${hosting.distribution.distributionDomainName}`,
    });
  }
}
