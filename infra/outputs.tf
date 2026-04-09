# Outputs
output "user_pool_id" {
  value = aws_cognito_user_pool.user_pool.id
}

output "app_client_id" {
  value = aws_cognito_user_pool_client.client.id
}

output "cognito_domain" {
  value       = "${aws_cognito_user_pool_domain.domain.domain}.auth.${var.region}.amazoncognito.com"
  description = "Cognito User Pool Domain"
}

output "amplify_app_arn" {
  description = "ARN of the amplify APP"
  value       = aws_amplify_app.sparky.arn
}

output "amplify_app_id" {
  description = "Unique ID of the amplify APP"
  value       = aws_amplify_app.sparky.id
}

output "amplify_branch_arn" {
  description = "ARN for the branch"
  value       = aws_amplify_branch.develop.arn
}

output "region" {
  value = var.region
}

output "temporary_password" {
  value     = random_password.temp.result
  sensitive = true
}


output "agent_runtime_arn_escaped" {
  description = "URL-encoded ARN of the Bedrock agent runtime"
  value       = urlencode(aws_bedrockagentcore_agent_runtime.sparky.agent_runtime_arn)
}

output "core_services_runtime_arn" {
  description = "ARN of the Core-Services Bedrock agent runtime"
  value       = aws_bedrockagentcore_agent_runtime.core_services.agent_runtime_arn
}

output "core_services_runtime_arn_escaped" {
  description = "URL-encoded ARN of the Core-Services Bedrock agent runtime for frontend URL construction"
  value       = urlencode(aws_bedrockagentcore_agent_runtime.core_services.agent_runtime_arn)
}

output "sparky_model_config_frontend" {
  description = "Frontend-safe JSON subset of sparky model configuration"
  value = jsonencode({
    default_model_id = var.sparky_models.default_model_id
    models = [
      for m in var.sparky_models.models : {
        id               = m.id
        label            = m.label
        description      = m.description
        reasoning_type   = m.reasoning_type
        reasoning_levels = length(m.reasoning_type == "budget" ? m.budget_mapping : m.effort_mapping)
      }
    ]
  })
}

output "skills_bucket_name" {
  description = "Name of the dedicated Skills S3 bucket"
  value       = aws_s3_bucket.skills_bucket.id
}

output "skills_bucket_arn" {
  description = "ARN of the dedicated Skills S3 bucket"
  value       = aws_s3_bucket.skills_bucket.arn
}

output "artifact_bucket_name" {
  description = "Name of the Artifact S3 bucket"
  value       = aws_s3_bucket.artifact_bucket.id
}

output "artifact_bucket_arn" {
  description = "ARN of the Artifact S3 bucket"
  value       = aws_s3_bucket.artifact_bucket.arn
}
