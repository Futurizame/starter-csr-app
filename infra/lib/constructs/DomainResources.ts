import * as cdk from "aws-cdk-lib";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

import type { InfraConfig } from "../config";

/**
 * The domain: hosted zone and certificate.
 *
 * Both are RETAIN. They outlive this application — the nameservers are set at
 * the registrar once and should never have to change, and a rewrite of this app
 * in another repository adopts the same zone with `cdk import` rather than
 * starting a fresh delegation. `cdk destroy` therefore leaves both behind;
 * removing them is a deliberate act in the console.
 *
 * The certificate validates against the zone declared beside it, so the first
 * deploy pauses here until the registrar points at the new nameservers.
 * `scripts/setup.ts` publishes them while that wait is happening.
 */
export class DomainResources extends Construct {
  public readonly hostedZone: route53.PublicHostedZone;
  public readonly certificate: certificatemanager.Certificate;

  constructor(scope: Construct, id: string, config: InfraConfig & { domain: string }) {
    super(scope, id);

    this.hostedZone = new route53.PublicHostedZone(this, "HostedZone", {
      zoneName: config.domain,
      comment: `Hosted zone for ${config.domain}`,
    });
    this.hostedZone.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    this.certificate = new certificatemanager.Certificate(this, "Certificate", {
      certificateName: `${config.project}-certificate`,
      domainName: config.domain,
      subjectAlternativeNames: [`www.${config.domain}`],
      validation: certificatemanager.CertificateValidation.fromDns(this.hostedZone),
    });
    this.certificate.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    new cdk.CfnOutput(this, "NameServers", {
      value: cdk.Fn.join(",", this.hostedZone.hostedZoneNameServers ?? []),
      description: "Set these as the custom nameservers at the registrar.",
    });
  }
}
