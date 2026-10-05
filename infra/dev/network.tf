locals {
  name         = "${var.project}-${var.environment}"
  cluster_name = local.name
}

module "vpc" {
  source = "../modules/vpc"

  name         = local.name
  cidr         = var.vpc_cidr
  az_count     = var.az_count
  cluster_name = local.cluster_name
}
