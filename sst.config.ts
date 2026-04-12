/// <reference path="./.sst/platform/config.d.ts" />

const SECRET_ARN =
  "arn:aws:secretsmanager:us-west-2:915209469707:secret:my-family-photos/secrets-DC3MUq";

export default $config({
  app(input) {
    return {
      name: "family-photos",
      home: "aws",
      providers: {
        aws: {
          region: "us-west-2",
        },
      },
    };
  },

  async run() {
    const uploadsBucketName = process.env.S3_BUCKET_NAME;
    const photosTableName = process.env.DYNAMO_TABLE_NAME;

    if (!uploadsBucketName || !photosTableName) {
      throw new Error(
        "Missing env vars. Set S3_BUCKET_NAME and DYNAMO_TABLE_NAME before deploying."
      );
    }

    const uploads = new sst.aws.Bucket("ExistingUploadsBucket", {
      access: "cloudfront",
      transform: {
        bucket: (args, opts) => {
          args.bucket = uploadsBucketName;
          args.forceDestroy = undefined;
          opts.import = uploadsBucketName;
        },
      },
    });

    const table = sst.aws.Dynamo.get("ExistingPhotosTable", photosTableName);

    const previewsRouter = new sst.aws.Router("PreviewsCdn");

    previewsRouter.routeBucket("/", uploads, {
      rewrite: {
        regex: "^/(.*)$",
        to: "/previews/$1",
      },
    });

    const site = new sst.aws.Nextjs("Site", {
      environment: {
        // Infrastructure references — not sensitive
        S3_BUCKET_NAME:    uploads.name,
        DYNAMO_TABLE_NAME: table.name,
        PREVIEWS_CDN_URL:  previewsRouter.url,

        // Cognito — semi-public (also embedded in client-side Amplify config)
        // Must stay as env vars — edge runtime (middleware) can't call Secrets Manager
        COGNITO_USER_POOL_ID:  process.env.COGNITO_USER_POOL_ID!,
        COGNITO_APP_CLIENT_ID: process.env.COGNITO_APP_CLIENT_ID!,
        COGNITO_REGION:        process.env.COGNITO_REGION!,

        // Tells Lambda where to fetch secrets at cold start
        // CURSOR_SECRET and SENTRY_DSN are loaded from Secrets Manager at runtime
        SECRETS_ARN: SECRET_ARN,
      },
      link: [uploads, table, previewsRouter],
    });

    // Grant the Lambda execution role permission to read the secret
    new aws.iam.RolePolicy("SecretsManagerAccess", {
      role: site.nodes.server.nodes.role.name,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["secretsmanager:GetSecretValue"],
            Resource: SECRET_ARN,
          },
        ],
      }),
    });

    const alertEmail = process.env.ALERT_EMAIL;
    if (alertEmail) {
      const alertTopic = new aws.sns.Topic("AlertTopic", {
        name: "family-photos-alerts",
      });

      new aws.sns.TopicSubscription("AlertEmailSubscription", {
        topic: alertTopic.arn,
        protocol: "email",
        endpoint: alertEmail,
      });

      const functionName = site.nodes.server!.apply((fn) => fn.name);

      // Alert when the Next.js Lambda throws any errors.
      new aws.cloudwatch.MetricAlarm("LambdaErrorsAlarm", {
        name: "family-photos-lambda-errors",
        alarmDescription: "Next.js server Lambda is throwing errors",
        namespace: "AWS/Lambda",
        metricName: "Errors",
        dimensions: { FunctionName: functionName },
        statistic: "Sum",
        period: 300,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        alarmActions: [alertTopic.arn],
        treatMissingData: "notBreaching",
      });

      // Alert when DynamoDB starts throttling — usually means the table needs
      // on-demand billing or a capacity increase.
      new aws.cloudwatch.MetricAlarm("DynamoThrottlesAlarm", {
        name: "family-photos-dynamo-throttles",
        alarmDescription: "DynamoDB is throttling requests",
        namespace: "AWS/DynamoDB",
        metricName: "ThrottledRequests",
        dimensions: { TableName: table.name },
        statistic: "Sum",
        period: 300,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        alarmActions: [alertTopic.arn],
        treatMissingData: "notBreaching",
      });
    }

    return {
      Url: site.url,
      PreviewsCdnUrl: previewsRouter.url,
      UploadsBucket: uploads.name,
      PhotosTable: table.name,
    };
  },
});
