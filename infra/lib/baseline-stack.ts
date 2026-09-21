import * as fs from 'node:fs';
import * as path from 'node:path';

import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwInteg from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

const BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');

/** Haiku-class model. Bedrock ids carry an `anthropic.` prefix. */
const DEFAULT_MODEL_ID = 'anthropic.claude-haiku-4-5';

/** Spec: 10 requests/second, burst 20. */
const RATE_LIMIT = 10;
const BURST_LIMIT = 20;

const LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;

export class BaselineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const modelId = (this.node.tryGetContext('modelId') as string) ?? DEFAULT_MODEL_ID;
    // Optional: an address for the budget and error alarms. Deliberately not
    // hardcoded — no contact details belong in a public repo.
    const alertEmail = this.node.tryGetContext('alertEmail') as string | undefined;
    const monthlyBudgetUsd = Number(this.node.tryGetContext('monthlyBudgetUsd') ?? 20);

    // ---------------------------------------------------------------- data

    const table = new dynamodb.Table(this, 'Reports', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Reports delete themselves after 90 days; storage.py sets the value.
      timeToLiveAttribute: 'expires_at',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Reports are disposable by design, and this is a demo stack — but the
      // deletion still has to be a deliberate act, not a side effect.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ------------------------------------------------------------- lambdas

    // Only the application package ships. Tests and caches would otherwise
    // land in the deployment artifact.
    const backendCode = lambda.Code.fromAsset(BACKEND_DIR, {
      exclude: [
        'tests',
        'conftest.py',
        'pytest.ini',
        'requirements-dev.txt',
        '**/__pycache__',
        '.pytest_cache',
      ],
    });

    const commonEnv = {
      TABLE_NAME: table.tableName,
      LOG_LEVEL: 'INFO',
      POWERTOOLS_SERVICE_NAME: 'baseline',
    };

    const createFn = new lambda.Function(this, 'CreateAssessmentFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'baseline.handlers.create_handler',
      code: backendCode,
      // Bedrock is the slow part; 30s leaves room without stranding a user.
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: { ...commonEnv, BEDROCK_MODEL_ID: modelId },
      logGroup: new logs.LogGroup(this, 'CreateAssessmentLogs', {
        retention: LOG_RETENTION,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const getFn = new lambda.Function(this, 'GetAssessmentFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'baseline.handlers.get_handler',
      code: backendCode,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: commonEnv,
      logGroup: new logs.LogGroup(this, 'GetAssessmentLogs', {
        retention: LOG_RETENTION,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // --------------------------------------------------- least-privilege IAM

    // Not grantWriteData(): that would also hand over UpdateItem, DeleteItem
    // and the batch calls. The create path only ever puts.
    createFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [table.tableArn],
      }),
    );
    getFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [table.tableArn],
      }),
    );

    createFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: this.bedrockModelArns(modelId),
      }),
    );

    // ----------------------------------------------------------------- api

    const httpApi = new apigw.HttpApi(this, 'Api', {
      description: 'Baseline assessment API',
      // No CORS block: CloudFront serves the API on the same origin as the
      // app, so the browser never makes a cross-origin request. The Lambda
      // omits the allow-origin header unless ALLOWED_ORIGIN is set, which
      // means an unconfigured deployment denies cross-origin rather than
      // allowing it.
      createDefaultStage: false,
    });

    httpApi.addRoutes({
      path: '/assessments',
      methods: [apigw.HttpMethod.POST],
      integration: new apigwInteg.HttpLambdaIntegration('CreateInteg', createFn),
    });
    httpApi.addRoutes({
      path: '/assessments/{id}',
      methods: [apigw.HttpMethod.GET],
      integration: new apigwInteg.HttpLambdaIntegration('GetInteg', getFn),
    });

    const apiLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: LOG_RETENTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const stage = new apigw.HttpStage(this, 'DefaultStage', {
      httpApi,
      autoDeploy: true,
      stageName: '$default',
      throttle: { rateLimit: RATE_LIMIT, burstLimit: BURST_LIMIT },
    });

    // Access logging is not exposed on HttpStage's L2 props yet.
    (stage.node.defaultChild as apigw.CfnStage).accessLogSettings = {
      destinationArn: apiLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        ip: '$context.identity.sourceIp',
        requestTime: '$context.requestTime',
        routeKey: '$context.routeKey',
        status: '$context.status',
        responseLatency: '$context.responseLatency',
        integrationStatus: '$context.integrationStatus',
      }),
    };

    // ------------------------------------------------------- site + delivery

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      // Origin Access Control only; nothing is reachable directly.
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Baseline security headers',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          // connect-src can stay on 'self' because the API is served through
          // this same distribution.
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self'",
            "connect-src 'self'",
            "form-action 'none'",
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "object-src 'none'",
            'upgrade-insecure-requests',
          ].join('; '),
        },
        strictTransportSecurity: {
          override: true,
          accessControlMaxAge: cdk.Duration.days(730),
          includeSubdomains: true,
          preload: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cloudfront.HeadersFrameOption.DENY },
        referrerPolicy: {
          override: true,
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        },
      },
    });

    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
    );

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Baseline',
      defaultRootObject: 'index.html',
      // No minimumProtocolVersion here: it only takes effect with a custom
      // certificate, and this stack uses the default *.cloudfront.net one.
      // Setting it would imply a control that is not actually applied.
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
      },
      additionalBehaviors: {
        // Same-origin API. Keeps CSP tight and removes CORS from the picture.
        'assessments*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
          compress: true,
        },
      },
      // The report page is a client-side route, so unknown paths must return
      // the app rather than an S3 error document.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // Ship gate: the stack deploys a working public URL before the frontend
    // exists. Once `npm run build` has produced frontend/dist, that is what
    // gets uploaded instead.
    const haveFrontend = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: haveFrontend
        ? [s3deploy.Source.asset(FRONTEND_DIST)]
        : [s3deploy.Source.data('index.html', placeholderPage())],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    // --------------------------------------------------------- observability

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Baseline alarms',
    });
    if (alertEmail) {
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    }

    const lambdaErrors = new cloudwatch.MathExpression({
      expression: 'createErrors + getErrors',
      usingMetrics: {
        createErrors: createFn.metricErrors({ period: cdk.Duration.minutes(5) }),
        getErrors: getFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      },
      label: 'Lambda errors',
    });

    const errorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: lambdaErrors,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'A Baseline Lambda returned an error in the last 5 minutes.',
    });
    errorAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'Baseline',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Assessments started',
            left: [createFn.metricInvocations({ period: cdk.Duration.minutes(5) })],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Errors',
            left: [
              createFn.metricErrors({ period: cdk.Duration.minutes(5) }),
              getFn.metricErrors({ period: cdk.Duration.minutes(5) }),
            ],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Duration (p95)',
            left: [
              createFn.metricDuration({ statistic: 'p95', period: cdk.Duration.minutes(5) }),
              getFn.metricDuration({ statistic: 'p95', period: cdk.Duration.minutes(5) }),
            ],
            width: 8,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Reports stored / read',
            left: [
              table.metricConsumedWriteCapacityUnits({ period: cdk.Duration.minutes(5) }),
              table.metricConsumedReadCapacityUnits({ period: cdk.Duration.minutes(5) }),
            ],
            width: 12,
          }),
          new cloudwatch.SingleValueWidget({
            title: 'Throttled requests (API)',
            metrics: [
              new cloudwatch.Metric({
                namespace: 'AWS/ApiGateway',
                metricName: '4xx',
                dimensionsMap: { ApiId: httpApi.apiId },
                statistic: 'Sum',
                period: cdk.Duration.hours(1),
              }),
            ],
            width: 12,
          }),
        ],
      ],
    });

    // ------------------------------------------------------- cost guardrail

    if (alertEmail) {
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: 'baseline-monthly',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: monthlyBudgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
          },
        ],
      });
    }

    // --------------------------------------------------------------- outputs

    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'The public URL for Baseline',
    });
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'Direct API endpoint (the app calls it through CloudFront)',
    });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'BedrockModelId', { value: modelId });
    new cdk.CfnOutput(this, 'FrontendDeployed', {
      value: haveFrontend ? 'built' : 'placeholder (run npm run build in frontend/)',
    });
    if (!alertEmail) {
      new cdk.CfnOutput(this, 'AlertsNote', {
        value:
          'No alertEmail in context: budget and alarm emails are off. ' +
          'Redeploy with -c alertEmail=you@example.com to enable them.',
      });
    }
  }

  /**
   * The exact model resources this Lambda may invoke — never a wildcard.
   *
   * A plain `anthropic.*` id is a foundation model in this region. An id
   * prefixed with a region group (`us.`) is a cross-region inference profile,
   * which needs both the profile and the underlying foundation models in
   * every region the profile can route to.
   */
  private bedrockModelArns(modelId: string): string[] {
    const crossRegion = /^(us|eu|apac)\./.exec(modelId);
    if (!crossRegion) {
      return [`arn:${this.partition}:bedrock:${this.region}::foundation-model/${modelId}`];
    }
    const baseModel = modelId.slice(crossRegion[1].length + 1);
    const regions: Record<string, string[]> = {
      us: ['us-east-1', 'us-east-2', 'us-west-2'],
      eu: ['eu-central-1', 'eu-west-1', 'eu-west-3', 'eu-north-1'],
      apac: ['ap-northeast-1', 'ap-northeast-2', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2'],
    };
    return [
      `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${modelId}`,
      ...regions[crossRegion[1]].map(
        (r) => `arn:${this.partition}:bedrock:${r}::foundation-model/${baseModel}`,
      ),
    ];
  }
}

/** Shown only until the real frontend is built — proves the URL is live. */
function placeholderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Baseline</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         background:#0f172a; color:#e2e8f0; text-align:center; padding:24px; }
  h1 { font-size:clamp(1.75rem,5vw,2.5rem); margin:0 0 .5rem; }
  p  { color:#94a3b8; max-width:34rem; line-height:1.6; margin:0 auto; }
  code { background:#1e293b; padding:.15rem .4rem; border-radius:.25rem; }
</style>
</head>
<body>
  <main>
    <h1>Baseline</h1>
    <p>Infrastructure is live. The cyber readiness check is being deployed here —
       run <code>npm run build</code> in <code>frontend/</code> and redeploy.</p>
  </main>
</body>
</html>`;
}
