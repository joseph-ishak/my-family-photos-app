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

    const processHeic = new sst.aws.Function("ProcessHeic", {
      handler: "functions/process-heic.handler",
      timeout: "5 minutes",
      memory: "1024 MB",
      environment: {
        S3_BUCKET_NAME: uploadsBucketName,
        DYNAMO_TABLE_NAME: photosTableName,
      },
      nodejs: {
        install: ["sharp", "heic-convert"],
      },
      link: [uploads, table],
    });

    // SubmitMediaConvert: tiny Lambda that calls the MediaConvert API (~1 s).
    // Replaces the old ProcessVideo FFmpeg Lambda (15 min, 3 GB).
    const submitMediaConvert = new sst.aws.Function("SubmitMediaConvert", {
      handler: "functions/submit-mediaconvert.handler",
      timeout: "30 seconds",
      memory: "256 MB",
      environment: {
        S3_BUCKET_NAME:          uploadsBucketName,
        MEDIACONVERT_ENDPOINT:   process.env.MEDIACONVERT_ENDPOINT!,
        MEDIACONVERT_ROLE_ARN:   process.env.MEDIACONVERT_ROLE_ARN!,
      },
      link: [uploads],
    });

    // MediaConvertComplete: triggered by EventBridge when the job finishes.
    // Updates the DynamoDB record written by the early-commit (Phase 3).
    const mediaConvertComplete = new sst.aws.Function("MediaConvertComplete", {
      handler: "functions/mediaconvert-complete.handler",
      timeout: "1 minute",
      memory: "256 MB",
      environment: {
        S3_BUCKET_NAME:    uploadsBucketName,
        DYNAMO_TABLE_NAME: photosTableName,
      },
      link: [uploads, table],
    });

    // EventBridge rule: fires mediaConvertComplete when any MediaConvert job
    // in this account/region reaches COMPLETE status.
    const mcEventRule = new aws.cloudwatch.EventRule("MediaConvertCompleteRule", {
      description: "Trigger MediaConvertComplete Lambda when a job finishes",
      eventPattern: JSON.stringify({
        source: ["aws.mediaconvert"],
        "detail-type": ["MediaConvert Job State Change"],
        detail: { status: ["COMPLETE", "ERROR"] },
      }),
    });

    new aws.cloudwatch.EventTarget("MediaConvertCompleteTarget", {
      rule: mcEventRule.name,
      arn:  mediaConvertComplete.arn,
    });

    new aws.lambda.Permission("MediaConvertCompletePermission", {
      action:    "lambda:InvokeFunction",
      function:  mediaConvertComplete.name,
      principal: "events.amazonaws.com",
      sourceArn: mcEventRule.arn,
    });

    // Allow cross-origin requests to S3 presigned URLs so canvas operations
    // (react-easy-crop, image-edit.ts) can draw images with crossOrigin="anonymous"
    // without throwing a security error.
    new aws.s3.BucketCorsConfigurationV2("UploadsBucketCors", {
      bucket: uploads.name,
      corsRules: [
        {
          allowedHeaders: ["*"],
          allowedMethods: ["GET", "HEAD", "PUT"],
          allowedOrigins: ["*"],
          maxAgeSeconds: 86400,
        },
      ],
    });

    // CloudFront Response Headers Policy that injects Access-Control-Allow-Origin
    // on every CDN response. Without this, browsers block CDN thumbnail images
    // loaded with crossOrigin="anonymous" (ORB / OpaqueResponseBlocking).
    const previewsCorsPolicy = new aws.cloudfront.ResponseHeadersPolicy(
      "PreviewsCorsPolicy",
      {
        name: "family-photos-previews-cors",
        corsConfig: {
          accessControlAllowCredentials: false,
          accessControlAllowHeaders: { items: ["*"] },
          accessControlAllowMethods: { items: ["GET", "HEAD"] },
          accessControlAllowOrigins: { items: ["*"] },
          // Override any CORS headers the origin (S3) might send.
          originOverride: true,
        },
      }
    );

    const previewsRouter = new sst.aws.Router("PreviewsCdn", {
      transform: {
        cdn: (args) => {
          // Attach the CORS policy to the default cache behaviour so every
          // response from the previews CDN carries Access-Control-Allow-Origin.
          args.defaultCacheBehavior = {
            ...(args.defaultCacheBehavior as any),
            responseHeadersPolicyId: previewsCorsPolicy.id,
          };
        },
      },
    });

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

        // Function names injected so the API routes can invoke them
        PROCESS_HEIC_FUNCTION_NAME:        processHeic.name,
        SUBMIT_MEDIACONVERT_FUNCTION_NAME: submitMediaConvert.name,
      },
      link: [uploads, table, previewsRouter, processHeic, submitMediaConvert, mediaConvertComplete],
    });

    // Grant the Next.js Lambda permission to invoke the ProcessHeic function.
    new aws.iam.RolePolicy("InvokeProcessHeicPolicy", {
      role: site.nodes.server.nodes.role.name,
      policy: processHeic.arn.apply((arn) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["lambda:InvokeFunction"],
              Resource: arn,
            },
          ],
        })
      ),
    });

    // Grant the Next.js Lambda permission to invoke SubmitMediaConvert.
    new aws.iam.RolePolicy("InvokeSubmitMediaConvertPolicy", {
      role: site.nodes.server.nodes.role.name,
      policy: submitMediaConvert.arn.apply((arn) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["lambda:InvokeFunction"],
              Resource: arn,
            },
          ],
        })
      ),
    });

    // Grant SubmitMediaConvert permission to call mediaconvert:CreateJob and
    // iam:PassRole (required to pass the MediaConvert service role to the job).
    // Note: iam:PassRole does NOT accept "*" as a Resource — AWS requires a
    // specific role ARN or ARN pattern. We use the known MediaConvert role ARN
    // from the environment, falling back to a wildcard role pattern that still
    // restricts PassRole to roles within this account only.
    const mediaConvertRoleArn =
      process.env.MEDIACONVERT_ROLE_ARN ||
      "arn:aws:iam::915209469707:role/FamilyApp-MediaConvert-Role";
    new aws.iam.RolePolicy("SubmitMediaConvertJobPolicy", {
      role: submitMediaConvert.nodes.role.name,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["mediaconvert:CreateJob", "mediaconvert:DescribeEndpoints"],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: ["iam:PassRole"],
            Resource: mediaConvertRoleArn,
          },
        ],
      }),
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
