# IQ-A
Institute Quiz - Application

## Terraform

The Terraform configuration in `terraform/` provisions DynamoDB tables,
Lambda functions, and API Gateway HTTP APIs for the identity, question, quiz,
and submission services. It requires Terraform 1.11 or newer and the AWS
provider 5.x.

Terraform state is stored in the `iq-a-state-bucket` S3 bucket at
`iq-a/terraform.tfstate`, with S3 lockfile locking enabled. Keep this bucket
outside the disposable project stack so it survives `terraform destroy`.
Terraform uses the standard AWS credential provider chain. For local
development, set `AWS_PROFILE=iq-a`.

```powershell
cd terraform
terraform init
terraform apply
```

To remove the DynamoDB tables:

```powershell
terraform destroy
```

This destroys the application stack, including its tables and data. It does
not delete the separate Terraform state bucket.

The root configuration defaults `project_name` to `quiz-app` and
`environment` to `dev`; the AWS region is `ap-south-1`.

The manually triggered GitHub Actions workflow in
`.github/workflows/deploy-project.yml` validates the project, applies
infrastructure, then packages services, configures Lambda secrets, deploys
each package, and smoke-tests the APIs in separate steps. Configure these
GitHub Actions secrets:

- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for the deployment IAM user.
- `JWT_SECRET` and `INTERNAL_API_KEY` for application authentication.

Static AWS access keys are long-lived credentials. Keep the deployment user
dedicated to this repository and rotate its keys periodically.

The manually triggered `.github/workflows/destroy-project.yml` workflow
requires selecting `destroy` to confirm removal. It deletes the project
infrastructure, including DynamoDB tables and their data, but leaves the
separate Terraform state bucket in place. Configure the GitHub `destroy`
environment with any desired branch restrictions or approval requirements.

## DynamoDB backup and restore

The manually triggered `Preserve data` and `Reseed data` workflows save and
restore all five DynamoDB tables: users, questions, quiz sessions, quiz
assignments, and submissions. Before using them:

- Create a separate S3 bucket that is not managed by the project Terraform
  stack, then set the GitHub repository variable `DYNAMODB_BACKUP_BUCKET` to
  its name. The bucket must be in `ap-south-1`. Keep it even when destroying
  the application infrastructure. If it was added as a GitHub Actions secret
  instead, the workflows also accept it there; the bucket name itself is not
  sensitive.
- Ensure the AWS deployment user can describe and scan the five DynamoDB
  tables, batch-write items to those tables, and get/put objects under
  `snapshots/*` in the backup bucket. Multipart upload permissions
  (`s3:AbortMultipartUpload` and `s3:ListMultipartUploadParts`) are also needed
  for larger compressed snapshots.
- Pause application writes before running `Preserve data`, then select `yes`
  in its confirmation input. The workflow performs consistent paginated scans
  and records a snapshot ID in the run summary. A scan is not a transactionally
  consistent point-in-time export; writes must remain paused for the scan.
- Deploy the project before running `Reseed data`. Provide the snapshot ID from
  the successful backup run and select `restore`. Restore validates the
  snapshot and table key schemas, retries unprocessed batches, and reports
  counts without logging table contents.

Snapshots are gzip-compressed, identified by unique run-based IDs, and uploaded
with S3 server-side encryption. Restore upserts snapshot items: matching keys
are overwritten and other existing items are left untouched. It does not clear
tables. Store backups in a bucket with appropriate access controls and
retention; S3 storage and requests can incur charges.

## Quiz service

The quiz service uses DynamoDB tables provisioned by the Terraform quiz module.
Configure `AWS_REGION`, `QUIZ_SESSIONS_TABLE`, and `QUIZ_ASSIGNMENTS_TABLE` in
the service environment. With the default Terraform variables, the table names
are `quiz-app-dev-quiz-sessions` and `quiz-app-dev-quiz-assignments`.

The AWS SDK uses its default credential provider chain. For local development,
set `AWS_PROFILE` to the profile that has access to these tables.

## Question service

The question service uses the DynamoDB table provisioned by the Terraform
question module. Configure `AWS_REGION` and `QUESTIONS_TABLE` in the service
environment. With the default Terraform variables, the table name is
`quiz-app-dev-questions`. The AWS SDK uses its default credential provider
chain; set `AWS_PROFILE` for local development.

## Submission service

The submission service uses the DynamoDB table provisioned by the Terraform
submission module. Configure `AWS_REGION` and `SUBMISSIONS_TABLE` in the
service environment. With the default Terraform variables, the table name is
`quiz-app-dev-submissions`. The AWS SDK uses its default credential provider
chain; set `AWS_PROFILE` for local development.

## Identity service

The identity service uses the DynamoDB table provisioned by the Terraform
identity module. Configure `AWS_REGION` and `USERS_TABLE` in the service
environment. With the default Terraform variables, the table name is
`quiz-app-dev-users`. The AWS SDK uses its default credential provider chain;
set `AWS_PROFILE` for local development.

## Running services on AWS Lambda

Each service exports an API Gateway-compatible Lambda handler from
`src/handler.js`. When configuring a Lambda function, use the service directory
as the deployment package root and set the handler to `src/handler.handler`.
Use an API Gateway HTTP API (payload format 2.0) and grant the Lambda execution
role access to that service's DynamoDB tables. For local development, continue
to run `npm start`; it starts the Express app from `src/app.js` using
`local-server.js`.

The Terraform root creates one Lambda function per service, with names
`quiz-app-dev-identity`, `quiz-app-dev-question`, `quiz-app-dev-quiz`, and
`quiz-app-dev-submission` by default. These functions initially contain a
placeholder handler that returns HTTP 503 until the deployment pipeline uploads
the service package. Terraform outputs each function's name and ARN for use by
that pipeline; Terraform ignores later package changes so it will not overwrite
code deployed by the pipeline. It also ignores subsequent Lambda environment
changes so the workflow can inject application secrets without storing them in
Terraform state. The functions have CloudWatch Logs access and DynamoDB access
limited to their service tables. The quiz and submission functions also have
narrowly scoped SSM access to the service URL parameters they need.

Terraform also creates a public API Gateway HTTP API for each Lambda. Each API
forwards all methods and paths to its service Lambda using payload format 2.0.
Use `terraform output <service>_api_endpoint` to retrieve a base URL, then
append the service route path. The endpoint remains available while the
service code is deployed. Terraform stores all four endpoint URLs as standard
SSM String parameters under `/quiz-app/dev/services/<service>/url`. The quiz
and submission services resolve their peer URLs from SSM at runtime, caching
them for the lifetime of the Lambda instance. Local URL environment variables
such as `QUESTION_SERVICE_URL` and `QUIZ_SERVICE_URL` override SSM for tests and
local development.
