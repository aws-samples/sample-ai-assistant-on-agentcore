# DynamoDB table for LangGraph checkpoints (replaces AgentCore short-term memory)
resource "aws_dynamodb_table" "checkpoints" {
  name         = "${local.prefix}-langgraph-checkpoints"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  tags = {
    Project = local.prefix
    Service = "sparky"
    env     = var.env
  }
}

# -----------------------------------------------
# S3 bucket for checkpoint offloading (standard)
# -----------------------------------------------
resource "aws_s3_bucket" "checkpoint_offload" {
  count  = var.use_express_checkpoint_bucket ? 0 : 1
  bucket = "${local.prefix}-checkpoint-${data.aws_caller_identity.caller_identity.account_id}-${random_string.bucket_name.result}"

  tags = {
    Project = local.prefix
    Service = "sparky"
    env     = var.env
  }
}

resource "aws_s3_bucket_public_access_block" "checkpoint_offload" {
  count  = var.use_express_checkpoint_bucket ? 0 : 1
  bucket = aws_s3_bucket.checkpoint_offload[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "checkpoint_offload" {
  count  = var.use_express_checkpoint_bucket ? 0 : 1
  bucket = aws_s3_bucket.checkpoint_offload[0].id

  rule {
    id     = "expire-checkpoints"
    status = "Enabled"

    expiration {
      days = var.expiry_duration_days
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "checkpoint_offload" {
  count  = var.use_express_checkpoint_bucket ? 0 : 1
  bucket = aws_s3_bucket.checkpoint_offload[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

# -----------------------------------------------
# S3 Express One Zone directory bucket (optional)
# -----------------------------------------------
resource "aws_s3_directory_bucket" "checkpoint_offload_express" {
  count  = var.use_express_checkpoint_bucket ? 1 : 0
  bucket = "${local.prefix}-ckpt--${var.express_az_id}--x-s3"

  location {
    name = var.express_az_id
  }
}

# -----------------------------------------------
# Computed locals for bucket name / endpoint
# -----------------------------------------------
locals {
  checkpoint_bucket_name = (
    var.use_express_checkpoint_bucket
    ? aws_s3_directory_bucket.checkpoint_offload_express[0].bucket
    : aws_s3_bucket.checkpoint_offload[0].id
  )
  checkpoint_bucket_endpoint = (
    var.use_express_checkpoint_bucket
    ? "https://${aws_s3_directory_bucket.checkpoint_offload_express[0].bucket}.s3express-${var.express_az_id}.${var.region}.amazonaws.com"
    : ""
  )
}

# -----------------------------------------------
# IAM policy for checkpointer access
# -----------------------------------------------
resource "aws_iam_role_policy" "sparky_checkpointer_policy" {
  name = "${local.prefix}-sparky-checkpointer-policy"
  role = aws_iam_role.sparky_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid    = "CheckpointTableAccess"
          Effect = "Allow"
          Action = [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:Query",
            "dynamodb:BatchGetItem",
            "dynamodb:BatchWriteItem",
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
          Sid    = "S3ExpressObjects"
          Effect = "Allow"
          Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:PutObjectTagging"]
          Resource = "arn:aws:s3express:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:bucket/${local.checkpoint_bucket_name}/*"
        },
        {
          Sid    = "S3ExpressLifecycle"
          Effect = "Allow"
          Action = [
            "s3:GetBucketLifecycleConfiguration",
            "s3:PutBucketLifecycleConfiguration"
          ]
          Resource = "arn:aws:s3express:${var.region}:${data.aws_caller_identity.caller_identity.account_id}:bucket/${local.checkpoint_bucket_name}"
        }
      ] : [
        {
          Sid    = "S3CheckpointObjects"
          Effect = "Allow"
          Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:PutObjectTagging"]
          Resource = "${aws_s3_bucket.checkpoint_offload[0].arn}/*"
        },
        {
          Sid    = "S3CheckpointLifecycle"
          Effect = "Allow"
          Action = [
            "s3:GetBucketLifecycleConfiguration",
            "s3:PutBucketLifecycleConfiguration"
          ]
          Resource = aws_s3_bucket.checkpoint_offload[0].arn
        }
      ]
    )
  })
}
