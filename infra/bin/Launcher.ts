#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import { AppStack } from "../lib/AppStack";
import { readConfig } from "../lib/config";

const app = new cdk.App();
const config = readConfig(app);

// The construct id and the CloudFormation stack name are deliberately the same
// string. The CDK CLI selects stacks by construct id, the AWS CLI by stack name;
// when the two differ, every `aws cloudformation` call has to know which is which,
// and eventually one of them gets it wrong.
new AppStack(app, config.project, config, {
  env: { account: config.account, region: config.region },
  description: `${config.project}: static site on S3 + CloudFront, and the role CI assumes to publish it.`,

  // Stack-level tags rather than `Tags.of(...)`: CloudFormation propagates these to
  // every resource that supports tagging, including the L1s behind custom resources,
  // which the tagging aspect cannot reach. The schema is built in lib/config.ts and is
  // shared with every other stack in the account.
  tags: config.tags,

  // Termination protection makes `cdk destroy` fail outright. Turning it off is a
  // separate, deliberate API call, which is the thing to gate with IAM — see
  // docs/SCAFFOLD.md. Retain policies limit the blast radius if it ever is turned
  // off; this stops the command from working at all.
  terminationProtection: true,
});
