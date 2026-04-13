# Expiry Cleanup Lambda Infrastructure
# Triggered by DynamoDB Streams REMOVE events to delete corresponding
# Bedrock KB documents when chat history items expire via TTL.

#======================== Lambda Deployment Package ======================

data "archive_file" "expiry_cleanup" {
  type        = "zip"
  source_dir  = "${path.module}/build/expiry_cleanup_code"
  output_path = "${path.module}/build/expiry_cleanup.zip"

  depends_on = [null_resource.build]
}

#======================== Lambda Function ======================

resource "aws_lambda_function" "expiry_cleanup" {
  function_name = "${local.prefix}-expiry-cleanup"
  description   = "Lambda function for cleaning up Bedrock KB documents when chat history items expire"
  role          = aws_iam_role.expiry_cleanup_role.arn

  filename         = data.archive_file.expiry_cleanup.output_path
  source_code_hash = data.archive_file.expiry_cleanup.output_base64sha256
  handler          = "handler.handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]

  memory_size = 1024
  timeout     = 300

  environment {
    variables = {
      KB_ID             = aws_bedrockagent_knowledge_base.chat_kb.id
      KB_DATA_SOURCE_ID = aws_bedrockagent_data_source.chat_kb_source.data_source_id
      MEMORY_ID         = aws_bedrockagentcore_memory.sparky_memory.id
      REGION            = var.region
      LOG_LEVEL         = "INFO"
    }
  }

  depends_on = [
    aws_iam_role_policy.expiry_cleanup_logs_policy,
    aws_iam_role_policy.expiry_cleanup_bedrock_policy,
    aws_iam_role_policy.expiry_cleanup_sqs_policy,
    aws_iam_role_policy.expiry_cleanup_memory_policy,
    aws_bedrockagent_knowledge_base.chat_kb,
    aws_bedrockagent_data_source.chat_kb_source
  ]

  tags = {
    Name        = "${local.prefix}-expiry-cleanup"
    Environment = var.env
  }
}

#======================== CloudWatch Log Group ======================

resource "aws_cloudwatch_log_group" "expiry_cleanup" {
  name              = "/aws/lambda/${local.prefix}-expiry-cleanup"
  retention_in_days = 14

  tags = {
    Name        = "${local.prefix}-expiry-cleanup-logs"
    Environment = var.env
  }
}


#======================== IAM Role and Policies ======================

resource "aws_iam_role" "expiry_cleanup_role" {
  name = "${local.prefix}-expiry-cleanup-role"

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
    Name        = "${local.prefix}-expiry-cleanup-role"
    Environment = var.env
  }
}


# Policy for Bedrock KB delete access
resource "aws_iam_role_policy" "expiry_cleanup_bedrock_policy" {
  name = "${local.prefix}-expiry-cleanup-bedrock-policy"
  role = aws_iam_role.expiry_cleanup_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockKBDelete"
        Effect = "Allow"
        Action = [
          "bedrock:DeleteKnowledgeBaseDocuments",
          "bedrock:StartIngestionJob"
        ]
        Resource = aws_bedrockagent_knowledge_base.chat_kb.arn
      }
    ]
  })
}

# Policy for CloudWatch Logs
resource "aws_iam_role_policy" "expiry_cleanup_logs_policy" {
  name = "${local.prefix}-expiry-cleanup-logs-policy"
  role = aws_iam_role.expiry_cleanup_role.id

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
        Resource = "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:/aws/lambda/${local.prefix}-expiry-cleanup:*"
      }
    ]
  })
}


# Policy for SQS read access on KB Cleanup Queue
resource "aws_iam_role_policy" "expiry_cleanup_sqs_policy" {
  name = "${local.prefix}-expiry-cleanup-sqs-policy"
  role = aws_iam_role.expiry_cleanup_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSRead"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.kb_cleanup.arn
      }
    ]
  })
}

# Policy for AgentCore Memory delete access
resource "aws_iam_role_policy" "expiry_cleanup_memory_policy" {
  name = "${local.prefix}-expiry-cleanup-memory-policy"
  role = aws_iam_role.expiry_cleanup_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AgentCoreMemoryDelete"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:DeleteEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:ListSessions"
        ]
        Resource = aws_bedrockagentcore_memory.sparky_memory.arn
      }
    ]
  })
}


# Policy for KMS CMK access (decrypt stream/SQS data encrypted with CMK)
resource "aws_iam_role_policy" "expiry_cleanup_kms_policy" {
  name = "${local.prefix}-expiry-cleanup-kms-policy"
  role = aws_iam_role.expiry_cleanup_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.dynamodb.arn
      }
    ]
  })
}


#======================== KB Cleanup SQS Queue ======================

# Dedicated SQS queue for KB cleanup events with 5-minute delay
# to ensure in-flight ingest operations complete before deletion runs
resource "aws_sqs_queue" "kb_cleanup" {
  name = "${local.prefix}-kb-cleanup"

  delay_seconds              = 300
  visibility_timeout_seconds = 300
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  receive_wait_time_seconds  = 10

  tags = {
    Name        = "${local.prefix}-kb-cleanup"
    Environment = var.env
  }
}

# Dead letter queue for failed KB cleanup messages
resource "aws_sqs_queue" "kb_cleanup_dlq" {
  name = "${local.prefix}-kb-cleanup-dlq"

  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true

  tags = {
    Name        = "${local.prefix}-kb-cleanup-dlq"
    Environment = var.env
  }
}

# Redrive policy to send failed messages to DLQ after 3 attempts
resource "aws_sqs_queue_redrive_policy" "kb_cleanup" {
  queue_url = aws_sqs_queue.kb_cleanup.id

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.kb_cleanup_dlq.arn
    maxReceiveCount     = 3
  })
}


#======================== EventBridge Pipe ======================

# IAM role for the EventBridge Pipe
resource "aws_iam_role" "kb_cleanup_pipe_role" {
  name = "${local.prefix}-kb-cleanup-pipe-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "pipes.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${local.prefix}-kb-cleanup-pipe-role"
    Environment = var.env
  }
}

# Policy for the pipe to read from DynamoDB Stream and send to SQS
resource "aws_iam_role_policy" "kb_cleanup_pipe_policy" {
  name = "${local.prefix}-kb-cleanup-pipe-policy"
  role = aws_iam_role.kb_cleanup_pipe_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBStreamRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:DescribeStream",
          "dynamodb:ListStreams"
        ]
        Resource = "${aws_dynamodb_table.sparky_chat_history.arn}/stream/*"
      },
      {
        Sid    = "SQSSendMessage"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = aws_sqs_queue.kb_cleanup.arn
      },
      {
        Sid    = "KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.dynamodb.arn
      }
    ]
  })
}

# EventBridge Pipe: DynamoDB Stream REMOVE events → KB Cleanup SQS Queue
resource "aws_pipes_pipe" "kb_cleanup_pipe" {
  name     = "${local.prefix}-kb-cleanup-pipe"
  role_arn = aws_iam_role.kb_cleanup_pipe_role.arn

  source = aws_dynamodb_table.sparky_chat_history.stream_arn
  target = aws_sqs_queue.kb_cleanup.arn

  source_parameters {
    dynamodb_stream_parameters {
      starting_position = "LATEST"
    }

    filter_criteria {
      filter {
        pattern = jsonencode({
          eventName = ["REMOVE"]
        })
      }
    }
  }

  depends_on = [
    aws_iam_role_policy.kb_cleanup_pipe_policy
  ]

  tags = {
    Name        = "${local.prefix}-kb-cleanup-pipe"
    Environment = var.env
  }
}


#======================== SQS Event Source Mapping ======================

# Trigger the cleanup Lambda from the KB Cleanup SQS queue
resource "aws_lambda_event_source_mapping" "expiry_cleanup_sqs" {
  event_source_arn = aws_sqs_queue.kb_cleanup.arn
  function_name    = aws_lambda_function.expiry_cleanup.arn
  batch_size       = 10

  # Limit concurrent Lambda invocations to prevent throttling
  # on downstream AgentCore DeleteEvent API calls
  scaling_config {
    maximum_concurrency = 2
  }

  function_response_types = ["ReportBatchItemFailures"]
}