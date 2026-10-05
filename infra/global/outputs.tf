output "ecr_repository_urls" {
  description = "Image repository URLs, e.g. for docker push and the Helm values"
  value       = { for name, repo in aws_ecr_repository.app : name => repo.repository_url }
}

output "github_ci_role_arn" {
  description = "Role ARN for the GitHub Actions workflow (aws-actions/configure-aws-credentials)"
  value       = aws_iam_role.github_ci.arn
}
