# Project Long-Term Memory
# AgentCore Memory resource + one CUSTOM/SEMANTIC_OVERRIDE strategy.
# Strategies are a separate resource (aws_bedrockagentcore_memory_strategy).
# Per-project namespace isolation via composite actorId:
#   "{user_id_hex}_{project_id_hex}" → namespace "projects/{actorId}"


#======================== Memory Execution Role ======================
# Required for CUSTOM strategies — AgentCore assumes this role to call
# Bedrock models for extraction and consolidation.

resource "aws_iam_role" "project_memory_exec_role" {
  name = "${local.prefix}-project-memory-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.caller_identity.account_id
        }
      }
    }]
  })

  tags = {
    Name        = "${local.prefix}-project-memory-exec-role"
    Environment = var.env
  }
}

resource "aws_iam_role_policy" "project_memory_exec_policy" {
  name = "${local.prefix}-project-memory-exec-policy"
  role = aws_iam_role.project_memory_exec_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "BedrockInvokeForExtraction"
      Effect = "Allow"
      # InvokeModel: foundation models and cross-region inference profiles
      # GetInferenceProfile: required when the model_id is an inference profile
      Action = ["bedrock:InvokeModel", "bedrock:GetInferenceProfile"]
      Resource = [
        "arn:aws:bedrock:*::foundation-model/*",
        "arn:aws:bedrock:*:${data.aws_caller_identity.caller_identity.account_id}:*"
      ]
    }]
  })
}

#======================== AgentCore Memory Resource ======================

resource "aws_bedrockagentcore_memory" "project_memory" {
  name                  = "${replace(local.prefix, "-", "_")}_project_memory"
  description           = "Long-term semantic memory for Sparky projects"
  event_expiry_duration = 90

  tags = {
    Name        = "${local.prefix}-project-memory"
    Environment = var.env
  }
}


#======================== Memory Strategy (CUSTOM / SEMANTIC_OVERRIDE) ======================
# One shared strategy for all projects.
# namespace "projects/{actorId}" → per-project isolation via composite actorId.

resource "aws_bedrockagentcore_memory_strategy" "project_semantic" {
  name                      = "ProjectInsightExtractor"
  description               = "Extracts project decisions, progress, and facts from user and assistant messages"
  memory_id                 = aws_bedrockagentcore_memory.project_memory.id
  memory_execution_role_arn = aws_iam_role.project_memory_exec_role.arn
  type                      = "CUSTOM"
  namespaces                = ["projects/{actorId}"]

  configuration {
    type = "SEMANTIC_OVERRIDE"

    extraction {
      append_to_prompt = <<-EOT
        - Extract meaningful information from BOTH user messages AND assistant messages,
          not only from user messages. The assistant's proposed solutions, designs,
          architectures, and conclusions are equally worth preserving.
        - Focus on information with lasting value: decisions made, approaches chosen,
          technical details discussed, constraints or blockers discovered, action items
          agreed upon, and outcomes achieved.
        - Extract facts that a participant would benefit from knowing in a future session
          without re-reading the full conversation history.
        - If the assistant proposes or recommends an approach, design, or implementation,
          extract it as a key fact.
        - If a decision is made (by the user or jointly), extract it explicitly.
        - Ignore casual exchanges, greetings, acknowledgments, and anything that carries
          no lasting informational value.
      EOT
      model_id         = var.project_memory_extraction_model_id
    }

    consolidation {
      append_to_prompt = <<-EOT
        - Consolidate extracted facts by merging related information and removing duplicates.
        - Preserve specifics: names, versions, decisions, and outcomes should remain precise.
        - Keep consolidated memories concise but complete enough to be useful in isolation.
      EOT
      model_id         = var.project_memory_extraction_model_id
    }
  }

  depends_on = [aws_iam_role_policy.project_memory_exec_policy]
}


#======================== Memory Strategy (USER_PREFERENCE) ======================
# Automatically extracts user preferences, working style, and technical conventions
# from conversations. Scoped per user×project via the same composite actorId.
# Stored under namespace "preferences/{actorId}" — separate from conversational
# memory ("projects/{actorId}") so they can be retrieved independently.

resource "aws_bedrockagentcore_memory_strategy" "project_preferences" {
  name                      = "ProjectPreferenceLearner"
  description               = "Extracts user preferences, working style, and technical conventions from project conversations"
  memory_id                 = aws_bedrockagentcore_memory.project_memory.id
  memory_execution_role_arn = aws_iam_role.project_memory_exec_role.arn
  type                      = "USER_PREFERENCE"
  namespaces                = ["preferences/{actorId}"]

  depends_on = [aws_iam_role_policy.project_memory_exec_policy]
}


#======================== Runtime Role: Data Plane Permissions ======================
# Runtime only needs data plane access (write events + retrieve memories).
# Control plane is never called at runtime.

resource "aws_iam_role_policy" "sparky_project_memory_policy" {
  name = "${local.prefix}-sparky-project-memory-policy"
  role = aws_iam_role.sparky_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AgentCoreMemoryDataPlane"
      Effect = "Allow"
      Action = [
        "bedrock-agentcore:CreateEvent",
        "bedrock-agentcore:ListEvents",
        "bedrock-agentcore:RetrieveMemoryRecords",
      ]
      Resource = aws_bedrockagentcore_memory.project_memory.arn
    }]
  })
}


#======================== Outputs ======================

output "project_memory_id" {
  value       = aws_bedrockagentcore_memory.project_memory.id
  description = "AgentCore Memory resource ID — set as PROJECT_MEMORY_ID env var on the runtime"
}