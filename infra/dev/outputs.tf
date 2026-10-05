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
