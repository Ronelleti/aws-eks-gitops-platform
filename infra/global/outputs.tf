output "ecr_repository_urls" {
  description = "Image repository URLs, e.g. for docker push and the Helm values"
  value       = { for name, repo in aws_ecr_repository.app : name => repo.repository_url }
}

output "github_ci_user_name" {
  description = "IAM user for GitHub Actions; create its access key with the AWS CLI (see README steps)"
  value       = aws_iam_user.github_ci.name
}
