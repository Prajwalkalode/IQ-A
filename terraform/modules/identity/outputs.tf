output "users_table_name" {
  description = "Name of the users table."
  value       = aws_dynamodb_table.users.name
}

output "users_table_arn" {
  description = "ARN of the users table."
  value       = aws_dynamodb_table.users.arn
}
