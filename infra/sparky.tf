resource "aws_bedrockagentcore_agent_runtime" "sparky" {
  agent_runtime_name = "sparky_sparky"
  role_arn           = aws_iam_role.sparky_role.arn
  environment_variables = {
    CHAT_HISTORY_TABLE         = aws_dynamodb_table.sparky_chat_history.id,
    TOOL_CONFIG_TABLE          = aws_dynamodb_table.tool_config.id,
    SKILLS_TABLE               = aws_dynamodb_table.skills.id,
    S3_BUCKET                  = aws_s3_bucket.artifact_bucket.id,
    SKILLS_S3_BUCKET           = aws_s3_bucket.skills_bucket.id,
    REGION                     = var.region,
    MEMORY_ID                  = aws_bedrockagentcore_memory.sparky_memory.id,
    CODE_INTERPRETER_ID        = aws_bedrockagentcore_code_interpreter.sparky_ci.code_interpreter_id,
    BROWSER_TOOL_ID            = aws_bedrockagentcore_browser.sparky_browser.browser_id,
    SPARKY_MODEL_CONFIG        = jsonencode(var.sparky_models),
    EXPIRY_DURATION_DAYS       = tostring(var.expiry_duration_days),
    KB_INDEXING_QUEUE_URL      = aws_sqs_queue.kb_indexing.url,
    KB_ID                      = aws_bedrockagent_knowledge_base.chat_kb.id,
    RERANK_MODEL_ARN           = var.rerank_model_arn,
    KB_SEARCH_TYPE             = var.kb_vector_store_type == "S3_VECTORS" ? "SEMANTIC" : "HYBRID",
    PROJECTS_KB_ID             = aws_bedrockagent_knowledge_base.projects_kb.id,
    PROJECTS_TABLE             = aws_dynamodb_table.projects.id,
    PROJECT_FILES_TABLE        = aws_dynamodb_table.project_files.id,
    PROJECTS_S3_BUCKET         = aws_s3_bucket.projects_bucket.id,
    PROJECT_MEMORY_ID          = aws_bedrockagentcore_memory.project_memory.id,
    PROJECT_CANVASES_TABLE     = aws_dynamodb_table.project_canvases.id,
    CHECKPOINT_TABLE           = aws_dynamodb_table.checkpoints.id,
    CHECKPOINT_BUCKET          = local.checkpoint_bucket_name,
    CHECKPOINT_BUCKET_ENDPOINT = local.checkpoint_bucket_endpoint
    TASK_EXECUTIONS_TABLE      = aws_dynamodb_table.scheduled_task_executions.id
  }
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.user_pool.id}/.well-known/openid-configuration"
      allowed_clients = [aws_cognito_user_pool_client.client.id, aws_cognito_user_pool_client.task_executor.id]
    }
  }
  agent_runtime_artifact {
    container_configuration {
      container_uri = "${aws_ecr_repository.sparky.repository_url}:${local.sparky_image_tag}"
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
  depends_on = [null_resource.docker_build_push]
}


resource "aws_ecr_repository" "sparky" {
  name                 = "${local.prefix}-sparky"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "null_resource" "docker_build_push" {
  depends_on = [aws_ecr_repository.sparky]

  triggers = {
    dockerfile_hash   = filemd5("${path.module}/../backend/sparky/Dockerfile")
    requirements_hash = filemd5("${path.module}/../backend/sparky/requirements.txt")
    source_hash       = sha256(join("", [for f in fileset("${path.module}/../backend/sparky", "**") : filesha256("${path.module}/../backend/sparky/${f}")]))
    image_tag         = local.sparky_image_tag
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../backend/sparky"
    command     = <<-EOT
      # Get ECR login token
      aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
      aws ecr get-login-password --region ${var.region} | docker login --username AWS --password-stdin ${aws_ecr_repository.sparky.repository_url}
      
      # Ensure buildx is set up
      docker buildx create --use --name multiarch 2>/dev/null || docker buildx use multiarch
      
      # Build and push image for ARM64 with content-based tag
      docker buildx build --platform linux/arm64 --build-arg AWS_REGION=${var.region} \
        -t ${aws_ecr_repository.sparky.repository_url}:${local.sparky_image_tag} \
        -t ${aws_ecr_repository.sparky.repository_url}:latest \
        --push .
    EOT
  }
}



resource "aws_iam_role" "sparky_role" {
  name = "${local.prefix}-sparky"

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
}

resource "aws_iam_role_policy" "agent_core_policy" {
  name = "${local.prefix}-sparky-policy"
  role = aws_iam_role.sparky_role.id

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "ECRImageAccess",
        "Effect" : "Allow",
        "Action" : [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ],
        "Resource" : [
          "${aws_ecr_repository.sparky.arn}"
        ]
      },
      {
        "Sid" : "ECRAuthToken",
        "Effect" : "Allow",
        "Action" : [
          "ecr:GetAuthorizationToken"
        ],
        "Resource" : "*"
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "logs:DescribeLogStreams",
          "logs:CreateLogGroup"
        ],
        "Resource" : [
          "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"
        ]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "logs:DescribeLogGroups"
        ],
        "Resource" : [
          "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:*"
        ]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        "Resource" : [
          "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*"
        ]
      },
      {
        "Sid" : "ECRTokenAccess",
        "Effect" : "Allow",
        "Action" : [
          "ecr:GetAuthorizationToken"
        ],
        "Resource" : "*"
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets"
        ],
        "Resource" : [
          "*"
        ]
      },
      {
        "Sid" : "ChatHistoryTableAccess",
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ],
        "Resource" : [
          "${aws_dynamodb_table.sparky_chat_history.arn}",
          "${aws_dynamodb_table.sparky_chat_history.arn}/index/*"
        ]
      },
      {
        "Sid" : "ToolConfigTableAccess",
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ],
        "Resource" : [
          "${aws_dynamodb_table.tool_config.arn}",
          "${aws_dynamodb_table.tool_config.arn}/index/*"
        ]
      },
      {
        "Sid" : "SkillsTableAccess",
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ],
        "Resource" : [
          "${aws_dynamodb_table.skills.arn}",
          "${aws_dynamodb_table.skills.arn}/*"
        ]
      },
      {
        "Sid" : "S3ArtifactGetObject",
        "Effect" : "Allow",
        "Action" : ["s3:GetObject"],
        "Resource" : ["${aws_s3_bucket.artifact_bucket.arn}/*"]
      },
      {
        "Sid" : "S3PutArtifacts",
        "Effect" : "Allow",
        "Action" : ["s3:PutObject"],
        "Resource" : [
          "${aws_s3_bucket.artifact_bucket.arn}/artifact/*",
          "${aws_s3_bucket.artifact_bucket.arn}/task-outputs/*"
        ]
      },
      {
        "Sid" : "S3PutImages",
        "Effect" : "Allow",
        "Action" : ["s3:PutObject"],
        "Resource" : "${aws_s3_bucket.artifact_bucket.arn}/img/*"
      },
      {
        "Sid" : "SkillsBucketObjectAccess",
        "Effect" : "Allow",
        "Action" : ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        "Resource" : "${aws_s3_bucket.skills_bucket.arn}/*"
      },
      {
        "Sid" : "SkillsBucketListAccess",
        "Effect" : "Allow",
        "Action" : ["s3:ListBucket"],
        "Resource" : "${aws_s3_bucket.skills_bucket.arn}"
      },
      {
        "Effect" : "Allow",
        "Resource" : "*",
        "Action" : "cloudwatch:PutMetricData",
        "Condition" : {
          "StringEquals" : {
            "cloudwatch:namespace" : "bedrock-agentcore"
          }
        }
      },
      {
        "Sid" : "GetAgentAccessToken",
        "Effect" : "Allow",
        "Action" : [
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "bedrock-agentcore:GetWorkloadAccessTokenForUserId"
        ],
        "Resource" : [
          "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:workload-identity-directory/default",
          "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:workload-identity-directory/default/workload-identity/*"
        ]
      },
      {
        "Sid" : "BedrockModelInvocation",
        "Effect" : "Allow",
        "Action" : [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ],
        "Resource" : [
          "arn:aws:bedrock:*::foundation-model/*",
          "arn:aws:bedrock:*:${data.aws_caller_identity.caller_identity.account_id}:*"
        ]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "sts:AssumeRole"
        ],
        "Resource" : [
          "*"
        ]
      },
      {
        "Sid" : "BedrockSessionPermissions",
        "Effect" : "Allow",
        "Action" : [
          "bedrock:CreateSession",
          "bedrock:GetSession",
          "bedrock:UpdateSession",
          "bedrock:DeleteSession",
          "bedrock:EndSession",
          "bedrock:ListSessions",
          "bedrock:CreateInvocation",
          "bedrock:ListInvocations",
          "bedrock:PutInvocationStep",
          "bedrock:GetInvocationStep",
          "bedrock:ListInvocationSteps"
        ],
        "Resource" : [
          "*"
        ]
      },
      {
        "Sid" : "BedrockSessionTagging",
        "Effect" : "Allow",
        "Action" : [
          "bedrock:TagResource",
          "bedrock:UntagResource",
          "bedrock:ListTagsForResource"
        ],
        "Resource" : "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:session/*"
      },
      {
        "Sid" : "AgentCoreMemoryAccess",
        "Effect" : "Allow",
        "Action" : [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:DeleteEvent",
          "bedrock-agentcore:ListSessions",
          "bedrock-agentcore:ListActors",
          "bedrock-agentcore:RetrieveMemoryRecords",
          "bedrock-agentcore:ListMemoryRecords",
          "bedrock-agentcore:GetMemoryRecord"
        ],
        "Resource" : "${aws_bedrockagentcore_memory.sparky_memory.arn}"
      },
      {
        "Sid" : "CodeInterpreterAccess",
        "Effect" : "Allow",
        "Action" : [
          "bedrock-agentcore:InvokeCodeInterpreter",
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:StopCodeInterpreterSession",
          "bedrock-agentcore:GetCodeInterpreter",
          "bedrock-agentcore:GetCodeInterpreterSession",
          "bedrock-agentcore:ListCodeInterpreterSessions"
        ],
        "Resource" : [
          "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:code-interpreter/*",
          "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:code-interpreter-custom/*"
        ]
      },
      {
        "Sid" : "BrowserToolAccess",
        "Effect" : "Allow",
        "Action" : [
          "bedrock-agentcore:StartBrowserSession",
          "bedrock-agentcore:StopBrowserSession",
          "bedrock-agentcore:GetBrowserSession",
          "bedrock-agentcore:InvokeBrowser",
          "bedrock-agentcore:GetBrowser",
          "bedrock-agentcore:UpdateBrowserStream",
          "bedrock-agentcore:ConnectBrowserAutomationStream",
          "bedrock-agentcore:ConnectBrowserLiveViewStream"
        ],
        "Resource" : [
          "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:browser/*",
          "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:browser-custom/*"
        ]
      },
      {
        "Sid" : "KMSAccess",
        "Effect" : "Allow",
        "Action" : [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ],
        "Resource" : [
          "${aws_kms_key.dynamodb.arn}"
        ]
      }
    ]
  })
}

resource "aws_dynamodb_table" "sparky_chat_history" {
  name         = "${local.prefix}-sparky-chat-history"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"

  attribute {
    name = "session_id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "user_id-index"
    projection_type = "ALL"

    key_schema {
      attribute_name = "user_id"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "created_at"
      key_type       = "RANGE"
    }
  }

  ttl {
    attribute_name = "expiry_ttl"
    enabled        = true
  }

  stream_enabled   = true
  stream_view_type = "OLD_IMAGE"

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }
}


# Code Interpreter resource for PPTX generation
resource "aws_bedrockagentcore_code_interpreter" "sparky_ci" {
  name               = replace("${local.prefix}_sparky_ci", "-", "_")
  description        = "Code Interpreter for Sparky agent PPTX generation"
  execution_role_arn = aws_iam_role.code_interpreter_role.arn

  network_configuration {
    network_mode = "PUBLIC"
  }

  timeouts {
    create = "10m"
    delete = "10m"
  }
}

# IAM role for Code Interpreter execution
resource "aws_iam_role" "code_interpreter_role" {
  name = "${local.prefix}-code-interpreter"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockAgentCoreBuiltInTools"
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "bedrock-agentcore.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" : data.aws_caller_identity.caller_identity.account_id
          }
          ArnLike = {
            "aws:SourceArn" : "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:*"
          }
        }
      }
    ]
  })
}

# Browser tool resource for AgentCore Browser
resource "aws_bedrockagentcore_browser" "sparky_browser" {
  name               = replace("${local.prefix}_sparky_browser", "-", "_")
  description        = "Browser tool for Sparky agent web browsing"
  execution_role_arn = aws_iam_role.browser_tool_role.arn

  network_configuration {
    network_mode = "PUBLIC"
  }

  timeouts {
    create = "10m"
    delete = "10m"
  }
}

# IAM role for Browser tool execution
resource "aws_iam_role" "browser_tool_role" {
  name = "${local.prefix}-browser-tool"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockAgentCoreBuiltInTools"
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "bedrock-agentcore.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" : data.aws_caller_identity.caller_identity.account_id
          }
          ArnLike = {
            "aws:SourceArn" : "arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:*"
          }
        }
      }
    ]
  })
}

# Projects KB retrieve + projects table read for Sparky agent
resource "aws_iam_role_policy" "sparky_projects_policy" {
  name = "${local.prefix}-sparky-projects-policy"
  role = aws_iam_role.sparky_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ProjectsKBRetrieve"
        Effect   = "Allow"
        Action   = ["bedrock:Retrieve"]
        Resource = aws_bedrockagent_knowledge_base.projects_kb.arn
      },
      {
        Sid      = "ProjectsTableRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = aws_dynamodb_table.projects.arn
      },
      {
        Sid    = "ProjectFilesTableRead"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          aws_dynamodb_table.project_files.arn,
          "${aws_dynamodb_table.project_files.arn}/index/*"
        ]
      },
      {
        Sid      = "ProjectsS3Read"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.projects_bucket.arn}/*"
      }
    ]
  })
}

# DynamoDB + S3 permissions for project canvas artifacts
resource "aws_iam_role_policy" "sparky_project_canvases_policy" {
  name = "${local.prefix}-sparky-project-canvases-policy"
  role = aws_iam_role.sparky_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ProjectCanvasesTableAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ]
        Resource = [
          aws_dynamodb_table.project_canvases.arn,
          "${aws_dynamodb_table.project_canvases.arn}/index/*",
        ]
      },
      {
        Sid    = "ProjectsS3CanvasesAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.projects_bucket.arn}/canvases/*"
      }
    ]
  })
}


# S3 permissions for Code Interpreter execution role
resource "aws_iam_role_policy" "code_interpreter_s3_policy" {
  name = "${local.prefix}-code-interpreter-s3"
  role = aws_iam_role.code_interpreter_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ArtifactAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.artifact_bucket.arn}/artifact/*"
      },
      {
        Sid    = "S3ImageUploadAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.artifact_bucket.arn}/img/*"
      }
    ]
  })
}


