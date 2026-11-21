resource "aws_dynamodb_table" "submissions" {
  name                        = "${var.project_name}-${var.environment}-submissions"
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
