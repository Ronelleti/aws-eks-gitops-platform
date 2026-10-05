# Ephemeral "dev" layer: apply when you practice, destroy when you're done.
# Its state is separate from infra/global, so destroying this never touches ECR or its images.
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "tfstate-508193318669"
    key          = "dev/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      Layer       = "dev"
      ManagedBy   = "terraform"
    }
  }
}
