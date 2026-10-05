variable "region" {
  description = "AWS region (this account's project is restricted to eu-north-1)"
  type        = string
  default     = "eu-north-1"
}

variable "project" {
  description = "Project name, used in resource names and tags"
  type        = string
  default     = "aws-eks-gitops-platform"
}

variable "github_repo" {
  description = "GitHub repository (owner/name) allowed to push images"
  type        = string
  default     = "Ronelleti/aws-eks-gitops-platform"
}

variable "ecr_repositories" {
  description = "One ECR repository per container image"
  type        = list(string)
  default     = ["tasks-api", "tasks-ui"]
}

variable "images_to_keep" {
  description = "ECR lifecycle: keep only the newest N images per repository (keeps storage cost near zero)"
  type        = number
  default     = 10
}
