output "quiz_sessions_table_name" {
  description = "Name of the quiz sessions table."
  value       = aws_dynamodb_table.quiz_sessions.name
}

output "quiz_sessions_table_arn" {
  description = "ARN of the quiz sessions table."
  value       = aws_dynamodb_table.quiz_sessions.arn
}

output "quiz_assignments_table_name" {
  description = "Name of the quiz assignments table."
  value       = aws_dynamodb_table.quiz_assignments.name
}

output "quiz_assignments_table_arn" {
  description = "ARN of the quiz assignments table."
  value       = aws_dynamodb_table.quiz_assignments.arn
}
