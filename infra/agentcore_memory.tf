# AgentCore Memory resource for Sparky agent checkpointing
# This replaces the AsyncBedrockSessionSaver with AgentCoreMemorySaver

resource "aws_bedrockagentcore_memory" "sparky_memory" {

  name                  = "sparky_sparky_memory"
  description           = "AgentCore Memory for Sparky agent checkpointing"
  event_expiry_duration = var.expiry_duration_days

  tags = {
    Project = local.prefix
    Service = "sparky"
    env     = var.env
  }
}

output "sparky_memory_id" {
  value       = aws_bedrockagentcore_memory.sparky_memory.id
  description = "AgentCore Memory ID for Sparky agent"
}
