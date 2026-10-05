# CI identity for GitHub Actions.
#
# The preferred design is keyless OIDC (GitHub token -> IAM role). This AWS account's
# organization SCP denies iam:CreateOpenIDConnectProvider, so we fall back to a dedicated
# IAM user whose ONLY permission is pushing to our two ECR repositories.
# Its access key is created by hand (not by Terraform, so the secret never lands in the
# state file) and stored only as a GitHub Actions secret. Rotate it regularly.

resource "aws_iam_user" "github_ci" {
  name = "${var.project}-github-ci"
  path = "/ci/"
}

# WHAT the user may do: push/pull images to our ECR repositories only. Nothing else.
data "aws_iam_policy_document" "github_ci_ecr" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"] # this action doesn't support resource restrictions
    resources = ["*"]
  }

  statement {
    sid = "EcrPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeImageScanFindings",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for repo in aws_ecr_repository.app : repo.arn]
  }
}

resource "aws_iam_user_policy" "github_ci_ecr" {
  name   = "ecr-push"
  user   = aws_iam_user.github_ci.name
  policy = data.aws_iam_policy_document.github_ci_ecr.json
}
