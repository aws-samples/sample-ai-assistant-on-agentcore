# Projects Feature Infrastructure
# S3 bucket, Bedrock Knowledge Base (S3 data source + S3 Vectors), DynamoDB tables


#======================== S3 Projects Bucket ======================

resource "aws_s3_bucket" "projects_bucket" {
  bucket = "${local.prefix}-projects-${data.aws_caller_identity.caller_identity.account_id}-${random_string.bucket_name.result}"
}

resource "aws_s3_bucket_public_access_block" "projects_bucket_block" {
  bucket = aws_s3_bucket.projects_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "projects_bucket_cors" {
  bucket = aws_s3_bucket.projects_bucket.id

  cors_rule {
    allowed_headers = [
      "Authorization",
      "X-Amz-Content-Sha256",
      "X-Amz-Date",
      "X-Amz-Security-Token",
      "X-Amz-User-Agent",
      "Content-Type",
      "Content-Length",
      "Content-Encoding"
    ]
    allowed_methods = ["GET", "PUT", "DELETE", "HEAD"]
    allowed_origins = local.allowed_origins
    expose_headers  = ["ETag"]
  }
}


#======================== S3 Vectors (Vector Index for Projects KB) ======================

resource "aws_s3vectors_vector_bucket" "projects_kb_vectors" {
  vector_bucket_name = "${local.prefix}-projects-kb-vectors"
}

resource "aws_s3vectors_index" "projects_kb_vectors" {
  index_name         = "bedrock-knowledge-base-default-index"
  vector_bucket_name = aws_s3vectors_vector_bucket.projects_kb_vectors.vector_bucket_name
  data_type          = "float32"
  dimension          = 1024
  distance_metric    = "euclidean"

  metadata_configuration {
    # project_id, user_id, file_id, filename are left filterable (not listed here)
    non_filterable_metadata_keys = ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"]
  }
}


#======================== Bedrock KB IAM Role ======================

resource "aws_iam_role" "projects_kb_role" {
  name = "${local.prefix}-projects-kb-role"

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
    Name        = "${local.prefix}-projects-kb-role"
    Environment = var.env
  }
}

resource "aws_iam_role_policy" "projects_kb_bedrock_policy" {
  name = "${local.prefix}-projects-kb-bedrock-policy"
  role = aws_iam_role.projects_kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "BedrockInvokeEmbeddingModel"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"
      }
    ]
  })
}

resource "aws_iam_role_policy" "projects_kb_s3_policy" {
  name = "${local.prefix}-projects-kb-s3-policy"
  role = aws_iam_role.projects_kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3GetObjectAccess"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.projects_bucket.arn}/*"
      },
      {
        Sid      = "S3ListBucketAccess"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.projects_bucket.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "projects_kb_s3_vectors_policy" {
  name = "${local.prefix}-projects-kb-s3-vectors-policy"
  role = aws_iam_role.projects_kb_role.id

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
          aws_s3vectors_vector_bucket.projects_kb_vectors.vector_bucket_arn,
          "${aws_s3vectors_vector_bucket.projects_kb_vectors.vector_bucket_arn}/*"
        ]
      }
    ]
  })
}


#======================== Bedrock Knowledge Base ======================

resource "aws_bedrockagent_knowledge_base" "projects_kb" {
  name     = "${local.prefix}-projects-kb"
  role_arn = aws_iam_role.projects_kb_role.arn

  knowledge_base_configuration {
    type = "VECTOR"
    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"
    }
  }

  storage_configuration {
    type = "S3_VECTORS"
    s3_vectors_configuration {
      index_arn = aws_s3vectors_index.projects_kb_vectors.index_arn
    }
  }

  depends_on = [
    aws_iam_role_policy.projects_kb_bedrock_policy,
    aws_iam_role_policy.projects_kb_s3_policy,
    aws_iam_role_policy.projects_kb_s3_vectors_policy,
    aws_s3vectors_index.projects_kb_vectors,
  ]

  tags = {
    Name        = "${local.prefix}-projects-kb"
    Environment = var.env
  }
}


#======================== Bedrock KB Data Source (S3) ======================

resource "aws_bedrockagent_data_source" "projects_kb_source" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.projects_kb.id
  name              = "${local.prefix}-projects-data-source"

  data_source_configuration {
    type = "S3"
    s3_configuration {
      bucket_arn          = aws_s3_bucket.projects_bucket.arn
      inclusion_prefixes  = ["docs/"]
    }
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "HIERARCHICAL"
      hierarchical_chunking_configuration {
        level_configuration {
          max_tokens = 1500
        }
        level_configuration {
          max_tokens = 300
        }
        overlap_tokens = 60
      }
    }
  }
}


#======================== DynamoDB: projects table ======================

resource "aws_dynamodb_table" "projects" {
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "project_id"
  name                        = "${local.prefix}-projects"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "project_id"
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
    name            = "user_id-created_at-index"
    hash_key        = "user_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  tags = {
    Name        = "${local.prefix}-projects"
    Environment = var.env
  }
}


#======================== DynamoDB: project_canvases table ======================

resource "aws_dynamodb_table" "project_canvases" {
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "project_id"
  range_key                   = "canvas_id"
  name                        = "${local.prefix}-project-canvases"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "project_id"
    type = "S"
  }

  attribute {
    name = "canvas_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  tags = {
    Name        = "${local.prefix}-project-canvases"
    Environment = var.env
  }
}


#======================== DynamoDB: project_files table ======================

resource "aws_dynamodb_table" "project_files" {
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "project_id"
  range_key                   = "file_id"
  name                        = "${local.prefix}-project-files"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "project_id"
    type = "S"
  }

  attribute {
    name = "file_id"
    type = "S"
  }

  attribute {
    name = "filename"
    type = "S"
  }

  global_secondary_index {
    name            = "project_id-filename-index"
    hash_key        = "project_id"
    range_key       = "filename"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  tags = {
    Name        = "${local.prefix}-project-files"
    Environment = var.env
  }
}
