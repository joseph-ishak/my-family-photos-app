import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

const region = process.env.AWS_REGION ?? "us-west-2";

export const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region })
);

export const s3 = new S3Client({ region });

export const cognito = new CognitoIdentityProviderClient({ region });
