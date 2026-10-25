output "identity_users_table_name" {
  description = "Name of the identity users table."
  value       = module.identity.users_table_name
}

output "identity_users_table_arn" {
  description = "ARN of the identity users table."
  value       = module.identity.users_table_arn
}

output "question_questions_table_name" {
  description = "Name of the question questions table."
  value       = module.question.questions_table_name
}

output "question_questions_table_arn" {
  description = "ARN of the question questions table."
  value       = module.question.questions_table_arn
}

output "quiz_sessions_table_name" {
  description = "Name of the quiz sessions table."
  value       = module.quiz.quiz_sessions_table_name
}

output "quiz_sessions_table_arn" {
  description = "ARN of the quiz sessions table."
  value       = module.quiz.quiz_sessions_table_arn
}

output "quiz_assignments_table_name" {
  description = "Name of the quiz assignments table."
  value       = module.quiz.quiz_assignments_table_name
}

output "quiz_assignments_table_arn" {
  description = "ARN of the quiz assignments table."
  value       = module.quiz.quiz_assignments_table_arn
}

output "submission_table_name" {
  description = "Name of the submissions table."
  value       = module.submission.submissions_table_name
}

output "submission_table_arn" {
  description = "ARN of the submissions table."
  value       = module.submission.submissions_table_arn
}
