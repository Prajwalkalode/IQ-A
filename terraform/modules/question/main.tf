resource "aws_dynamodb_table" "questions" {
  name                        = "${var.project_name}-${var.environment}-questions"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "questionId"
  deletion_protection_enabled = false

  attribute {
    name = "questionId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }
}
