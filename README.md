# EcsStack. It will setup an application with below resources.
* Codebuild
* Application Load Balancer
* Secrets Manager
* Bucket S3
* CloudWatch Log groups
* ECR repository
* IAM User, roles and policies
* ECS cluster with fargate tasks
* VPC

## The application architecture is as below.
coming soon...

## You can customize the application by creating and modifying parameters in lib/project-config.ts
```
export const project = {
    test: true,                     // 'true' Will create resources without deletion protection
    environment: 'staging',
    secrets: {
        production: {PORT: 3000},   // Initial data to secretsmanager
        staging: {PORT: 3000}
    },
    vpc: {
        exist: false,
        id: ''                      // If VPC already exist, insert VPC id here
    },
    s3: {
        exist: false                // 'False', If you want to create s3 buckets
    },
    owner: 'fagianijunior',         // Same as Github owner
    repository: 'wordpress',        // Same as Github repository name
    dns: {
        domain: 'fagianijunior.com.br'
    }
}
```

## How to use this project.
```
* # Change values on lib/project-config.ts
* cdk synth                                         # Synthesize all templates to cdk.out
* cdk deploy --app 'cdk.out/' InfraEcs-VPC          # Deploy first the VPC if not exist yet
* use the VPC id on Props of Staging and Production
* cdk deploy --app 'cdk.out/' InfraEcs-Staging      # Deploy staging if needed, remember to change lib/project-config.ts before.
* cdk deploy --app 'cdk.out/' InfraEcs-Production   # Deploy production, remember to change lib/project-config.ts before.
```

## Useful commands
 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template