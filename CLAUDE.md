# CLAUDE.md

This file provides guidance for Claude when working in this repository.

## Project Overview

**my-family-photos** is a Next.js 16 web app for uploading, viewing, and managing family photos. It uses AWS for storage and auth, with SST handling infrastructure-as-code deployment.

## Tech Stack

- **Framework**: Next.js 16 (App Router) with TypeScript
- **Styling**: Tailwind CSS v4
- **Auth**: AWS Cognito via `aws-amplify` / `@aws-amplify/ui-react`
- **Storage**: AWS S3 (photos), DynamoDB (metadata)
- **Infrastructure**: SST v3 (`sst.config.ts`)
- **Image handling**: `heic2any` for HEIC conversion, `react-easy-crop` for cropping

## Development Commands

```bash
npm run dev      # Start local dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Project Structure

```
src/
  app/
    (app)/       # Authenticated routes (protected layout)
    (public)/    # Public routes (login, signup, etc.)
    api/         # Next.js API route handlers
    components/  # Shared UI components
    layout.tsx   # Root layout
  hooks/         # Custom React hooks
  lib/           # Utility functions and AWS SDK clients
  types/         # TypeScript type definitions
  script/        # One-off or utility scripts
```

## Key Conventions

- **Route groups**: `(app)` for auth-required pages, `(public)` for unauthenticated pages
- **Auth**: Cognito JWT tokens managed via Amplify; middleware (`middleware.ts`) handles route protection
- **AWS clients**: Instantiated in `src/lib/` — use existing client helpers rather than creating new ones
- **Environment variables**: Loaded via SST (`sst-env.d.ts`); check `export_env_vars` for local dev setup
- **Images**: HEIC files are converted client-side before upload; presigned S3 URLs are used for serving

## Infrastructure

SST v3 manages all AWS resources. When adding new AWS resources (S3 buckets, DynamoDB tables, Lambdas, etc.), update `sst.config.ts` rather than provisioning manually. Run `npx sst deploy` to apply infrastructure changes.

## Notes

- This is a private family app — keep auth checks in place on all new API routes
- DynamoDB uses the AWS SDK v3 (`@aws-sdk/lib-dynamodb`) document client pattern
- Avoid committing `.env*` files or AWS credentials; use the SST env system
