# GitHub Actions -> AWS without stored keys.
# GitHub issues a short-lived OIDC token for each workflow run; AWS trusts GitHub as an
# identity provider and exchanges that token for temporary credentials of the role below.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# WHO may assume the role: only workflows from this repo, and only on the main branch.
# A pull request or another branch gets a different "sub" claim and is refused.
data "aws_iam_policy_document" "github_ci_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_ci" {
  name                 = "${var.project}-github-ci"
  description          = "Assumed by GitHub Actions (main branch) to push images to ECR"
  assume_role_policy   = data.aws_iam_policy_document.github_ci_trust.json
  max_session_duration = 3600
}

# WHAT the role may do: push/pull images to our ECR repositories only. Nothing else.
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

resource "aws_iam_role_policy" "github_ci_ecr" {
  name   = "ecr-push"
  role   = aws_iam_role.github_ci.id
  policy = data.aws_iam_policy_document.github_ci_ecr.json
}
