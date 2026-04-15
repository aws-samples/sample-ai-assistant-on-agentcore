# KB Indexing Infrastructure
# This file contains resources for asynchronous indexing of chat conversations
# into Amazon Bedrock Knowledge Base using direct ingestion APIs.

#======================== SQS Queue ======================

resource "aws_sqs_queue" "kb_indexing" {
  name = "${local.prefix}-kb-indexing"

  # Visibility timeout should be longer than Lambda timeout to prevent duplicate processing
  visibility_timeout_seconds = 300

  # Retain messages for 4 days (default is 4 days, max is 14 days)
  message_retention_seconds = 345600

  # Enable server-side encryption
  sqs_managed_sse_enabled = true

  # Receive wait time for long polling
  receive_wait_time_seconds = 10

  tags = {
    Name        = "${local.prefix}-kb-indexing"
    Environment = var.env
  }
}

# Dead letter queue for failed messages
resource "aws_sqs_queue" "kb_indexing_dlq" {
  name = "${local.prefix}-kb-indexing-dlq"

  message_retention_seconds = 1209600 # 14 days for DLQ
  sqs_managed_sse_enabled   = true

  tags = {
    Name        = "${local.prefix}-kb-indexing-dlq"
    Environment = var.env
  }
}

# Redrive policy to send failed messages to DLQ after 3 attempts
resource "aws_sqs_queue_redrive_policy" "kb_indexing" {
  queue_url = aws_sqs_queue.kb_indexing.id

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.kb_indexing_dlq.arn
    maxReceiveCount     = 3
  })
}


#======================== Lambda Deployment Package ======================

data "archive_file" "kb_indexer" {
  type        = "zip"
  source_dir  = "${path.module}/build/kb_indexer_code"
  output_path = "${path.module}/build/kb_indexer.zip"

  depends_on = [null_resource.build]
}


#======================== IAM Role and Policies ======================

resource "aws_iam_role" "kb_indexer_role" {
  name = "${local.prefix}-kb-indexer-role"

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
    Name        = "${local.prefix}-kb-indexer-role"
    Environment = var.env
  }
}

# Policy for Bedrock KB APIs
resource "aws_iam_role_policy" "kb_indexer_bedrock_policy" {
  name = "${local.prefix}-kb-indexer-bedrock-policy"
  role = aws_iam_role.kb_indexer_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockKBIngest"
        Effect = "Allow"
        Action = [
          "bedrock:IngestKnowledgeBaseDocuments",
          "bedrock:StartIngestionJob"
        ]
        Resource = aws_bedrockagent_knowledge_base.chat_kb.arn
      },
      {
        Sid    = "BedrockKBDelete"
        Effect = "Allow"
        Action = [
          "bedrock:DeleteKnowledgeBaseDocuments"
        ]
        Resource = aws_bedrockagent_knowledge_base.chat_kb.arn
      },
      {
        Sid    = "BedrockKBList"
        Effect = "Allow"
        Action = [
          "bedrock:ListKnowledgeBaseDocuments"
        ]
        Resource = aws_bedrockagent_knowledge_base.chat_kb.arn
      }
    ]
  })
}

# Policy for SQS receive/delete
resource "aws_iam_role_policy" "kb_indexer_sqs_policy" {
  name = "${local.prefix}-kb-indexer-sqs-policy"
  role = aws_iam_role.kb_indexer_role.id

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
        Resource = aws_sqs_queue.kb_indexing.arn
      }
    ]
  })
}

# Policy for CloudWatch Logs
resource "aws_iam_role_policy" "kb_indexer_logs_policy" {
  name = "${local.prefix}-kb-indexer-logs-policy"
  role = aws_iam_role.kb_indexer_role.id

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
        Resource = "arn:aws:logs:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:log-group:/aws/lambda/${local.prefix}-kb-indexer:*"
      }
    ]
  })
}




#======================== Lambda Function ======================

resource "aws_lambda_function" "kb_indexer" {
  function_name = "${local.prefix}-kb-indexer"
  description   = "Lambda function for indexing chat conversations into Bedrock Knowledge Base"
  role          = aws_iam_role.kb_indexer_role.arn

  filename         = data.archive_file.kb_indexer.output_path
  source_code_hash = data.archive_file.kb_indexer.output_base64sha256
  handler          = "handler.handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]

  memory_size = 256
  timeout     = 60

  environment {
    variables = {
      KB_ID             = aws_bedrockagent_knowledge_base.chat_kb.id
      KB_DATA_SOURCE_ID = aws_bedrockagent_data_source.chat_kb_source.data_source_id
      REGION            = var.region
      LOG_LEVEL         = "INFO"
    }
  }

  depends_on = [
    aws_iam_role_policy.kb_indexer_logs_policy,
    aws_iam_role_policy.kb_indexer_bedrock_policy,
    aws_bedrockagent_knowledge_base.chat_kb,
    aws_bedrockagent_data_source.chat_kb_source
  ]

  tags = {
    Name        = "${local.prefix}-kb-indexer"
    Environment = var.env
  }
}

# SQS Event Source Mapping to trigger Lambda
resource "aws_lambda_event_source_mapping" "kb_indexer_sqs" {
  event_source_arn = aws_sqs_queue.kb_indexing.arn
  function_name    = aws_lambda_function.kb_indexer.arn
  enabled          = true

  # Process messages in batches
  batch_size = 10

  # Maximum time to wait for a batch
  maximum_batching_window_in_seconds = 5

  # Allow partial batch failures
  function_response_types = ["ReportBatchItemFailures"]
}

# CloudWatch Log Group for Lambda
resource "aws_cloudwatch_log_group" "kb_indexer" {
  name              = "/aws/lambda/${local.prefix}-kb-indexer"
  retention_in_days = 14

  tags = {
    Name        = "${local.prefix}-kb-indexer-logs"
    Environment = var.env
  }
}


#======================== Sparky SQS Permissions ======================

# Policy for Sparky to send messages to KB indexing queue
resource "aws_iam_role_policy" "sparky_kb_indexing_sqs_policy" {
  name = "${local.prefix}-sparky-kb-indexing-sqs-policy"
  role = aws_iam_role.sparky_role.id

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

# Policy for Sparky to search KB and rerank results
resource "aws_iam_role_policy" "sparky_kb_search_policy" {
  name = "${local.prefix}-sparky-kb-search-policy"
  role = aws_iam_role.sparky_role.id

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





#======================== Locals for vector store type ======================

locals {
  use_opensearch = var.kb_vector_store_type == "OPENSEARCH_SERVERLESS"
  use_s3_vectors = var.kb_vector_store_type == "S3_VECTORS"
}


#======================== S3 Vectors ======================

resource "aws_s3vectors_vector_bucket" "kb_vectors" {
  count              = local.use_s3_vectors ? 1 : 0
  vector_bucket_name = "${local.prefix}-kb-vectors"
}

resource "aws_s3vectors_index" "kb_vectors" {
  count              = local.use_s3_vectors ? 1 : 0
  index_name         = "bedrock-knowledge-base-default-index"
  vector_bucket_name = aws_s3vectors_vector_bucket.kb_vectors[0].vector_bucket_name
  data_type          = "float32"
  dimension          = 1024
  distance_metric    = "euclidean"

  metadata_configuration {
    non_filterable_metadata_keys = ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"]
  }
}

# IAM policy for Bedrock KB role to access S3 Vectors
resource "aws_iam_role_policy" "kb_s3_vectors_policy" {
  count = local.use_s3_vectors ? 1 : 0
  name  = "${local.prefix}-kb-s3-vectors-policy"
  role  = aws_iam_role.kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3VectorsAccess"
        Effect = "Allow"
        Action = [
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:QueryVectors",
          "s3vectors:ListVectors"
        ]
        Resource = [
          aws_s3vectors_vector_bucket.kb_vectors[0].vector_bucket_arn,
          "${aws_s3vectors_vector_bucket.kb_vectors[0].vector_bucket_arn}/*"
        ]
      }
    ]
  })
}


#======================== OpenSearch Serverless Collection ======================

resource "aws_opensearchserverless_security_policy" "kb_encryption" {
  count = local.use_opensearch ? 1 : 0
  name  = "${local.prefix}-kb-encryption"
  type  = "encryption"

  policy = jsonencode({
    Rules = [
      {
        Resource     = ["collection/${local.prefix}-kb-vectors"]
        ResourceType = "collection"
      }
    ]
    AWSOwnedKey = true
  })
}

resource "aws_opensearchserverless_security_policy" "kb_network" {
  count = local.use_opensearch ? 1 : 0
  name  = "${local.prefix}-kb-network"
  type  = "network"

  policy = jsonencode([
    {
      Rules = [
        {
          Resource     = ["collection/${local.prefix}-kb-vectors"]
          ResourceType = "collection"
        }
      ]
      AllowFromPublic = true
    }
  ])
}

resource "aws_opensearchserverless_access_policy" "kb_data_access" {
  count = local.use_opensearch ? 1 : 0
  name  = "${local.prefix}-kb-data-access"
  type  = "data"

  policy = jsonencode([
    {
      Rules = [
        {
          Resource     = ["collection/${local.prefix}-kb-vectors"]
          Permission   = ["aoss:*"]
          ResourceType = "collection"
        },
        {
          Resource     = ["index/${local.prefix}-kb-vectors/*"]
          Permission   = ["aoss:*"]
          ResourceType = "index"
        }
      ]
      Principal = [
        aws_iam_role.kb_role.arn,
        data.aws_caller_identity.caller_identity.arn
      ]
    }
  ])
}

resource "aws_opensearchserverless_collection" "kb_vectors" {
  count            = local.use_opensearch ? 1 : 0
  name             = "${local.prefix}-kb-vectors"
  type             = "VECTORSEARCH"
  standby_replicas = "DISABLED"

  depends_on = [
    aws_opensearchserverless_security_policy.kb_encryption,
    aws_opensearchserverless_security_policy.kb_network,
    aws_opensearchserverless_access_policy.kb_data_access
  ]

  tags = {
    Name        = "${local.prefix}-kb-vectors"
    Environment = var.env
  }
}

# Create the vector index in OpenSearch using Python with boto3/requests-aws4auth
resource "null_resource" "create_opensearch_index" {
  count      = local.use_opensearch ? 1 : 0
  depends_on = [aws_opensearchserverless_collection.kb_vectors]

  triggers = {
    collection_id = aws_opensearchserverless_collection.kb_vectors[0].id
    # Force re-run to create index
    version = "4"
  }

  provisioner "local-exec" {
    command = <<-EOT
      # Wait for collection to be active
      echo "Waiting for OpenSearch Serverless collection to be active..."
      sleep 90
      
      # Create the vector index using Python
      python3 << 'PYTHON_SCRIPT'
import boto3
import json
import time
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

region = "${var.region}"
service = "aoss"
endpoint = "${aws_opensearchserverless_collection.kb_vectors[0].collection_endpoint}"
index_name = "bedrock-knowledge-base-default-index"

# Get credentials
credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    service,
    session_token=credentials.token
)

# Create OpenSearch client
host = endpoint.replace("https://", "")
client = OpenSearch(
    hosts=[{"host": host, "port": 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=60
)

# Index mapping for Bedrock KB
index_body = {
    "settings": {
        "index": {
            "knn": True
        }
    },
    "mappings": {
        "properties": {
            "bedrock-knowledge-base-default-vector": {
                "type": "knn_vector",
                "dimension": 1024,
                "method": {
                    "engine": "faiss",
                    "space_type": "l2",
                    "name": "hnsw",
                    "parameters": {}
                }
            },
            "AMAZON_BEDROCK_TEXT_CHUNK": {
                "type": "text"
            },
            "AMAZON_BEDROCK_METADATA": {
                "type": "text",
                "index": False
            }
        }
    }
}

# Create index with retries
max_retries = 5
for attempt in range(max_retries):
    try:
        if client.indices.exists(index=index_name):
            print(f"Index {index_name} already exists")
            break
        response = client.indices.create(index=index_name, body=index_body)
        print(f"Index created: {response}")
        break
    except Exception as e:
        print(f"Attempt {attempt + 1} failed: {e}")
        if attempt < max_retries - 1:
            time.sleep(30)
        else:
            raise
PYTHON_SCRIPT
    EOT
  }
}


#======================== Bedrock Knowledge Base IAM Role ======================

resource "aws_iam_role" "kb_role" {
  name = "${local.prefix}-kb-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.caller_identity.account_id
          }
          ArnLike = {
            "aws:SourceArn" = "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:knowledge-base/*"
          }
        }
      }
    ]
  })

  tags = {
    Name        = "${local.prefix}-kb-role"
    Environment = var.env
  }
}

resource "aws_iam_role_policy" "kb_bedrock_policy" {
  name = "${local.prefix}-kb-bedrock-policy"
  role = aws_iam_role.kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockInvokeModel"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"
      }
    ]
  })
}

resource "aws_iam_role_policy" "kb_opensearch_policy" {
  count = local.use_opensearch ? 1 : 0
  name  = "${local.prefix}-kb-opensearch-policy"
  role  = aws_iam_role.kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "OpenSearchServerlessAccess"
        Effect = "Allow"
        Action = [
          "aoss:APIAccessAll"
        ]
        Resource = aws_opensearchserverless_collection.kb_vectors[0].arn
      }
    ]
  })
}


#======================== Bedrock Knowledge Base ======================

resource "aws_bedrockagent_knowledge_base" "chat_kb" {
  name     = "${local.prefix}-chat-kb"
  role_arn = aws_iam_role.kb_role.arn

  knowledge_base_configuration {
    type = "VECTOR"
    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"
    }
  }

  dynamic "storage_configuration" {
    for_each = local.use_opensearch ? [1] : []
    content {
      type = "OPENSEARCH_SERVERLESS"
      opensearch_serverless_configuration {
        collection_arn    = aws_opensearchserverless_collection.kb_vectors[0].arn
        vector_index_name = "bedrock-knowledge-base-default-index"
        field_mapping {
          vector_field   = "bedrock-knowledge-base-default-vector"
          text_field     = "AMAZON_BEDROCK_TEXT_CHUNK"
          metadata_field = "AMAZON_BEDROCK_METADATA"
        }
      }
    }
  }

  dynamic "storage_configuration" {
    for_each = local.use_s3_vectors ? [1] : []
    content {
      type = "S3_VECTORS"
      s3_vectors_configuration {
        index_arn = aws_s3vectors_index.kb_vectors[0].index_arn
      }
    }
  }

  depends_on = [
    aws_iam_role_policy.kb_bedrock_policy,
    aws_iam_role_policy.kb_opensearch_policy,
    aws_iam_role_policy.kb_s3_vectors_policy,
    null_resource.create_opensearch_index,
    aws_s3vectors_index.kb_vectors,
  ]

  tags = {
    Name        = "${local.prefix}-chat-kb"
    Environment = var.env
  }
}


#======================== Bedrock Knowledge Base Data Source ======================

resource "aws_bedrockagent_data_source" "chat_kb_source" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.chat_kb.id
  name              = "${local.prefix}-chat-data-source"

  data_source_configuration {
    type = "CUSTOM"
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "FIXED_SIZE"
      fixed_size_chunking_configuration {
        max_tokens         = 8192
        overlap_percentage = 10
      }
    }
  }
}
