resource "random_string" "bucket_name" {
  length  = 6
  special = false
  upper   = false
}

resource "aws_s3_bucket" "artifact_bucket" {
  bucket = "${local.prefix}-artifact-${data.aws_caller_identity.caller_identity.account_id}-${random_string.bucket_name.result}"
}

resource "aws_s3_bucket_public_access_block" "artifact_bucket_block" {
  bucket = aws_s3_bucket.artifact_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}


resource "aws_s3_bucket_cors_configuration" "artifact_bucket_cors" {
  bucket = aws_s3_bucket.artifact_bucket.id

  cors_rule {
    allowed_headers = [
      "Authorization",
      "X-Amz-Content-Sha256",
      "X-Amz-Date",
      "X-Amz-Security-Token",
      "X-Amz-User-Agent",
      "X-Amz-Copy-Source",
      "X-Amz-Copy-Source-Range",
      "Content-md5",
      "Content-type",
      "Content-Length",
      "Content-Encoding"
    ]
    allowed_methods = [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "HEAD"
    ]
    allowed_origins = local.allowed_origins
    expose_headers = [
      "ETag",
      "LastModified"
    ]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifact_bucket_lifecycle" {
  bucket = aws_s3_bucket.artifact_bucket.id

  rule {
    id     = "expire-all-objects"
    status = "Enabled"

    expiration {
      days = var.expiry_duration_days
    }
  }
}


# Dedicated Skills S3 Bucket
resource "aws_s3_bucket" "skills_bucket" {
  bucket = "${local.prefix}-skills-${data.aws_caller_identity.caller_identity.account_id}-${random_string.bucket_name.result}"
}

resource "aws_s3_bucket_public_access_block" "skills_bucket_block" {
  bucket = aws_s3_bucket.skills_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "skills_bucket_cors" {
  bucket = aws_s3_bucket.skills_bucket.id

  cors_rule {
    allowed_headers = [
      "Authorization",
      "X-Amz-Content-Sha256",
      "X-Amz-Date",
      "X-Amz-Security-Token",
      "X-Amz-User-Agent",
      "X-Amz-Copy-Source",
      "X-Amz-Copy-Source-Range",
      "Content-md5",
      "Content-type",
      "Content-Length",
      "Content-Encoding"
    ]
    allowed_methods = [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "HEAD"
    ]
    allowed_origins = local.allowed_origins
    expose_headers = [
      "ETag",
      "LastModified"
    ]
  }
}
