# Core-Services Infrastructure
# This file contains resources for the Core-Services API runtime that handles
# synchronous operations (chat history, tool configuration, search).

#======================== ECR Repository ======================

resource "aws_ecr_repository" "core_services" {
  name                 = "${local.prefix}-core-services"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = "${local.prefix}-core-services"
    Environment = var.env
  }
}


#======================== Docker Build and Push ======================

resource "null_resource" "docker_core_services_build_push" {
  depends_on = [aws_ecr_repository.core_services]

  triggers = {
    dockerfile_hash   = filemd5("${path.module}/../backend/core_services/Dockerfile")
    requirements_hash = filemd5("${path.module}/../backend/core_services/requirements.txt")
    source_hash       = sha256(join("", [for f in fileset("${path.module}/../backend/core_services", "**/*.py") : filesha256("${path.module}/../backend/core_services/${f}")]))
    image_tag         = local.core_services_image_tag
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../backend/core_services"
    command     = <<-EOT
      # Get ECR login token
      aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
      aws ecr get-login-password --region ${var.region} | docker login --username AWS --password-stdin ${aws_ecr_repository.core_services.repository_url}
      
      # Ensure buildx is set up
      docker buildx create --use --name multiarch 2>/dev/null || docker buildx use multiarch
      
      # Build and push image for ARM64 with content-based tag
      docker buildx build --platform linux/arm64 --build-arg AWS_REGION=${var.region} \
        -t ${aws_ecr_repository.core_services.repository_url}:${local.core_services_image_tag} \
        -t ${aws_ecr_repository.core_services.repository_url}:latest \
        --push .
    EOT
  }
}


#======================== Bedrock AgentCore Runtime ======================

resource "aws_bedrockagentcore_agent_runtime" "core_services" {
  agent_runtime_name = "sparky_core_services"
  role_arn           = aws_iam_role.core_services_role.arn

  environment_variables = {
    CHAT_HISTORY_TABLE   = aws_dynamodb_table.sparky_chat_history.id,
    TOOL_CONFIG_TABLE    = aws_dynamodb_table.tool_config.id,
    SKILLS_TABLE         = aws_dynamodb_table.skills.id,
    REGION               = var.region,
    MODEL_ID             = var.model_core_services,
    S3_BUCKET            = aws_s3_bucket.artifact_bucket.id,
    SKILLS_S3_BUCKET     = aws_s3_bucket.skills_bucket.id,
    EXPIRY_DURATION_DAYS = tostring(var.expiry_duration_days),
    KB_ID                = aws_bedrockagent_knowledge_base.chat_kb.id,
    RERANK_MODEL_ARN     = var.rerank_model_arn,
    KB_SEARCH_TYPE       = var.kb_vector_store_type == "S3_VECTORS" ? "SEMANTIC" : "HYBRID"
    MEMORY_ID            = aws_bedrockagentcore_memory.sparky_memory.id,
    PROJECTS_TABLE             = aws_dynamodb_table.projects.id,
    PROJECT_FILES_TABLE        = aws_dynamodb_table.project_files.id,
    PROJECTS_S3_BUCKET         = aws_s3_bucket.projects_bucket.id,
    PROJECT_CANVASES_TABLE     = aws_dynamodb_table.project_canvases.id,
    PROJECTS_KB_ID             = aws_bedrockagent_knowledge_base.projects_kb.id,
    PROJECTS_KB_DATA_SOURCE_ID = aws_bedrockagent_data_source.projects_kb_source.data_source_id,
    PROJECT_MEMORY_ID          = aws_bedrockagentcore_memory.project_memory.id,
    CHECKPOINT_TABLE           = aws_dynamodb_table.checkpoints.id,
    CHECKPOINT_BUCKET          = local.checkpoint_bucket_name,
    CHECKPOINT_BUCKET_ENDPOINT = local.checkpoint_bucket_endpoint
  }

  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.user_pool.id}/.well-known/openid-configuration"
      allowed_clients = [aws_cognito_user_pool_client.client.id]
    }
  }

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${aws_ecr_repository.core_services.repository_url}:${local.core_services_image_tag}"
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  request_header_configuration {
    request_header_allowlist = ["Authorization"]
  }

  lifecycle_configuration {
    idle_runtime_session_timeout = 900
    max_lifetime                 = 14400
  }

  depends_on = [null_resource.docker_core_services_build_push]
}


#======================== IAM Role ======================

resource "aws_iam_role" "core_services_role" {
  name  = "${local.prefix}-core-services"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "bedrock-agentcore.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" : data.aws_caller_identity.caller_identity.account_id
          },
          ArnLike = {
            "aws:SourceArn" : "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:*"
          }
        }
      }
    ]
  })

  tags = {
    Name        = "${local.prefix}-core-services"
    Environment = var.env
  }
}


#======================== IAM Policies ======================

resource "aws_iam_role_policy" "core_services_base_policy" {
  name  = "${local.prefix}-core-services-base-policy"
  role  = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRImageAccess"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = aws_ecr_repository.core_services.arn
      },
      {
        Sid    = "ECRAuthToken"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchLogsCreate"
        Effect = "Allow"
        Action = [
          "logs:DescribeLogStreams",
          "logs:CreateLogGroup"
        ]
        Resource = [
          "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"
        ]
      },
      {
        Sid    = "CloudWatchLogsDescribe"
        Effect = "Allow"
        Action = [
          "logs:DescribeLogGroups"
        ]
        Resource = [
          "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:*"
        ]
      },
      {
        Sid    = "CloudWatchLogsWrite"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*"
        ]
      },
      {
        Sid    = "XRayTracing"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets"
        ]
        Resource = "*"
      },
      {
        Sid      = "CloudWatchMetrics"
        Effect   = "Allow"
        Action   = "cloudwatch:PutMetricData"
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "bedrock-agentcore"
          }
        }
      }
    ]
  })
}

# DynamoDB access for Chat History and Tool Config tables
resource "aws_iam_role_policy" "core_services_dynamodb_policy" {
  name  = "${local.prefix}-core-services-dynamodb-policy"
  role  = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      # Chat History Table access
      [
        {
          Sid    = "ChatHistoryTableAccess"
          Effect = "Allow"
          Action = [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query"
          ]
          Resource = [
            aws_dynamodb_table.sparky_chat_history.arn,
            "${aws_dynamodb_table.sparky_chat_history.arn}/index/*"
          ]
        }
      ],
      # Tool Config Table access
      [
        {
          Sid    = "ToolConfigTableAccess"
          Effect = "Allow"
          Action = [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query"
          ]
          Resource = [
            aws_dynamodb_table.tool_config.arn,
            "${aws_dynamodb_table.tool_config.arn}/index/*"
          ]
        }
      ],
      # KMS access for DynamoDB CMK encryption
      [
        {
          Sid    = "KMSAccess"
          Effect = "Allow"
          Action = [
            "kms:Decrypt",
            "kms:Encrypt",
            "kms:GenerateDataKey*",
            "kms:DescribeKey"
          ]
          Resource = [
            aws_kms_key.dynamodb.arn
          ]
        }
      ]
    )
  })
}

# Bedrock model invocation for description generation
resource "aws_iam_role_policy" "core_services_bedrock_policy" {
  name  = "${local.prefix}-core-services-bedrock-policy"
  role  = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockModelInvocation"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/*",
          "arn:aws:bedrock:*:${data.aws_caller_identity.caller_identity.account_id}:*"
        ]
      }
    ]
  })
}

# KB search and rerank permissions (only if KB indexing is enabled)
resource "aws_iam_role_policy" "core_services_kb_policy" {
  name  = "${local.prefix}-core-services-kb-policy"
  role  = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockKBRetrieve"
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve"
        ]
        Resource = aws_bedrockagent_knowledge_base.chat_kb.arn
      },
      {
        Sid    = "BedrockRerank"
        Effect = "Allow"
        Action = [
          "bedrock:Rerank"
        ]
        Resource = "*"
      }
    ]
  })
}

# SQS permissions for KB delete events (only if KB indexing is enabled)
resource "aws_iam_role_policy" "core_services_sqs_policy" {
  name  = "${local.prefix}-core-services-sqs-policy"
  role  = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSSendMessage"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = aws_sqs_queue.kb_indexing.arn
      }
    ]
  })
}

# Skills table access for skill management
resource "aws_iam_role_policy" "core_services_skills_policy" {
  name  = "${local.prefix}-core-services-skills-policy"
  role  = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SkillsTableAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.skills.arn,
          "${aws_dynamodb_table.skills.arn}/*"
        ]
      }
    ]
  })
}

# S3 access for presigned URL generation (download link refresh) - architecture bucket (PPTX only)
resource "aws_iam_role_policy" "core_services_s3_policy" {
  name  = "${local.prefix}-core-services-s3-policy"
  role  = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3GetObjectForPresignedUrls"
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.artifact_bucket.arn}/artifact/*"
      }
    ]
  })
}

# S3 access for skills content in the dedicated skills bucket
resource "aws_iam_role_policy" "core_services_skills_s3_policy" {
  name  = "${local.prefix}-core-services-skills-s3-policy"
  role  = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SkillsBucketObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.skills_bucket.arn}/*"
      },
      {
        Sid    = "SkillsBucketListAccess"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.skills_bucket.arn
      }
    ]
  })
}

# Projects S3 access — presigned URL generation, sidecar writes, object deletes
resource "aws_iam_role_policy" "core_services_projects_s3_policy" {
  name = "${local.prefix}-core-services-projects-s3-policy"
  role = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ProjectsBucketObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.projects_bucket.arn}/*"
      },
      {
        Sid      = "ProjectsBucketListAccess"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.projects_bucket.arn
      }
    ]
  })
}

# Projects KB — trigger S3 ingestion jobs after file upload or delete
resource "aws_iam_role_policy" "core_services_projects_kb_policy" {
  name = "${local.prefix}-core-services-projects-kb-policy"
  role = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ProjectsKBIngestion"
        Effect = "Allow"
        Action = [
          "bedrock:StartIngestionJob",
          "bedrock:GetIngestionJob",
          "bedrock:ListIngestionJobs"
        ]
        Resource = aws_bedrockagent_knowledge_base.projects_kb.arn
      }
    ]
  })
}

# Projects DynamoDB — CRUD on projects + project_files tables
resource "aws_iam_role_policy" "core_services_projects_dynamodb_policy" {
  name = "${local.prefix}-core-services-projects-dynamodb-policy"
  role = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ProjectsTableAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.projects.arn,
          "${aws_dynamodb_table.projects.arn}/index/*"
        ]
      },
      {
        Sid    = "ProjectFilesTableAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.project_files.arn,
          "${aws_dynamodb_table.project_files.arn}/index/*"
        ]
      },
      {
        Sid    = "ProjectCanvasesTableAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.project_canvases.arn,
          "${aws_dynamodb_table.project_canvases.arn}/index/*"
        ]
      }
    ]
  })
}

# AgentCore Memory read access for session history retrieval via LangGraph checkpointer
resource "aws_iam_role_policy" "core_services_agentcore_memory_policy" {
  name = "${local.prefix}-core-services-agentcore-memory-policy"
  role = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AgentCoreMemoryRead"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:GetMemory",
          "bedrock-agentcore:GetSession",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:ListSessions"
        ]
        Resource = aws_bedrockagentcore_memory.sparky_memory.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "core_services_project_memory_policy" {
  name = "${local.prefix}-core-services-project-memory-policy"
  role = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ProjectMemoryAccess"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:ListMemoryRecords",
          "bedrock-agentcore:DeleteMemoryRecord"
        ]
        Resource = aws_bedrockagentcore_memory.project_memory.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "core_services_checkpointer_policy" {
  name = "${local.prefix}-core-services-checkpointer-policy"
  role = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid    = "CheckpointTableRead"
          Effect = "Allow"
          Action = [
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:BatchGetItem",
          ]
          Resource = aws_dynamodb_table.checkpoints.arn
        }
      ],
      var.use_express_checkpoint_bucket ? [
        {
          Sid      = "S3ExpressSession"
          Effect   = "Allow"
          Action   = ["s3express:CreateSession"]
          Resource = "arn:aws:s3express:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:bucket/${local.checkpoint_bucket_name}"
        },
        {
          Sid    = "S3ExpressRead"
          Effect = "Allow"
          Action = ["s3:GetObject"]
          Resource = "arn:aws:s3express:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:bucket/${local.checkpoint_bucket_name}/*"
        }
      ] : [
        {
          Sid    = "S3CheckpointRead"
          Effect = "Allow"
          Action = ["s3:GetObject"]
          Resource = "${aws_s3_bucket.checkpoint_offload[0].arn}/*"
        }
      ]
    )
  })
}
