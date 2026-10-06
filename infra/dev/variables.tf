variable "region" {
  description = "AWS region (this account's organization policy only allows eu-north-1)"
  type        = string
  default     = "eu-north-1"
}

variable "project" {
  type    = string
  default = "aws-eks-gitops-platform"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "az_count" {
  description = "Availability zones to use (EKS requires at least 2)"
  type        = number
  default     = 2
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version. 1.36 is one behind the newest (1.37): the Helm charts we use are tested against it, and it has a long support window left."
  type        = string
  default     = "1.36"
}

variable "node_instance_types" {
  description = "Worker node instance types (x86, because CI builds amd64 images)"
  type        = list(string)
  default     = ["t3.large"]
}

variable "node_capacity_type" {
  description = "ON_DEMAND or SPOT. This account's organization policy (SCP) blocks spot instances, so the default is ON_DEMAND."
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["SPOT", "ON_DEMAND"], var.node_capacity_type)
    error_message = "node_capacity_type must be SPOT or ON_DEMAND."
  }
}

variable "node_desired_size" {
  description = "Worker nodes. 3 gives room for the app, ArgoCD, Prometheus, Grafana, Elasticsearch and Kibana"
  type        = number
  default     = 3
}

variable "node_min_size" {
  type    = number
  default = 1
}

variable "node_max_size" {
  type    = number
  default = 4
}

variable "node_disk_size_gb" {
  description = "Root disk per node (container images for Prometheus, Grafana and so on need space)"
  type        = number
  default     = 30
}

variable "api_allowed_cidrs" {
  description = "Who may reach the Kubernetes API endpoint. Access still requires AWS IAM credentials either way."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ---- database ----
variable "rds_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "rds_engine_version" {
  description = "PostgreSQL major version (16 matches the postgres:16 image used on kind)"
  type        = string
  default     = "16"
}

variable "rds_allocated_storage" {
  description = "GB of gp3 storage (20 is the minimum)"
  type        = number
  default     = 20
}

variable "rds_storage_encrypted" {
  description = "Encrypt the database disk with the AWS-managed key (set false only if the organization policy blocks it)"
  type        = bool
  default     = true
}

# ---- cluster ----
variable "enable_network_policy" {
  description = "Make the VPC CNI enforce Kubernetes NetworkPolicies. Without it the policies in the chart exist but do nothing."
  type        = bool
  default     = true
}

variable "gitops_repo_url" {
  description = "Git repository ArgoCD deploys from"
  type        = string
  default     = "https://github.com/Ronelleti/aws-eks-gitops-platform.git"
}

variable "gitops_revision" {
  description = "Branch ArgoCD follows"
  type        = string
  default     = "main"
}
