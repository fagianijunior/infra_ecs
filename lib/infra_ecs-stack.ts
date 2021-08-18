import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import {project} from "./project-config";
import * as ecr from '@aws-cdk/aws-ecr';
import * as iam from '@aws-cdk/aws-iam';
import { LogGroup } from '@aws-cdk/aws-logs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as kms from '@aws-cdk/aws-kms';

export class InfraEcsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const codeBuildLogGroup = new LogGroup(this, 'CreateCloudWatchcodeBuildLogGroup', {
      logGroupName: `/aws/codebuild/${project.owner}-${project.repository}-image-build`,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const ecsLogGroup = new LogGroup(this, 'CreateCloudWatchEcsLogGroup', {
      logGroupName: `/ecs/${project.owner}-${project.repository}-web`,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    
    const ecrRepository = new ecr.Repository(this, 'public.ecr.aws/h4u2q3r3/aws-codebuild-cloud-native-buildpacks');
    
    const gitHubSource = codebuild.Source.gitHub({
      owner: project.owner,
      repo: project.repository
    });

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

    const vpc = ec2.Vpc.fromLookup(this, 'UseDefaultVPC', {
      isDefault: true,
    });

    const codeDeploySecurityGroup = new ec2.SecurityGroup(this, 'CreateCodeDeploySecurityGroup', {
      securityGroupName: `${project.repository}`,
      allowAllOutbound: true,
      vpc: vpc
    }).addIngressRule( ec2.Peer.anyIpv4(), ec2.Port.tcp(3306));

    const codeBuildProject = new codebuild.Project(this, 'CreateCodeBuildProject', {
      projectName: `${project.owner}-${project.repository}-image-build`,
      description: `Build to project ${project.repository}, source from github, deploy to ECS fargate.`,
      source: gitHubSource,
      role: codeBuildProjectRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.fromEcrRepository(ecrRepository, 'latest'),
        privileged: true,
      },
      vpc: vpc,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('.aws/codebuild/buildspec.yml'),
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER, codebuild.LocalCacheMode.SOURCE),
      logging: {
        cloudWatch: {
          enabled: true,
        }
      }
    });

    cdk.Tags.of(this).add('Project', project.repository);
    cdk.Tags.of(this).add('Env', project.environment);
  }
}