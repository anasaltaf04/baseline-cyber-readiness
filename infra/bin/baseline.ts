#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BaselineStack } from '../lib/baseline-stack';

const app = new cdk.App();

new BaselineStack(app, 'BaselineStack', {
  // us-east-1 is pinned: it is where the Bedrock Anthropic models this app
  // uses are consistently available, and it keeps the stack to one region.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description:
    'Baseline — cyber readiness check for small businesses (CIS Controls v8 IG1)',
});

cdk.Tags.of(app).add('Project', 'Baseline');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
