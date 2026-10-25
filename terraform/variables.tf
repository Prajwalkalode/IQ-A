variable "project_name" {
  description = "Name prefix used for DynamoDB tables."
  type        = string
  default     = "quiz-app"
}

variable "environment" {
  description = "Deployment environment used in DynamoDB table names."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region in which to create the DynamoDB tables."
  type        = string
  default     = "ap-south-1"
}
