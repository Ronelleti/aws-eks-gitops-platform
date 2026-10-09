output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "kubeconfig_command" {
  description = "Run this to point kubectl at the cluster"
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}"
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "data_subnet_ids" {
  description = "Isolated subnets for RDS (next step)"
  value       = module.vpc.data_subnet_ids
}

output "database_endpoint" {
  value = aws_db_instance.this.address
}

output "database_secret_arn" {
  description = "Where RDS keeps the generated password (the ARN is not secret)"
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "attachments_bucket" {
  value = aws_s3_bucket.attachments.bucket
}

output "jobs_queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "jobs_dlq_url" {
  value = aws_sqs_queue.jobs_dlq.url
}

output "argocd_admin_password_command" {
  value = "kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
}

output "argocd_port_forward_command" {
  value = "kubectl port-forward -n argocd svc/argocd-server 8443:443   # then open https://localhost:8443 (user: admin)"
}

output "app_url_command" {
  description = "The ALB takes 2-3 minutes to appear after the first sync"
  value       = "kubectl get ingress tasks -n tasks -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'"
}

output "grafana_secret_name" {
  description = "Where the Grafana admin login lives in Secrets Manager"
  value       = aws_secretsmanager_secret.grafana_admin.name
}
