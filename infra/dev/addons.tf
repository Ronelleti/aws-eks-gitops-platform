# ---- Cluster components installed by Terraform ----
# Terraform installs only what needs AWS-specific values (IAM roles, VPC ID) plus ArgoCD itself.
# Everything about the app lives in Git and is deployed by ArgoCD (see gitops.tf).
#
# They are installed one after another on purpose. The load balancer controller registers
# webhooks that every later Service and Pod passes through; installing other charts while
# its webhook is still starting fails with "failed calling webhook".

locals {
  chart_versions = {
    lbc              = "3.5.0" # 3.6.0 was published minutes before first use and not yet served by aws.github.io
    metrics_server   = "3.14.0"
    external_secrets = "2.11.0"
    argocd           = "10.9.6"
    argocd_apps      = "2.0.6"
  }
}

# Turns an Ingress into a real AWS ALB (and deletes it again when the Ingress goes away).
resource "helm_release" "lbc" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = local.chart_versions.lbc
  namespace  = "kube-system"
  timeout    = 600 # first run: every image is pulled onto fresh nodes, and 300s (the default) can be too short

  values = [yamlencode({
    clusterName  = module.eks.cluster_name
    region       = var.region        # the nodes' metadata service is blocked for pods (hop limit 1),
    vpcId        = module.vpc.vpc_id # so the controller can't discover these two itself
    replicaCount = 1
    serviceAccount = {
      create = true
      name   = "aws-load-balancer-controller"
    }
  })]

  # the Pod Identity association must exist BEFORE the pod starts, or it never gets credentials
  depends_on = [module.eks, aws_eks_pod_identity_association.lbc]
}

# EKS ships without it, and the HorizontalPodAutoscaler needs CPU numbers from somewhere.
resource "helm_release" "metrics_server" {
  name       = "metrics-server"
  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  version    = local.chart_versions.metrics_server
  namespace  = "kube-system"

  depends_on = [helm_release.lbc]
}

# Copies secrets from AWS Secrets Manager into Kubernetes Secrets.
resource "helm_release" "external_secrets" {
  name             = "external-secrets"
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  version          = local.chart_versions.external_secrets
  namespace        = "external-secrets"
  timeout          = 600 # first run: every image is pulled onto fresh nodes, and 300s (the default) can be too short
  create_namespace = true

  values = [yamlencode({
    serviceAccount = { name = "external-secrets" } # must match the Pod Identity association
  })]

  depends_on = [helm_release.lbc, aws_eks_pod_identity_association.external_secrets]
}

resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = local.chart_versions.argocd
  namespace        = "argocd"
  timeout          = 600 # first run: every image is pulled onto fresh nodes, and 300s (the default) can be too short
  create_namespace = true

  # no SSO login or notifications in a lab: saves two pods and memory
  values = [yamlencode({
    dex           = { enabled = false }
    notifications = { enabled = false }
  })]

  depends_on = [helm_release.lbc]
}
