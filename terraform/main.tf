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
  }
}

provider "aws" {
  region  = var.aws_region
  profile = "iq-a"
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
