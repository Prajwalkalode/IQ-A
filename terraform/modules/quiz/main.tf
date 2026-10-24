resource "aws_dynamodb_table" "quiz_sessions" {
  name                        = "${var.project_name}-${var.environment}-quiz-sessions"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "quizId"
  deletion_protection_enabled = false

  attribute {
    name = "quizId"
    type = "S"
  }

  attribute {
    name = "createdBy"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "createdBy-createdAt-index"
    hash_key        = "createdBy"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
  }
}

resource "aws_dynamodb_table" "quiz_assignments" {
  name                        = "${var.project_name}-${var.environment}-quiz-assignments"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "quizId"
  range_key                   = "studentEmail"
  deletion_protection_enabled = false

  attribute {
    name = "quizId"
    type = "S"
  }

  attribute {
    name = "studentEmail"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }
}
