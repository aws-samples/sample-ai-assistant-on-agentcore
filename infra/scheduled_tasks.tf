# Scheduled Tasks Infrastructure
# DynamoDB tables, SQS queue, Lambda executor, IAM roles,
# and EventBridge Scheduler permissions for scheduled job execution.

#======================== DynamoDB Tables ======================

resource "aws_dynamodb_table" "scheduled_tasks" {
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "user_id"
  range_key                   = "job_id"
  name                        = "${local.prefix}-scheduled-tasks"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "job_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name            = "status-index"
    projection_type = "ALL"

    key_schema {
      attribute_name = "user_id"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "status"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }
}

resource "aws_dynamodb_table" "scheduled_task_executions" {
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "job_id"
  range_key                   = "execution_id"
  name                        = "${local.prefix}-scheduled-task-executions"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "job_id"
    type = "S"
  }

  attribute {
    name = "execution_id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  global_secondary_index {
    name            = "user-executions-index"
    projection_type = "ALL"

    key_schema {
      attribute_name = "user_id"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "execution_id"
      key_type       = "RANGE"
    }
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }
}


#======================== SQS Queue ======================

resource "aws_sqs_queue" "task_execution" {
  name = "${local.prefix}-task-execution"

  visibility_timeout_seconds = 960 # > Lambda 900s timeout
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  receive_wait_time_seconds  = 10

  tags = {
    Name        = "${local.prefix}-task-execution"
    Environment = var.env
  }
}

resource "aws_sqs_queue" "task_execution_dlq" {
  name = "${local.prefix}-task-execution-dlq"

  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true

  tags = {
    Name        = "${local.prefix}-task-execution-dlq"
    Environment = var.env
  }
}

resource "aws_sqs_queue_redrive_policy" "task_execution" {
  queue_url = aws_sqs_queue.task_execution.id

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.task_execution_dlq.arn
    maxReceiveCount     = 3
  })
}


#======================== Lambda Deployment Package ======================

data "archive_file" "task_executor" {
  type        = "zip"
  source_dir  = "${path.module}/build/task_executor_code"
  output_path = "${path.module}/build/task_executor.zip"

  depends_on = [null_resource.build]
}


#======================== Task Executor IAM Role ======================

resource "aws_iam_role" "task_executor_role" {
  name = "${local.prefix}-task-executor-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${local.prefix}-task-executor-role"
    Environment = var.env
  }
}

# DynamoDB read/write for task tables
resource "aws_iam_role_policy" "task_executor_dynamodb_policy" {
  name = "${local.prefix}-task-executor-dynamodb-policy"
  role = aws_iam_role.task_executor_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.scheduled_tasks.arn,
          "${aws_dynamodb_table.scheduled_tasks.arn}/index/*",
          aws_dynamodb_table.scheduled_task_executions.arn,
          "${aws_dynamodb_table.scheduled_task_executions.arn}/index/*"
        ]
      }
    ]
  })
}

# S3 write for execution artifacts
resource "aws_iam_role_policy" "task_executor_s3_policy" {
  name = "${local.prefix}-task-executor-s3-policy"
  role = aws_iam_role.task_executor_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Write"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.artifact_bucket.arn}/*"
      }
    ]
  })
}

# AgentCore invoke for running the agent
resource "aws_iam_role_policy" "task_executor_agentcore_policy" {
  name = "${local.prefix}-task-executor-agentcore-policy"
  role = aws_iam_role.task_executor_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AgentCoreInvoke"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:InvokeAgentRuntime"
        ]
        Resource = [
          aws_bedrockagentcore_agent_runtime.sparky.agent_runtime_arn,
          "${aws_bedrockagentcore_agent_runtime.sparky.agent_runtime_arn}/*"
        ]
      }
    ]
  })
}

# SQS receive/delete
resource "aws_iam_role_policy" "task_executor_sqs_policy" {
  name = "${local.prefix}-task-executor-sqs-policy"
  role = aws_iam_role.task_executor_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSReceiveDelete"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.task_execution.arn
      }
    ]
  })
}

# CloudWatch Logs
resource "aws_iam_role_policy" "task_executor_logs_policy" {
  name = "${local.prefix}-task-executor-logs-policy"
  role = aws_iam_role.task_executor_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:/aws/lambda/${local.prefix}-task-executor:*"
      }
    ]
  })
}

# KMS access for encrypted DynamoDB tables
resource "aws_iam_role_policy" "task_executor_kms_policy" {
  name = "${local.prefix}-task-executor-kms-policy"
  role = aws_iam_role.task_executor_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.dynamodb.arn
      }
    ]
  })
}


#======================== Lambda Function ======================

resource "aws_lambda_function" "task_executor" {
  function_name = "${local.prefix}-task-executor"
  description   = "Executes scheduled tasks by invoking the Sparky agent runtime"
  role          = aws_iam_role.task_executor_role.arn

  filename         = data.archive_file.task_executor.output_path
  source_code_hash = data.archive_file.task_executor.output_base64sha256
  handler          = "handler.handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]

  memory_size = 256
  timeout     = 900

  environment {
    variables = {
      TASK_JOBS_TABLE       = aws_dynamodb_table.scheduled_tasks.id
      TASK_EXECUTIONS_TABLE = aws_dynamodb_table.scheduled_task_executions.id
      SPARKY_RUNTIME_ARN    = aws_bedrockagentcore_agent_runtime.sparky.agent_runtime_arn
      S3_BUCKET             = aws_s3_bucket.artifact_bucket.id
      REGION                = var.region
      LOG_LEVEL             = "INFO"
      COGNITO_TOKEN_URL     = "https://${aws_cognito_user_pool_domain.domain.domain}.auth.${var.region}.amazoncognito.com/oauth2/token"
      COGNITO_CLIENT_ID     = aws_cognito_user_pool_client.task_executor.id
      COGNITO_CLIENT_SECRET = aws_cognito_user_pool_client.task_executor.client_secret
      COGNITO_SCOPE         = "sparky-api/invoke"
    }
  }

  depends_on = [
    aws_iam_role_policy.task_executor_logs_policy,
    aws_iam_role_policy.task_executor_dynamodb_policy,
    aws_iam_role_policy.task_executor_sqs_policy,
    aws_iam_role_policy.task_executor_agentcore_policy,
    aws_iam_role_policy.task_executor_kms_policy,
  ]

  tags = {
    Name        = "${local.prefix}-task-executor"
    Environment = var.env
  }
}

resource "aws_lambda_event_source_mapping" "task_executor_sqs" {
  event_source_arn = aws_sqs_queue.task_execution.arn
  function_name    = aws_lambda_function.task_executor.arn
  enabled          = true
  batch_size       = 1

  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_cloudwatch_log_group" "task_executor" {
  name              = "/aws/lambda/${local.prefix}-task-executor"
  retention_in_days = 14

  tags = {
    Name        = "${local.prefix}-task-executor-logs"
    Environment = var.env
  }
}


#======================== EventBridge Scheduler IAM Role ======================

resource "aws_iam_role" "task_scheduler_role" {
  name = "${local.prefix}-task-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${local.prefix}-task-scheduler-role"
    Environment = var.env
  }
}

resource "aws_iam_role_policy" "task_scheduler_sqs_policy" {
  name = "${local.prefix}-task-scheduler-sqs-policy"
  role = aws_iam_role.task_scheduler_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSSendMessage"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = aws_sqs_queue.task_execution.arn
      }
    ]
  })
}


#======================== Core Services Scheduler Permissions ======================

# Allow core_services runtime to manage EventBridge Scheduler schedules
resource "aws_iam_role_policy" "core_services_scheduler_policy" {
  name = "${local.prefix}-core-services-scheduler-policy"
  role = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SchedulerManage"
        Effect = "Allow"
        Action = [
          "scheduler:CreateSchedule",
          "scheduler:GetSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:ListSchedules"
        ]
        Resource = "arn:aws:scheduler:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:schedule/${local.prefix}-scheduled-tasks/${local.prefix}-task-*"
      },
      {
        Sid    = "ScheduleGroupManage"
        Effect = "Allow"
        Action = [
          "scheduler:GetScheduleGroup",
          "scheduler:CreateScheduleGroup"
        ]
        Resource = "arn:aws:scheduler:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:schedule-group/${local.prefix}-scheduled-tasks"
      },
      {
        Sid    = "TaskQueueAttributes"
        Effect = "Allow"
        Action = [
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.task_execution.arn
      },
      {
        Sid      = "PassSchedulerRole"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.task_scheduler_role.arn
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "scheduler.amazonaws.com"
          }
        }
      }
    ]
  })
}

# Allow core_services to read/write task DynamoDB tables
resource "aws_iam_role_policy" "core_services_task_dynamodb_policy" {
  name = "${local.prefix}-core-services-task-dynamodb-policy"
  role = aws_iam_role.core_services_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TaskDynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.scheduled_tasks.arn,
          "${aws_dynamodb_table.scheduled_tasks.arn}/index/*",
          aws_dynamodb_table.scheduled_task_executions.arn,
          "${aws_dynamodb_table.scheduled_task_executions.arn}/index/*"
        ]
      }
    ]
  })
}
