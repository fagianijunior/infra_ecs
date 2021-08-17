import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as InfraEcs from '../lib/infra_ecs-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new InfraEcs.InfraEcsStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
