# ---- RDS PostgreSQL in the isolated data subnets ----

resource "aws_db_subnet_group" "this" {
  name       = local.name
  subnet_ids = module.vpc.data_subnet_ids
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "PostgreSQL from the EKS worker nodes only"
  vpc_id      = module.vpc.vpc_id
}

# Pods use their node's security group, so allowing the node group is how pods reach the DB.
resource "aws_vpc_security_group_ingress_rule" "rds_from_nodes" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = module.eks.node_security_group_id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from EKS nodes"
}

# Created here (not by RDS) so Terraform deletes it on destroy and it expires after 7 days.
resource "aws_cloudwatch_log_group" "rds" {
  name              = "/aws/rds/instance/${local.name}/postgresql"
  retention_in_days = 7
}

resource "aws_db_instance" "this" {
  identifier = local.name

  engine         = "postgres"
  engine_version = var.rds_engine_version
  instance_class = var.rds_instance_class

  allocated_storage = var.rds_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = var.rds_storage_encrypted

  db_name  = "tasks"
  username = "tasks"

  # RDS generates the master password itself and keeps it in Secrets Manager. It never passes
  # through Terraform, so it is not in the state file, and nobody ever sees or types it.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # a lab: one AZ is enough, and half the price

  backup_retention_period    = 1
  copy_tags_to_snapshot      = true # snapshots keep the Project tag, so they show up in cost reports
  auto_minor_version_upgrade = true
  apply_immediately          = true

  # Lab settings so `terraform destroy` works. In production: deletion_protection = true
  # and a final snapshot.
  skip_final_snapshot = true
  deletion_protection = false

  enabled_cloudwatch_logs_exports = ["postgresql"]

  depends_on = [aws_cloudwatch_log_group.rds]
}
