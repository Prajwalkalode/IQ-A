resource "aws_dynamodb_table" "users" {
  name                        = "${var.project_name}-${var.environment}-users"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "email"
  deletion_protection_enabled = false

  attribute {
    name = "email"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }
}
