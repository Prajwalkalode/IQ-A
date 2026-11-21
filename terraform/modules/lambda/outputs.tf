output "function_name" {
  description = "Name of the Lambda function."
  value       = aws_lambda_function.service.function_name
}

output "function_arn" {
  description = "ARN of the Lambda function."
  value       = aws_lambda_function.service.arn
}

output "api_endpoint" {
  description = "Invoke URL for the service's API Gateway HTTP API."
  value       = aws_apigatewayv2_api.service.api_endpoint
}
