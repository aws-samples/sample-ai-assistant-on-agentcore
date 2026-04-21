#======================== DynamoDB: thread_anchors table ======================
#
# Stores anchors for Threads (side-conversations on AI message spans).
# Anchors are per-session metadata — deliberately kept out of the LangGraph
# checkpointer state so that thread create/delete operations don't contend
# with the parent session's message history.
#
#   PK: session_id
#   SK: thread_id
# GSI: user_id-created_at-index  (for admin cleanup / per-user queries)
#
# Access patterns:
#   - Create anchor (PutItem)
#   - List anchors for session (Query by PK)
#   - Delete single anchor (DeleteItem)
#   - Delete all anchors for session (Query + BatchWriteItem) — fired from
#     handle_delete_history
#   - Copy anchors to new session (Query + BatchPut) — fired from handle_branch

resource "aws_dynamodb_table" "thread_anchors" {
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "session_id"
  range_key                   = "thread_id"
  name                        = "${local.prefix}-thread-anchors"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "session_id"
    type = "S"
  }

  attribute {
    name = "thread_id"
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

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  tags = {
    Name        = "${local.prefix}-thread-anchors"
    Environment = var.env
  }
}
