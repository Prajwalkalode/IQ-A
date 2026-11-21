variable "project_name" {
  description = "Name prefix used for the tables."
  type        = string
}

variable "environment" {
  description = "Deployment environment used in the table names."
  type        = string
}
