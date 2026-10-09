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

variable "alert_email" {
  description = "Where alerts are sent. Set it in infra/global/terraform.tfvars (git-ignored), never in Git."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must look like name@example.com."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly spending limit for the budget alerts, in USD"
  type        = number
  default     = 20
}

variable "budget_alert_percentages" {
  description = "Send an email when actual spend passes each of these percentages of the budget"
  type        = list(number)
  default     = [50, 80, 100]
}

variable "watchdog_max_hours" {
  description = "Email an alert when the EKS cluster or RDS database has been running longer than this"
  type        = number
  default     = 4
}

variable "dev_hourly_cost_usd" {
  description = "Rough hourly cost of the dev environment, only used in the alert text"
  type        = number
  default     = 0.45
}
