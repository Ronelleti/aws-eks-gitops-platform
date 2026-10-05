# Persistent "global" layer: created once, never destroyed with the dev environment.
terraform {
  required_version = ">= 1.10" # needed for S3-native state locking (use_lockfile)

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Each root module (global, dev) has its own state file in the same bucket.
  # Backend blocks can't use variables, so this is repeated per layer
  # (removing that duplication is exactly what Terragrunt is for).
  backend "s3" {
    bucket       = "tfstate-508193318669"
    key          = "global/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true # lock file in S3 prevents two applies at once (no DynamoDB needed)
  }
}

provider "aws" {
  region = var.region

  # every resource gets these tags automatically (cost tracking, cleanup)
  default_tags {
    tags = {
      Project   = var.project
      Layer     = "global"
      ManagedBy = "terraform"
    }
  }
}
