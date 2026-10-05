# ---- S3 bucket for task attachments ----
# The browser uploads straight to S3 with a presigned URL from the API, so the files never
# pass through the API pods.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "attachments" {
  bucket        = "${local.name}-attachments-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # lab: `terraform destroy` removes the bucket even if it has files
}

resource "aws_s3_bucket_public_access_block" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Browsers need CORS to PUT/GET straight to S3 from the app's page. The presigned URL is the
# real authorization, so any origin is acceptable here (the ALB hostname is unknown in advance).
resource "aws_s3_bucket_cors_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  cors_rule {
    allowed_methods = ["GET", "PUT"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
