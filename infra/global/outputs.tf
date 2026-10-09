output "ecr_repository_urls" {
  description = "Image repository URLs, e.g. for docker push and the Helm values"
  value       = { for name, repo in aws_ecr_repository.app : name => repo.repository_url }
}

output "github_ci_user_name" {
  description = "IAM user for GitHub Actions; create its access key with the AWS CLI (see README steps)"
  value       = aws_iam_user.github_ci.name
}

output "alerts_topic_arn" {
  description = "SNS topic for alerts. Alertmanager and CloudWatch alarms can publish here later."
  value       = aws_sns_topic.alerts.arn
}

output "cost_watchdog_function" {
  description = "Lambda name, for a manual test: aws lambda invoke --function-name <name> out.json"
  value       = aws_lambda_function.watchdog.function_name
}
