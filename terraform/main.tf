terraform {
  required_version = ">= 1.11.0"

  backend "local" {
    path = "terraform.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = "iq-a"
}

data "archive_file" "lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.terraform/lambda-placeholder.zip"

  source {
    content  = file("${path.module}/lambda-placeholder.js")
    filename = "src/handler.js"
  }
}

module "identity" {
  source       = "./modules/identity"
  project_name = var.project_name
  environment  = var.environment
}

module "question" {
  source       = "./modules/question"
  project_name = var.project_name
  environment  = var.environment
}

module "quiz" {
  source       = "./modules/quiz"
  project_name = var.project_name
  environment  = var.environment
}

module "submission" {
  source       = "./modules/submission"
  project_name = var.project_name
  environment  = var.environment
}

module "identity_lambda" {
  source           = "./modules/lambda"
  function_name    = "${var.project_name}-${var.environment}-identity"
  package_path     = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256
  dynamodb_table_arns = [
    module.identity.users_table_arn,
  ]
  dynamodb_actions = [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
  ]
  environment_variables = {
    USERS_TABLE = module.identity.users_table_name
  }
}

module "question_lambda" {
  source           = "./modules/lambda"
  function_name    = "${var.project_name}-${var.environment}-question"
  package_path     = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256
  dynamodb_table_arns = [
    module.question.questions_table_arn,
  ]
  dynamodb_actions = [
    "dynamodb:DeleteItem",
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:Scan",
    "dynamodb:UpdateItem",
  ]
  environment_variables = {
    QUESTIONS_TABLE = module.question.questions_table_name
  }
}

module "quiz_lambda" {
  source           = "./modules/lambda"
  function_name    = "${var.project_name}-${var.environment}-quiz"
  package_path     = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256
  dynamodb_table_arns = [
    module.quiz.quiz_sessions_table_arn,
    module.quiz.quiz_assignments_table_arn,
  ]
  dynamodb_actions = [
    "dynamodb:DeleteItem",
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:Query",
    "dynamodb:Scan",
    "dynamodb:UpdateItem",
  ]
  environment_variables = {
    QUIZ_SESSIONS_TABLE    = module.quiz.quiz_sessions_table_name
    QUIZ_ASSIGNMENTS_TABLE = module.quiz.quiz_assignments_table_name
  }
}

module "submission_lambda" {
  source           = "./modules/lambda"
  function_name    = "${var.project_name}-${var.environment}-submission"
  package_path     = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256
  dynamodb_table_arns = [
    module.submission.submissions_table_arn,
  ]
  dynamodb_actions = [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:Query",
  ]
  environment_variables = {
    SUBMISSIONS_TABLE = module.submission.submissions_table_name
  }
}
