#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { InfraEcsStack } from '../lib/infra_ecs-stack';

const app = new cdk.App();

new InfraEcsStack(app, 'InfraEcs-VPC', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  vpc: {
      exist: false
  },
  owner: 'veezor',
  repository: 'wordpress',
  dns: {
    domain: 'veezor.com'
  }
});

new InfraEcsStack(app, 'InfraEcs-Production', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  test: true,
  environment: 'staging',
  secrets: {
      production: {PORT: 3000},
      staging: {PORT: 3000}
  },
  vpc: {
      id: 'vpc-01cb8f6a256336cf8'
  },
  s3: {
      exist: false    // media<-staging>.example.com
  },
  owner: 'veezor',
  repository: 'wordpress',
  dns: {
      domain: 'veezor.com'
  }
});

new InfraEcsStack(app, 'InfraEcs-Staging', {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */

  test: false,
  environment: 'staging',
  secrets: {
      production: {PORT: 3000},
      staging: {PORT: 3000}
  },
  vpc: {
      id: 'vpc-01cb8f6a256336cf8'
  },
  s3: {
      exist: false    // media<-staging>.example.com
  },
  owner: 'veezor',
  repository: 'wordpress',
  dns: {
      domain: 'veezor.com'
  }
});
