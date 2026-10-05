# ---- IAM roles for pods, assumed through EKS Pod Identity (no OIDC provider needed) ----
# Each role is tied to ONE service account in ONE namespace by an association below.
# (data.aws_iam_policy_document.pod_identity_trust is defined in eks.tf)

# -- the API: put and get objects in the attachments bucket, nothing else --
resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json
}

data "aws_iam_policy_document" "api_s3" {
  statement {
    sid       = "Attachments"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.attachments.arn}/*"]
  }

  # lets the System page check that the bucket answers (HeadBucket needs this on the bucket itself)
  statement {
    sid       = "BucketStatus"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.attachments.arn]
  }
}

resource "aws_iam_role_policy" "api_s3" {
  name   = "attachments"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_s3.json
}

resource "aws_eks_pod_identity_association" "api" {
  cluster_name    = module.eks.cluster_name
  namespace       = "tasks"
  service_account = "api" # created by the tasks chart
  role_arn        = aws_iam_role.api.arn
}

# -- External Secrets: read ONLY the database secret that RDS created --
resource "aws_iam_role" "external_secrets" {
  name               = "${local.name}-external-secrets"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json
}

data "aws_iam_policy_document" "external_secrets" {
  statement {
    sid       = "ReadDatabaseSecret"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_db_instance.this.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "external_secrets" {
  name   = "read-database-secret"
  role   = aws_iam_role.external_secrets.id
  policy = data.aws_iam_policy_document.external_secrets.json
}

resource "aws_eks_pod_identity_association" "external_secrets" {
  cluster_name    = module.eks.cluster_name
  namespace       = "external-secrets"
  service_account = "external-secrets"
  role_arn        = aws_iam_role.external_secrets.arn
}

# -- AWS Load Balancer Controller: creates and manages the ALB for the Ingress --
resource "aws_iam_policy" "lbc" {
  name   = "${local.name}-lbc"
  policy = file("${path.module}/policies/aws-load-balancer-controller.json") # official policy for controller v3.6.0
}

resource "aws_iam_role" "lbc" {
  name               = "${local.name}-lbc"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json
}

resource "aws_iam_role_policy_attachment" "lbc" {
  role       = aws_iam_role.lbc.name
  policy_arn = aws_iam_policy.lbc.arn
}

resource "aws_eks_pod_identity_association" "lbc" {
  cluster_name    = module.eks.cluster_name
  namespace       = "kube-system"
  service_account = "aws-load-balancer-controller"
  role_arn        = aws_iam_role.lbc.arn
}
