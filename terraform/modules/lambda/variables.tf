variable "function_name" {
  description = "Name of the Lambda function."
  type        = string
}

variable "package_path" {
  description = "Path to the initial deployment package."
  type        = string
}

variable "source_code_hash" {
  description = "Base64-encoded SHA256 hash of the deployment package."
  type        = string
}

variable "environment_variables" {
  description = "Non-secret environment variables for the function."
  type        = map(string)
  default     = {}
}

variable "dynamodb_table_arns" {
  description = "DynamoDB tables the function may access."
  type        = list(string)
  default     = []
}

variable "dynamodb_actions" {
  description = "DynamoDB actions the function may use on its tables."
  type        = list(string)
  default     = []
}

variable "ssm_parameter_arns" {
  description = "SSM parameters the function may read."
  type        = list(string)
  default     = []
}
