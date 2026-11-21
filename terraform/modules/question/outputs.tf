output "questions_table_name" {
  description = "Name of the questions table."
  value       = aws_dynamodb_table.questions.name
}

output "questions_table_arn" {
  description = "ARN of the questions table."
  value       = aws_dynamodb_table.questions.arn
}
