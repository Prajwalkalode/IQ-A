output "submissions_table_name" {
  description = "Name of the submissions table."
  value       = aws_dynamodb_table.submissions.name
}

output "submissions_table_arn" {
  description = "ARN of the submissions table."
  value       = aws_dynamodb_table.submissions.arn
}
