resource "aws_dynamodb_table" "tool_config" {
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "user_id"
  range_key                   = "persona"
  name                        = "${local.prefix}-tool-config"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "persona"
    type = "S"
  }

  global_secondary_index {
    name            = "persona-index"
    projection_type = "ALL"

    key_schema {
      attribute_name = "persona"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "user_id"
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


resource "aws_dynamodb_table" "skills" {
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "user_id"
  range_key                   = "skill_name"
  name                        = "${local.prefix}-skills"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "skill_name"
    type = "S"
  }

  attribute {
    name = "visibility"
    type = "S"
  }

  attribute {
    name = "updated_at"
    type = "S"
  }

  global_secondary_index {
    name            = "visibility-updated_at-index"
    projection_type = "ALL"

    key_schema {
      attribute_name = "visibility"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "updated_at"
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


# Shared KMS Customer Managed Key for DynamoDB table encryption
resource "aws_kms_key" "dynamodb" {
  description         = "Customer Managed Key for DynamoDB table encryption"
  enable_key_rotation = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RootAccountFullAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.caller_identity.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowDynamoDBRoleAccess"
        Effect = "Allow"
        Principal = {
          AWS = [
            aws_iam_role.sparky_role.arn,
            aws_iam_role.core_services_role.arn,
            aws_iam_role.kb_cleanup_pipe_role.arn,
            aws_iam_role.expiry_cleanup_role.arn,
            aws_iam_role.cron_executor_role.arn
          ]
        }
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:ReEncrypt*",
          "kms:CreateGrant"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "dynamodb" {
  name          = "alias/${local.prefix}-dynamodb"
  target_key_id = aws_kms_key.dynamodb.key_id
}
