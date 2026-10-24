# IQ-A
Institute Quiz - Application

## Terraform

The Terraform configuration in `terraform/` provisions DynamoDB tables for the
identity, question, quiz, and submission services. It requires Terraform 1.11
or newer and the AWS provider 5.x.

The root stack creates the versioned, encrypted S3 bucket and all DynamoDB
tables together. Terraform state is stored locally in
`terraform/terraform.tfstate` so the bucket can be managed and destroyed by the
same stack. AWS credentials are read from the configured AWS CLI profile `iq-a`.

```powershell
cd terraform
terraform init
terraform apply
```

To remove the bucket and tables together:

```powershell
terraform destroy
```

The root configuration defaults `project_name` to `quiz-app` and
`environment` to `dev`. The state bucket name is `iq-a-tfstate-quiz-app`, and
the AWS region is `ap-south-1`. The bucket's `force_destroy` setting allows
Terraform to delete it even when it contains objects; destroying the stack
permanently deletes the bucket contents and all DynamoDB tables.

If the bucket was already created using the former `terraform/bootstrap`
configuration, initialize the root with local state and import the existing
bucket before applying:

```powershell
terraform init -reconfigure
terraform import aws_s3_bucket.terraform_state iq-a-tfstate-quiz-app
```

The old `terraform/bootstrap/terraform.tfstate` file can then be archived or
removed after confirming the root stack manages the bucket.

For pipeline use, persist `terraform/terraform.tfstate` between runs; local
state is not shared automatically between pipeline agents.
