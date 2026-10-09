# ---- Alertmanager -> SNS -> your email ----
# Prometheus decides WHEN something is wrong (alert rules in the tasks chart and in kube-prometheus-stack).
# Alertmanager groups the alerts and sends them. Here it publishes to the SNS topic that infra/global created
# (the same topic that carries budget and cost-watchdog emails), so every alert reaches the one confirmed address.
#
# The topic lives in infra/global (it must survive `terraform destroy` of this layer), so it is addressed by its
# ARN, which follows from the names. Nothing here reads it, which means a missing topic only shows up when the
# first alert is sent.

locals {
  alerts_topic_arn = "arn:aws:sns:${var.region}:${data.aws_caller_identity.current.account_id}:${var.project}-alerts"
}

resource "aws_iam_role" "alertmanager" {
  name               = "${local.name}-alertmanager"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json
}

data "aws_iam_policy_document" "alertmanager_sns" {
  statement {
    sid       = "PublishAlerts"
    actions   = ["sns:Publish"]
    resources = [local.alerts_topic_arn]
  }
}

resource "aws_iam_role_policy" "alertmanager_sns" {
  name   = "publish-alerts"
  role   = aws_iam_role.alertmanager.id
  policy = data.aws_iam_policy_document.alertmanager_sns.json
}

resource "aws_eks_pod_identity_association" "alertmanager" {
  cluster_name    = module.eks.cluster_name
  namespace       = "monitoring"
  service_account = "alertmanager" # set in gitops/envs/eks-dev/monitoring.yaml (alertmanager.serviceAccount.name)
  role_arn        = aws_iam_role.alertmanager.arn
}
