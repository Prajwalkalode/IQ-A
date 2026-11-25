# Manual Deployment Pipeline Plan

## Goal

Use manually triggered GitHub Actions workflows to deploy the application while
working and remove its billable infrastructure when it is idle. Optionally
preserve DynamoDB data in S3 before teardown and restore it after redeployment.
Terraform Cloud is not required.

## Current state

- `.github/workflows/validate.yml` already runs lint and tests for all four
  services on pushes and pull requests.
- `terraform/` provisions the DynamoDB tables, four Lambda functions, and four
  API Gateway HTTP APIs. Lambda packages currently start as placeholders.
- Lambda API URLs are available as Terraform outputs. They are public HTTP API
  endpoints with no API Gateway authorizer configured.
- Terraform stores state in the `iq-a-state-bucket` S3 backend with native
  lockfile locking. Local development uses `AWS_PROFILE=iq-a`; GitHub Actions
  uses the deployment user's repository secrets.
- The quiz and submission services call other services using
  `QUESTION_SERVICE_URL` and `QUIZ_SERVICE_URL` environment variables.
- `.github/workflows/deploy-project.yml` is implemented as a manually triggered
  workflow with separate package, Lambda configuration, and deployment steps.
- `.github/workflows/destroy-project.yml` is implemented as a manually
  triggered workflow with an explicit destroy confirmation.
- `.github/workflows/preserve-data.yml` and
  `.github/workflows/reseed-data.yml` implement manual compressed S3 snapshots
  and validated DynamoDB restore operations.

## One-time prerequisites

- [x] Create the `iq-a-state-bucket` outside the disposable project stack.
- [x] Configure the S3 backend with encryption and native lockfile locking.
- [x] Remove the hard-coded AWS provider profile.
- [x] Create a dedicated deployment IAM user and store its access keys in
  GitHub Actions secrets.
- [x] Initialize the S3 backend. The current local state and AWS project
  resources were verified empty, so there was no live state to transfer.
- [ ] Confirm application-level authentication is appropriate for the public
  API Gateway endpoints.

The state bucket must survive `terraform destroy`; it is deployment metadata,
not part of the disposable application infrastructure. Its S3 storage and
requests have a small ongoing cost.

## Workflow 1: Deploy project

Suggested workflow: `.github/workflows/deploy-project.yml`

Trigger it manually with `workflow_dispatch`.

- [x] Run service lint and tests, and validate Terraform formatting and
  configuration by reusing the validation workflow.
- [x] Configure AWS credentials from GitHub Actions secrets.
- [x] Require the `deploy` GitHub Environment for the deployment job.
- [x] Initialize Terraform with the S3 state backend and plan/apply the
  DynamoDB, Lambda, API Gateway, logging, and SSM resources.
- [x] Create standard SSM String parameters from the API endpoint outputs:
  - `/quiz-app/dev/services/identity/url`
  - `/quiz-app/dev/services/question/url`
  - `/quiz-app/dev/services/quiz/url`
  - `/quiz-app/dev/services/submission/url`
- [x] Package each service for Lambda, configure its application secrets, and
  upload the packages in separate pipeline steps. Each package uses
  `src/handler.handler` as its entry point.
- [x] Run post-deployment health checks against each API.

SSM parameters can be Terraform resources whose values reference the API
endpoints, so Terraform creates or updates them after the APIs are ready. API
URLs are not secrets and do not need SecureString parameters.

## Service-to-service URL discovery

- [x] Update the quiz and submission service clients to resolve peer URLs from
  their SSM parameters when running in Lambda.
- [x] Keep `QUESTION_SERVICE_URL` and `QUIZ_SERVICE_URL` as local-development
  overrides so local runs and existing tests can continue to use local URLs.
- [x] Cache resolved parameter values in the Lambda process rather than making
  an SSM request for every API call.
- [x] Grant each Lambda role `ssm:GetParameter` only for the endpoint
  parameters it needs.

The deploy workflow also requires `JWT_SECRET` and `INTERNAL_API_KEY` GitHub
Actions secrets. It injects them into Lambda configuration after Terraform
applies the non-secret environment values.

## Workflow 2: Destroy project

Suggested workflow: `.github/workflows/destroy-project.yml`

Trigger it manually and require an explicit confirmation before destructive
operations.

- [x] Initialize Terraform using the same persistent state backend.
- [x] Show the destroy plan and require selecting `destroy` to confirm.
- [x] Apply the destroy plan for the application stack.
- [ ] Verify that DynamoDB tables (including their data), Lambda functions and
  deployed code, API Gateway APIs, logs, and SSM endpoint parameters are
  removed.

The state bucket, deployment IAM user, and any separate backup storage must
not be managed by this disposable stack.

## Workflow 3: Preserve data (optional)

Suggested workflow: `.github/workflows/preserve-data.yml`

- [ ] Create the external S3 backup bucket, configure the
  `DYNAMODB_BACKUP_BUCKET` repository variable, and grant the backup
  permissions described below.
- [x] Require confirmation that writes are paused while taking the backup.
- [x] Paginate through each DynamoDB table and write a run-versioned, compressed
  data snapshot to a durable S3 backup location.
- [x] Keep table items out of workflow logs and ordinary build
  artifacts.
- [x] Record the snapshot timestamp and table names so a restore can select the
  intended backup.
- [x] Verify that the uploaded snapshot can be read and parsed.

For a small, idle project, a paginated scan to S3 is a low-cost option. For a
transactionally consistent point-in-time export, evaluate DynamoDB point-in-time
recovery and export costs before enabling them.

The S3 backup bucket is configured through the GitHub repository variable
`DYNAMODB_BACKUP_BUCKET` and must be outside the resources destroyed by
Workflow 2. Objects use S3-managed encryption. S3 storage incurs a small
ongoing cost for retained snapshots.

## Workflow 4: Reseed data (optional)

Suggested workflow: `.github/workflows/reseed-data.yml`

- [x] Require the project infrastructure to exist first; run the
  deploy workflow before restoring.
- [x] Select a specific snapshot.
- [x] Wait for all DynamoDB tables to become active.
- [x] Validate the snapshot and write items using DynamoDB batch operations,
  respecting batch limits and retrying unprocessed items.
- [x] Report per-table item counts and fail if any table cannot be restored.
- [ ] Smoke-test representative read paths after restore.

Terraform recreates table schemas; the backup contains table items. Restore
validates primary key schemas and upserts records without deleting unrelated
existing items. Keep the snapshot format compatible with the repository's
table key schemas.

## Cost and safety notes

- Destroying the project removes its application resources and stops their
  ongoing usage/storage charges. Retained Terraform state and data backups
  continue to incur S3 storage and request charges.
- API Gateway HTTP APIs and Lambda do not require continuously running
  instances; they are primarily usage-based. DynamoDB table storage and
  CloudWatch log retention can still incur charges while deployed.
- Keep the destroy workflow separate from deployment, protect it with a
  confirmation or GitHub environment approval, and serialize Terraform
  operations and data-pipeline runs so lifecycle workflows cannot overlap.
- The deployment IAM user needs infrastructure-management permissions,
  including `iam:PassRole`, state bucket access, and SSM parameter management.
  Its access keys are long-lived; use a dedicated user, store keys only in
  GitHub Actions secrets, and rotate them. Backup and restore permissions can
  be limited to `dynamodb:DescribeTable`, `dynamodb:Scan`, and
  `dynamodb:BatchWriteItem` on the five project tables, plus `s3:GetObject` and
  `s3:PutObject` under `snapshots/*` in the external backup bucket. Larger
  multipart snapshots also require `s3:AbortMultipartUpload` and
  `s3:ListMultipartUploadParts`.

## Completion criteria

- [ ] A manual deploy validates, applies infrastructure, updates SSM URLs,
  deploys all four services, and passes smoke tests.
- [ ] A manual destroy removes the project stack but preserves Terraform state
  and any requested data backups.
- [ ] Optional preserve and reseed workflows round-trip records for every
  DynamoDB table.
- [ ] Repeated deploy/destroy cycles work without relying on a runner's local
  files or manually copying API URLs.
