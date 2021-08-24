import {project} from "./project-config";
import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns";
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as s3 from '@aws-cdk/aws-s3';


export class InfraEcsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Set project TAGS
    cdk.Tags.of(this).add('Project', project.repository);
    cdk.Tags.of(this).add('Env', 'production-staging');
    
    // Create log goups
    const codeBuildLogGroup = new logs.LogGroup(this, 'CreateCloudWatchcodeBuildLogGroup', {
      logGroupName: `/aws/codebuild/${project.owner}-${project.repository}-image-build`,
      removalPolicy: project.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    });

    var ecsLogGroup;
    var ecsLogGroups: any = {};

    for (let environment of project.environments) {
      ecsLogGroup = new logs.LogGroup(this, `CreateCloudWatchEcsLogGroup-${environment}`, {
        logGroupName: `/ecs/${project.owner}-${project.repository}-${environment}-web`,
        removalPolicy: project.test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      });
      ecsLogGroups[environment] = ecsLogGroup;
    }
   
    // Use veezor ECR image
    const ecrBuildRepository = new ecr.Repository(this, 'public.ecr.aws/h4u2q3r3/aws-codebuild-cloud-native-buildpacks');
    
    // Use github repository
    const gitHubSource = codebuild.Source.gitHub({
      owner: project.owner,
      repo: project.repository
    });

    // Create polices and role
    const codeBuildManagedPolicies = new iam.ManagedPolicy(this, 'CreateCodeBuildPolicy', {
      managedPolicyName: `CodeBuild-${project.owner}-${project.repository}`
    });

    codeBuildManagedPolicies.addStatements(
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
      })
    );
    
    codeBuildManagedPolicies.addStatements(
      new iam.PolicyStatement({
        sid: "GetECRAuthorizedToken",
        effect: iam.Effect.ALLOW,
        actions: [
          "ecr:GetAuthorizationToken"
        ],
        resources: ["*"]
      })
    );

    codeBuildManagedPolicies.addStatements(
      new iam.PolicyStatement({
        sid: "ManageSecretValue",
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`]
      })
    );

    codeBuildManagedPolicies.addStatements(
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
      })
    );

    codeBuildManagedPolicies.addStatements(
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
      })
    );

    codeBuildManagedPolicies.addStatements(
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
      })
    );

    codeBuildManagedPolicies.addStatements(
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
      })
    );

    // Falta adicionar as subnets no stringEquals
    codeBuildManagedPolicies.addStatements(
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
            "ec2:AuthorizedService": "codebuild.amazonaws.com"
          }
        }
      })
    );

    const codeBuildProjectRole = new iam.Role (
      this,
      'CreateCodeBuildProjectRole', {
        assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
        roleName: `${project.owner}-${project.repository}-image-build-service-role`,
        path: '/service-role/',
        managedPolicies: [
          codeBuildManagedPolicies
        ]
      }
    );

    // Use existing VPC
    const vpc = ec2.Vpc.fromLookup(this, 'UseDefaultVPC', {
      isDefault: true,
    });

    // Crate security group
    const codeDeploySecurityGroup = new ec2.SecurityGroup(this, 'CreateCodeDeploySecurityGroup', {
      securityGroupName: `${project.repository}-sg`,
      allowAllOutbound: true,
      vpc: vpc,
    }).addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3306));

    // Create the codebuild project
    const codeBuildProject = new codebuild.Project(this, 'CreateCodeBuildProject', {
      projectName: `${project.owner}-${project.repository}-image-build`,
      description: `Build to project ${project.repository}, source from github, deploy to ECS fargate.`,
      source: gitHubSource,
      role: codeBuildProjectRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.fromEcrRepository(ecrBuildRepository, 'latest'),
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


    var iamUser;
    var ecrRepository;
    var assetsBucket;
    var bucketsArns: string[] = [];
    // if bucket exist
    //   assetsBucket = s3.Bucket.fromBucketAttributes(this, 'UseAlreadyCreatedBucket', {
      //     bucketArn: `arn:aws:s3:::${bucketName}`
      //   });
    for(let environment of project.environments) {
      var bucketName = s3BucketName(environment);

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
      
      bucketsArns.push(assetsBucket.bucketArn);
    }

    const iamUserPolicy = new iam.Policy(this, 'CreatePolicytoS3Bucket', {
      policyName: 'resources-to-application',
    });

    iamUserPolicy.addStatements(
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
      })
    );
    iamUserPolicy.addStatements(
      new iam.PolicyStatement({
        sid: 'SESPermissions',
        effect: iam.Effect.ALLOW,
        actions: ['ses:*'],
        resources: ['*']
      })
    );

    iamUser = new iam.User(this, 'CreateIAMUser', {
      userName: `apps-${project.repository}`,
    });

    iamUser.attachInlinePolicy(iamUserPolicy);

    var ecrRepositories: any = {}

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

    let taskDefinition;

    for(let environment of project.environments) {
      taskDefinition = new ecs.FargateTaskDefinition(this, `CreateTaskDefinition-${environment}`, {
        family: `${project.owner}-${project.repository}-${environment}-web`,
        memoryLimitMiB: 512,
        cpu: 256,
      });
  
      taskDefinition.addContainer(`${project.owner}-${project.repository}-${environment}`, {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepositories[environment]),
        memoryReservationMiB: 512,
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

      const loadBalancerFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, `CreatLoadBalancer-${environment}`, {
        cluster: cluster,
        serviceName: `${project.repository}-${environment}-web`,
        desiredCount: 1,
        publicLoadBalancer: true,
        taskDefinition: taskDefinition,
        assignPublicIp: true,
        loadBalancerName: `${project.repository}-${environment}-lb`,
      });
  
      loadBalancerFargateService.targetGroup.configureHealthCheck({
        path: "/health_check",
      });
    }
    

    // Functions
    function s3BucketName(environment: string) {
      if (environment == 'production') {
        return `media.${project.dns.domain}`;
      }

      return `media-${environment}.${project.dns.domain}`;
    }
  }
}