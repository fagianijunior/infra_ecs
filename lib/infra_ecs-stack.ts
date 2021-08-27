import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns";
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as logs from '@aws-cdk/aws-logs';
import {project} from "./project-config";
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';

export class InfraEcsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    let ecsLogGroup;
    let ecsLogGroups:any = {};
    let subnetsArns:any = [];
    let ecrRepository;
    let assetsBucket;
    let bucketsArns:string[] = [];
    let bucketName;
    let ecrRepositories:any = {};
    let taskDefinition;
    let loadBalancerFargateService;
    let secrets;

    
    // Set project TAGS
    cdk.Tags.of(this).add('Project', project.repository);
    cdk.Tags.of(this).add('Env', 'production-staging');
    
    // Create log goups
    const codeBuildLogGroup = new logs.LogGroup(this, 'CreateCloudWatchcodeBuildLogGroup', {
      logGroupName: `/aws/codebuild/${project.owner}-${project.repository}-image-build`,
      removalPolicy: project.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    });

    for (let environment of project.environments) {
      ecsLogGroup = new logs.LogGroup(this, `CreateCloudWatchEcsLogGroup-${environment}`, {
        logGroupName: `/ecs/${project.owner}-${project.repository}-${environment}-web`,
        removalPolicy: project.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      });
      ecsLogGroups[environment] = ecsLogGroup;
    }
    
    // Use github repository
    const gitHubSource = codebuild.Source.gitHub({
      owner: project.owner,
      repo: project.repository
    });

    // Use existing VPC
    const vpc = ec2.Vpc.fromLookup(this, 'UseDefaultVPC', {
      isDefault: true,
    });
    
    const vpcSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE
    });

    for (let subnet of vpcSubnets.subnets) {
      subnetsArns.push(`arn:aws:ec2:${this.region}:${this.account}:subnet/${subnet.subnetId}`)
    }

    // Create polices and role
    const codeBuildManagedPolicies = new iam.ManagedPolicy(this, 'CreateCodeBuildPolicy', {
      managedPolicyName: `CodeBuild-${project.owner}-${project.repository}`,
      statements: [
        new iam.PolicyStatement({
          sid: "ManageECR",
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "ecr:CompleteLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:InitiateLayerUpload",
            "ecr:BatchCheckLayerAvailability",
            "ecr:PutImage"
          ],
          resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/*`]
        }),
        new iam.PolicyStatement({
          sid: "GetECRAuthorizedToken",
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr:GetAuthorizationToken"
          ],
          resources: ["*"]
        }),
        new iam.PolicyStatement({
          sid: "ManageSecretValue",
          effect: iam.Effect.ALLOW,
          actions: ["secretsmanager:GetSecretValue"],
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`]
        }),
        new iam.PolicyStatement({
          sid: "ManageLogsOnCloudWatch",
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: [
            codeBuildLogGroup.logGroupArn,
            `${codeBuildLogGroup.logGroupArn}:*`
          ]
        }),
        new iam.PolicyStatement({
          sid: "ManageS3Bucket",
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:PutObject",
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:GetBucketAcl",
            "s3:GetBucketLocation"
          ],
          resources: [
            "arn:aws:s3:::codepipeline-us-east-1-*"
          ]
        }),
        new iam.PolicyStatement({
          sid: "ManageCodebuild",
          effect: iam.Effect.ALLOW,
          actions: [
            "codebuild:CreateReportGroup",
            "codebuild:CreateReport",
            "codebuild:UpdateReport",
            "codebuild:BatchPutTestCases",
            "codebuild:BatchPutCodeCoverages"
          ],
          resources: [
            `arn:aws:codebuild:${this.region}:${this.account}:report-group/${project.owner}-${project.repository}-image-build-*`
          ]
        }),
        new iam.PolicyStatement({
          sid: "ManageEC2VPC",
          effect: iam.Effect.ALLOW,
          actions: [
            "ec2:CreateNetworkInterface",
            "ec2:DescribeDhcpOptions",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DeleteNetworkInterface",
            "ec2:DescribeSubnets",
            "ec2:DescribeSecurityGroups",
            "ec2:DescribeVpcs"
          ],
          resources: [
            "*"
          ]
        }),
        new iam.PolicyStatement({
          sid: "ManageEC2NetworkInterface",
          effect: iam.Effect.ALLOW,
          actions: [
            "ec2:CreateNetworkInterfacePermission"
          ],
          resources: [
            `arn:aws:ec2:${this.region}:${this.account}:network-interface/*`
          ],
          conditions: {
            StringEquals: {
              "ec2:Subnet": subnetsArns,
              "ec2:AuthorizedService": "codebuild.amazonaws.com"
            }
          }
        })
      ]
    });

    const codeBuildProjectRole = new iam.Role(this, 'CreateCodeBuildProjectRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      roleName: `${project.owner}-${project.repository}-image-build-service-role`,
      path: '/service-role/',
      managedPolicies: [
        codeBuildManagedPolicies
      ]
    });

    for (let environment of project.environments) {
      secrets = new secretsmanager.Secret(this, `CreateSecrets-${environment}`, {
        secretName: `${environment}/${project.owner}-${project.repository}`,
        description: `Used to project ${project.repository}-${environment}`,
        removalPolicy: project.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN

      });
      secrets.grantRead(codeBuildProjectRole);
      secrets.secretValueFromJson(
        JSON.stringify(project['secrets'][environment as 'production'|'staging'])
      );
    }

    // Crate security group
    const securityGroup = new ec2.SecurityGroup(this, 'CreateCodeDeploySecurityGroup', {
      securityGroupName: `${project.repository}-sg`,
      allowAllOutbound: true,
      vpc: vpc,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3306));

    // Create the codebuild project
    const codeBuildProject = new codebuild.Project(this, 'CreateCodeBuildProject', {
      projectName: `${project.owner}-${project.repository}-image-build`,
      description: `Build to project ${project.repository}, source from github, deploy to ECS fargate.`,
      source: gitHubSource,
      role: codeBuildProjectRole,
      securityGroups: [securityGroup],
      environment: {
        buildImage: codebuild.LinuxBuildImage.fromDockerRegistry('public.ecr.aws/h4u2q3r3/aws-codebuild-cloud-native-buildpacks'),
        privileged: true,
      },
      vpc: vpc,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('.aws/codebuild/buildspec.yml'),
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER, codebuild.LocalCacheMode.SOURCE),
      logging: {
        cloudWatch: {
          enabled: true,
          logGroup: codeBuildLogGroup
        }
      }
    });

    for(let environment of project.environments) {
      bucketName = s3BucketName(environment);
      
      if(project.s3.exist) {
        assetsBucket = s3.Bucket.fromBucketAttributes(this, `UseAlreadyCreatedBucket-${environment}`, {
          bucketArn: `arn:aws:s3:::${bucketName}`
        });
      } else {
        assetsBucket = new s3.Bucket(this, `CreateMediaBucket-${environment}`, {
          bucketName: bucketName,
          blockPublicAccess: new s3.BlockPublicAccess({
            blockPublicAcls: false,
            blockPublicPolicy: false,
            ignorePublicAcls: false,
          }),
          removalPolicy: project.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
        });
   
        assetsBucket.addToResourcePolicy(
          new iam.PolicyStatement({
            sid: "PublicReadForGetBucketObjects",
            actions: ["s3:GetObject"],
            resources: [assetsBucket.arnForObjects('*')],
            principals: [new iam.AnyPrincipal()],
            effect: iam.Effect.ALLOW,
          })
        );
      }
      bucketsArns.push(assetsBucket.bucketArn);
      bucketsArns.push(`${assetsBucket.bucketArn}/*`);
    }

    const iamUser = new iam.User(this, 'CreateIAMUser', {
      userName: `apps-${project.repository}`,
    });

    iamUser.attachInlinePolicy(
      new iam.Policy(this, 'CreatePolicytoS3Bucket', {
        policyName: 'resources-to-application',
        statements: [ 
          new iam.PolicyStatement({
            sid: "S3BucketPermissions",
            effect: iam.Effect.ALLOW,
            actions: [
              "s3:PutObject",
              "s3:GetObjectAcl",
              "s3:GetObject",
              "s3:ListBucketMultipartUploads",
              "s3:AbortMultipartUpload",
              "s3:ListBucket",
              "s3:DeleteObject",
              "s3:GetBucketAcl",
              "s3:GetBucketLocation",
              "s3:GetBucketPolicy",
              "s3:PutObjectAcl",
              "s3:ListMultipartUploadParts"
            ],
            resources: bucketsArns,
          }),
          new iam.PolicyStatement({
            sid: 'VisualEditor0',
            effect: iam.Effect.ALLOW,
            actions: [
              "iam:PassRole",
              "ecr:GetDownloadUrlForLayer",
              "ecr:UploadLayerPart",
              "ecr:ListImages",
              "ecr:PutImage",
              "ecr:BatchGetImage",
              "ecr:CompleteLayerUpload",
              "ecr:DescribeRepositories",
              "ecr:InitiateLayerUpload",
              "ecr:BatchCheckLayerAvailability",
              "ecr:GetRepositoryPolicy"
            ],
            resources: [
              `arn:aws:iam::${this.account}:role/*`,
              `arn:aws:ecr:${this.region}:${this.account}:repository/${project.owner}-${project.repository}-*`
            ]
          }),
          new iam.PolicyStatement({
            sid: 'VisualEditor2',
            effect: iam.Effect.ALLOW,
            actions: [
              "ecs:UpdateCluster",
              "ecs:UpdateService",
              "ses:*",
              "logs:*",
              "ecs:RegisterTaskDefinition",
              "ecr:GetAuthorizationToken",
              "ecs:DescribeServices",
              "codebuild:*"
            ],
            resources: ["*"]
          }),
          new iam.PolicyStatement({
            sid: 'VisualEditor3',
            effect: iam.Effect.ALLOW,
            actions: [
              "secretsmanager:GetRandomPassword",
              "secretsmanager:ListSecrets"
            ],
            resources: ["*"]
          }),
          new iam.PolicyStatement({
            sid: 'VisualEditor4',
            effect: iam.Effect.ALLOW,
            actions: ["secretsmanager:*"],
            resources: [
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`
            ]
          })
        ]
      })
    );

    for(let environment of project.environments) {
      ecrRepository = new ecr.Repository(this, `CreateNewECRRepository-${environment}`, {
        repositoryName: `${project.owner}-${project.repository}-${environment}`,
        removalPolicy: project.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
      });
      ecrRepositories[environment] = ecrRepository;
    }

    const cluster = new ecs.Cluster(this, 'CreateCluster', {
      clusterName: project.repository,
      vpc: vpc,
    });
    
    const taskRole = new iam.Role(this, 'CreateTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `${project.owner}-${project.repository}-service-role`
    });

    const executionRolePolicies = new iam.ManagedPolicy(this, 'CreateExecutionRolePolicy', {
      managedPolicyName: `Execution-Policies-${project.owner}-${project.repository}`,
      statements: [
        new iam.PolicyStatement({
          sid: "ManageECR",
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "ecr:CompleteLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:InitiateLayerUpload",
            "ecr:BatchCheckLayerAvailability",
            "ecr:PutImage"
          ],
          resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/*`]
        }),
        new iam.PolicyStatement({
          sid: "GetECRAuthorizedToken",
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr:GetAuthorizationToken",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: ["*"]
        }),
        new iam.PolicyStatement({
          sid: "ManageLogsOnCloudWatch",
          effect: iam.Effect.ALLOW,
          actions: [
            "autoscaling:Describe*",
            "cloudwatch:*",
            "logs:*",
            "sns:*",
            "iam:GetPolicy",
            "iam:GetPolicyVersion",
            "iam:GetRole"
          ],
          resources: ['*']
        }),
        new iam.PolicyStatement({
          sid: "ManageS3Bucket",
          effect: iam.Effect.ALLOW,
          actions: [
            "iam:CreateServiceLinkedRole"
          ],
          resources: [
            "arn:aws:iam::*:role/aws-service-role/events.amazonaws.com/AWSServiceRoleForCloudWatchEvents*"
          ],
          conditions: {
              StringLike: {
                "iam:AWSServiceName": "events.amazonaws.com"
              }
          }
        }),
        new iam.PolicyStatement({
          sid: "ManageSecretValue",
          effect: iam.Effect.ALLOW,
          actions: ["secretsmanager:GetSecretValue"],
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`]
        })
      ]
    });

    const executionRole = new iam.Role(this, 'CreateExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: 'ecsTaskExecutionRole',
      managedPolicies: [
        executionRolePolicies
      ]
    });

    for(let environment of project.environments) {
      taskDefinition = new ecs.FargateTaskDefinition(this, `CreateTaskDefinition-${environment}`, {
        family: `${project.owner}-${project.repository}-${environment}-web`,
        memoryLimitMiB: 512,
        cpu: 256,
        taskRole: taskRole,
        executionRole: executionRole,
      });
      
      taskDefinition.addContainer(`${project.owner}-${project.repository}-${environment}`, {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepositories[environment]),
        memoryLimitMiB: 512,
        logging: new ecs.AwsLogDriver({
          streamPrefix: "ecs",
          logGroup: ecsLogGroups[environment]
        }),
        environment: {environment: environment},
        portMappings: [{
          hostPort: 3000,
          protocol: ecs.Protocol.TCP,
          containerPort: 3000,
        }]
      });

      loadBalancerFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, `CreatLoadBalancer-${environment}`, {
        cluster: cluster,
        serviceName: `${project.repository}-${environment}-web`,
        desiredCount: 1,
        publicLoadBalancer: true,
        taskDefinition: taskDefinition,
        assignPublicIp: true,
        loadBalancerName: `${project.repository}-${environment}-lb`,
        securityGroups: [securityGroup]
      });
  
      loadBalancerFargateService.targetGroup.configureHealthCheck({
        path: "/health_check",
      });
    };

    // Functions
    function s3BucketName(environment:string) {
      if (environment == 'production') {
        return `media.${project.dns.domain}`;
      }

      return `media-${environment}.${project.dns.domain}`;
    }
  }
}