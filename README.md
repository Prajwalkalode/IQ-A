# IQ-A
Institute Quiz - Application

## Terraform

The Terraform configuration in `terraform/` provisions DynamoDB tables for the
identity, question, quiz, and submission services. It requires Terraform 1.11
or newer and the AWS provider 5.x.

Terraform state is stored locally in `terraform/terraform.tfstate`. AWS
credentials are read from the configured AWS CLI profile `iq-a`.

```powershell
cd terraform
terraform init
terraform apply
```

To remove the DynamoDB tables:

```powershell
terraform destroy
```

The root configuration defaults `project_name` to `quiz-app` and
`environment` to `dev`; the AWS region is `ap-south-1`.

For pipeline use, persist `terraform/terraform.tfstate` between runs; local
state is not shared automatically between pipeline agents.

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
submission module. Configure `AWS_REGION` and `SUBMISSIONS_TABLE` in the service
environment. With the default Terraform variables, the table name is
`quiz-app-dev-submissions`. The AWS SDK uses its default credential provider
chain; set `AWS_PROFILE` for local development.

## Identity service

The identity service uses the DynamoDB table provisioned by the Terraform
identity module. Configure `AWS_REGION` and `USERS_TABLE` in the service
environment. With the default Terraform variables, the table name is
`quiz-app-dev-users`. The AWS SDK uses its default credential provider chain;
set `AWS_PROFILE` for local development.
