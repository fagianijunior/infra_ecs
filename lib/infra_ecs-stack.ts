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

interface InfraEcsProps extends cdk.StackProps {
  readonly test?: boolean;
  readonly environment?: string | null;
  readonly secrets?: {
    production: {
      PORT: number
    },
    staging: {
      PORT: number
    }
  };
  readonly vpc: {
    exist?: boolean,
    id?: string
  };
  readonly s3?: {
    exist: boolean
  };
  readonly owner: string;
  readonly repository: string;
  readonly dns: {
    domain: string
  };
}


export class InfraEcsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: InfraEcsProps) {
    super(scope, id, props);
    
    let ecsLogGroup;
    let subnetsArns:any = [];
    let ecrRepository;
    let assetsBucket;
    let bucketsArns:string[] = [];
    let bucketName;
    let ecrRepositories:any = {};
    let taskDefinition;
    let loadBalancerFargateService;
    let secrets;
    let vpc;
    
    cdk.Tags.of(this).add('Project', `${props.repository}`);

    if(props.vpc.exist == false) {
      vpc = new ec2.Vpc(this, `${props.owner}-vpc`, {
        cidr: '10.0.0.0/16',
        enableDnsHostnames: true,
        enableDnsSupport: true,
        subnetConfiguration: [
          {
            cidrMask: 24,
            name: `public`,
            subnetType: ec2.SubnetType.PUBLIC,
          },
          {
            cidrMask: 24,
            name: `private`,
            subnetType: ec2.SubnetType.PRIVATE,
          },
          {
            cidrMask: 28,
            name: `isolated`,
            subnetType: ec2.SubnetType.ISOLATED,
          }
        ]
      });
      return;
    }

    cdk.Tags.of(this).add('Env', `${props.environment}`);
    
    const codeBuildLogGroup = new logs.LogGroup(this, `CreateCloudWatchcodeBuildLogGroup-${props.environment}`, {
      logGroupName: `/aws/codebuild/${props.owner}-${props.repository}-${props.environment}-image-build`,
      removalPolicy: props.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    });

    ecsLogGroup = new logs.LogGroup(this, `CreateCloudWatchEcsLogGroup-${props.environment}`, {
      logGroupName: `/ecs/${props.owner}-${props.repository}-${props.environment}-web`,
      removalPolicy: props.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });
    
    const gitHubSource = codebuild.Source.gitHub({
      owner: props.owner,
      repo: props.repository
    });

    vpc = ec2.Vpc.fromLookup(this, 'UseExistingVPC', {
      vpcId: props.vpc.id
    });

    const vpcSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE
    });

    for (let subnet of vpcSubnets.subnets) {
      subnetsArns.push(`arn:aws:ec2:${this.region}:${this.account}:subnet/${subnet.subnetId}`)
    }

    const codeBuildManagedPolicies = new iam.ManagedPolicy(this, `CreateCodeBuildPolicy-${props.environment}`, {
      managedPolicyName: `CodeBuild-${props.owner}-${props.repository}-${props.environment}`,
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
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${props.environment}/${props.owner}-${props.repository}*`
          ]
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
            "s3:GetBucketLocation",
            "s3:PutObject"
          ],
          resources: [
            "arn:aws:s3:::*",
            "arn:aws:s3:::*/*"
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
            `arn:aws:codebuild:${this.region}:${this.account}:report-group/${props.owner}-${props.repository}-${props.environment}-image-build-*`
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

    const codeBuildProjectRole = new iam.Role(this, `CreateCodeBuildProjectRole-${props.environment}`, {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      roleName: `${props.owner}-${props.repository}-${props.environment}-image-build-service-role`,
      path: '/service-role/',
      managedPolicies: [
        codeBuildManagedPolicies
      ]
    });

    secrets = new secretsmanager.Secret(this, `CreateSecrets-${props.environment}`, {
      secretName: `${props.environment}/${props.owner}-${props.repository}`,
      description: `Used to project ${props.repository}-${props.environment}`,
      removalPolicy: props.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    });
    secrets.grantRead(codeBuildProjectRole);

    const securityGroup = new ec2.SecurityGroup(this, `CreateCodeDeploySecurityGroup-${props.environment}`, {
      securityGroupName: `${props.repository}-${this.environment}-sg`,
      allowAllOutbound: false,
      vpc: vpc
    });
    
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3306));
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTcp());

    const codeBuildProject = new codebuild.Project(this, `CreateCodeBuildProject-${props.environment}`, {
      projectName: `${props.owner}-${props.repository}-${props.environment}-image-build`,
      description: `Build to project ${props.repository} on ${props.environment}, source from github, deploy to ECS fargate.`,
      badge: true,
      source: gitHubSource,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('.aws/codebuild/buildspec.yml'),
      role: codeBuildProjectRole,
      securityGroups: [securityGroup],
      environment: {
        buildImage: codebuild.LinuxBuildImage.fromDockerRegistry('public.ecr.aws/h4u2q3r3/aws-codebuild-cloud-native-buildpacks:l2'),
        privileged: true
      },
      vpc: vpc,
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER, codebuild.LocalCacheMode.SOURCE),
      logging: {
        cloudWatch: {
          enabled: true,
          logGroup: codeBuildLogGroup
        }
      }
    });

    bucketName = s3BucketName(`${props.environment}`);
    
    if(props.s3?.exist == true) {
      assetsBucket = s3.Bucket.fromBucketAttributes(this, `UseAlreadyCreatedBucket-${props.environment}`, {
        bucketArn: `arn:aws:s3:::${bucketName}`
      });
    } else {
      assetsBucket = new s3.Bucket(this, `CreateMediaBucket-${props.environment}`, {
        bucketName: bucketName,
        blockPublicAccess: new s3.BlockPublicAccess({
          blockPublicAcls: false,
          blockPublicPolicy: false,
          ignorePublicAcls: false,
        }),
        removalPolicy: props.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
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

    const iamUser = new iam.User(this, `CreateIAMUser-${props.environment}`, {
      userName: `${props.repository}-${props.environment}`,
    });

    iamUser.attachInlinePolicy(
      new iam.Policy(this, `accessToS3BucketFrontend-${props.environment}`, {
        policyName: `access-to-s3-bucket-fronend-${props.environment}`,
        statements: [ 
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "s3:PutObject",
              "s3:ListBucket",
              "s3:DeleteObject",
              "s3:PutObjectAcl"
            ],
            resources: bucketsArns,
          }),
        ]
      })
    );

    iamUser.attachInlinePolicy(
      new iam.Policy(this, `appsManageS3MediaApi-${props.environment}`, {
        policyName: `apps-manage-s3-media-api--${props.environment}`,
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "s3:ListBucket"
            ],
            resources: bucketsArns,
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "s3:ListBucket"
            ],
            resources: bucketsArns,
            conditions: {
              "StringLike": {
                "s3:prefix": "*"
              }
            }
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "s3:ListBucketMultipartUploads",
              "ecr:GetDownloadUrlForLayer",
              "s3:ListBucket",
              "ecr:UploadLayerPart",
              "s3:GetBucketAcl",
              "ecr:ListImages",
              "s3:GetBucketPolicy",
              "s3:ListMultipartUploadParts",
              "ecr:PutImage",
              "s3:PutObject",
              "s3:GetObjectAcl",
              "s3:GetObject",
              "iam:PassRole",
              "secretsmanager:GetSecretValue",
              "s3:AbortMultipartUpload",
              "ecr:BatchGetImage",
              "ecr:CompleteLayerUpload",
              "ecr:DescribeRepositories",
              "s3:DeleteObject",
              "s3:GetBucketLocation",
              "ecr:InitiateLayerUpload",
              "s3:PutObjectAcl",
              "ecr:BatchCheckLayerAvailability",
              "ecr:GetRepositoryPolicy"
            ],
            resources: [
              bucketsArns[0],
              bucketsArns[1],
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
              `arn:aws:iam::${this.account}:role/*`,
              `arn:aws:ecr:${this.region}:${this.account}:repository/money-times-api_moneytimes-*`
            ]
          }),
          new iam.PolicyStatement({
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
            resources: [
              "*"
            ]
          })
        ]
      })
    )

    iamUser.attachInlinePolicy(
      new iam.Policy(this, `MoneyTimesApiMoneytimesSecretmanager-${props.environment}`, {
        policyName: `Money-Times-api_moneytimes-secretmanager-${props.environment}`,
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "secretsmanager:GetRandomPassword",
              "secretsmanager:ListSecrets"
            ],
            resources: [
              "*"
            ]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "secretsmanager:*"
            ],
            resources: [
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`
            ]
          }),
        ]
      })
    );

    ecrRepository = new ecr.Repository(this, `CreateNewECRRepository-${props.environment}`, {
      repositoryName: `${props.owner}-${props.repository}-${props.environment}`,
      removalPolicy: props.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    });

    const cluster = new ecs.Cluster(this, `CreateCluster-${props.environment}`, {
      clusterName: `${props.repository}-${props.environment}`,
      vpc: vpc,
    });
    
    const taskRole = new iam.Role(this, `CreateTaskRole-${props.environment}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `${props.owner}-${props.repository}-${props.environment}-service-role`
    });

    const executionRolePolicies = new iam.ManagedPolicy(this, `CreateExecutionRolePolicy-${props.environment}`, {
      managedPolicyName: `Execution-Policies-${props.owner}-${props.repository}-${props.environment}`,
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
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`
          ]
        })
      ]
    });

    const executionRole = new iam.Role(this, `CreateExecutionRole-${props.environment}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `ecsTaskExecutionRole-${props.environment}`,
      managedPolicies: [
        executionRolePolicies
      ]
    });

    taskDefinition = new ecs.FargateTaskDefinition(this, `CreateTaskDefinition-${props.environment}`, {
      family: `${props.owner}-${props.repository}-${props.environment}-web`,
      memoryLimitMiB: 512,
      cpu: 256,
      taskRole: taskRole,
      executionRole: executionRole,
    });
    
    taskDefinition.addContainer(`${props.owner}-${props.repository}-${props.environment}`, {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepository),

      containerName: `${props.owner}-${props.repository}`,
      
      memoryLimitMiB: 512,
      logging: new ecs.AwsLogDriver({
        streamPrefix: "ecs",
        logGroup: ecsLogGroup
      }),
      environment: {environment: `${props.environment}`},
      portMappings: [{
        hostPort: 3000,
        protocol: ecs.Protocol.TCP,
        containerPort: 3000,
      }]
    });

    loadBalancerFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, `CreatLoadBalancer-${props.environment}`, {
      cluster: cluster,
      serviceName: `${props.repository}-${props.environment}-web`,
      desiredCount: 1,
      publicLoadBalancer: true,
      taskDefinition: taskDefinition,
      assignPublicIp: true,
      loadBalancerName: `${props.repository.replace('_','-')}-${props.environment}-lb`,
      securityGroups: [securityGroup]
    });

    loadBalancerFargateService.targetGroup.configureHealthCheck({
      path: "/health_check",
    });

    function s3BucketName(environment:string) {
      if (environment == 'production') {
        return `media-${props.dns.domain}`;
      }

      return `media-${environment}.${props.dns.domain}`;
    }
  }
}
// Set project TAGS
// Create log goups
// Use github repository
// Use existing VPC
// Create polices and role
// Crate security group
// Create the codebuild project
// Functions