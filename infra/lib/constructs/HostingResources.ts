import * as cdk from "aws-cdk-lib";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import type { InfraConfig } from "../config";

type HostingResourcesProps = {
  config: InfraConfig;
  /** Both absent when the project has no custom domain; the two travel together. */
  hostedZone?: route53.IHostedZone;
  certificate?: certificatemanager.ICertificate;
};

/**
 * The swappable layer. Replacing this S3 origin with a compute origin (Lambda,
 * ECS) when the app outgrows CSR leaves the hosted zone and certificate alone,
 * so the domain survives the migration untouched.
 */
export class HostingResources extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: HostingResourcesProps) {
    super(scope, id);

    const { config, hostedZone, certificate } = props;

    // Deterministic so the CI deploy role can be scoped to it by name.
    this.bucket = new s3.Bucket(this, "WebsiteBucket", {
      bucketName: `${config.project}-website-${config.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const rewriteFunction = new cloudfront.Function(this, "RewriteFunction", {
      functionName: `${config.project}-rewrite`,
      code: cloudfront.FunctionCode.fromFile({ filePath: "functions/rewrite.js" }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: "Maps extensionless paths to their prerendered index.html",
    });

    this.distribution = new cloudfront.Distribution(this, "WebsiteDistribution", {
      comment: `${config.project} website`,
      enableIpv6: true,
      defaultRootObject: "index.html",
      // Aliases require a matching certificate, so both are set together or not at all.
      // Without them CloudFront serves the distribution's own *.cloudfront.net name.
      ...(config.domain && certificate
        ? { domainNames: [config.domain, `www.${config.domain}`], certificate }
        : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: rewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      // S3 with OAC answers 403 for keys that do not exist, so both codes route
      // to the SPA fallback that React Router emits for non-prerendered routes.
      // Every route is prerendered, so a miss is a genuine 404 rather than a
      // route the client still has to resolve: serve the prerendered 404 page
      // and keep the status honest. S3 with OAC returns 403 for a missing key
      // because the policy grants GetObject but not ListBucket, so both map.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: "/404/index.html",
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: "/404/index.html",
        },
      ],
    });

    // Nothing to point at the distribution when there is no zone.
    if (config.domain && hostedZone) {
      for (const recordName of [config.domain, `www.${config.domain}`]) {
        for (const recordType of [route53.RecordType.A, route53.RecordType.AAAA]) {
          new route53.RecordSet(this, `Record-${recordName}-${recordType}`, {
            recordName,
            recordType,
            zone: hostedZone,
            target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
          });
        }
      }
    }
  }
}
