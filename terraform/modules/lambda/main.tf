resource "aws_iam_role" "execution" {
  name = "${var.function_name}-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "sts:AssumeRole"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "dynamodb" {
  name = "${var.function_name}-dynamodb"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = var.dynamodb_actions
      Resource = concat(
        var.dynamodb_table_arns,
        [for table_arn in var.dynamodb_table_arns : "${table_arn}/index/*"],
      )
    }]
  })
}

resource "aws_lambda_function" "service" {
  function_name    = var.function_name
  description      = "Deployment placeholder; service code is deployed separately."
  role             = aws_iam_role.execution.arn
  runtime          = "nodejs22.x"
  handler          = "src/handler.handler"
  filename         = var.package_path
  source_code_hash = var.source_code_hash
  timeout          = 30
  memory_size      = 256

  environment {
    variables = var.environment_variables
  }

  depends_on = [
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy.dynamodb,
  ]

  lifecycle {
    ignore_changes = [
      filename,
      source_code_hash,
    ]
  }
}
