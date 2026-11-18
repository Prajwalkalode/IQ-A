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

resource "aws_apigatewayv2_api" "service" {
  name          = "${var.function_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "service" {
  api_id                 = aws_apigatewayv2_api.service.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.service.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "service" {
  api_id    = aws_apigatewayv2_api.service.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.service.id}"
}

resource "aws_apigatewayv2_stage" "service" {
  api_id      = aws_apigatewayv2_api.service.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId            = "$context.requestId"
      routeKey             = "$context.routeKey"
      status               = "$context.status"
      integrationError     = "$context.integrationErrorMessage"
      integrationStatus    = "$context.integrationStatus"
      integrationLatencyMs = "$context.integrationLatency"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${var.function_name}"
  retention_in_days = 14
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "${var.function_name}-api-gateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.service.execution_arn}/*"
}
