/// <reference path="./.sst/platform/config.d.ts" />

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
      transform: {
        bucket: (args, opts) => {
          args.bucket = uploadsBucketName;
          args.forceDestroy = undefined;
          opts.import = uploadsBucketName;
        },
      },
    });

    const table = sst.aws.Dynamo.get("ExistingPhotosTable", photosTableName);

    const site = new sst.aws.Nextjs("Site", {
      environment: {
        S3_BUCKET_NAME: uploads.name,
        DYNAMO_TABLE_NAME: table.name,
        COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID!,
        COGNITO_APP_CLIENT_ID: process.env.COGNITO_APP_CLIENT_ID!,
        COGNITO_REGION: process.env.COGNITO_REGION!,
      },
      link: [uploads, table],
    });

    return {
      Url: site.url,
      UploadsBucket: uploads.name,
      PhotosTable: table.name,
    };
  },
});
