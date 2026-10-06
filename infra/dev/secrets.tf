# ---- Grafana's admin login ----
# AWS generates the password (an ephemeral resource exists only while Terraform runs), and it is written to
# Secrets Manager with a write-only argument. It never appears in the state file, the plan, or the logs.
# External Secrets then copies it into the Kubernetes Secret that Grafana reads (see gitops/platform/eks-dev/secrets).

ephemeral "aws_secretsmanager_random_password" "grafana" {
  password_length     = 24
  exclude_punctuation = true
}

resource "aws_secretsmanager_secret" "grafana_admin" {
  name        = "${var.project}/${var.environment}/grafana-admin"
  description = "Grafana admin login for the ${var.environment} cluster"

  # Delete immediately on destroy. Otherwise AWS keeps the name reserved for days and the next build cannot reuse it.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "grafana_admin" {
  secret_id = aws_secretsmanager_secret.grafana_admin.id

  secret_string_wo = jsonencode({
    "admin-user"     = "admin"
    "admin-password" = ephemeral.aws_secretsmanager_random_password.grafana.random_password
  })
  secret_string_wo_version = 1 # raise this number to rotate the password on the next apply
}
