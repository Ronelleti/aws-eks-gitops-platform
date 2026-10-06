# ---- Hand-over to GitOps ----

# The database password, copied from the secret RDS manages into the Secret "db-credentials"
# that the tasks chart reads. This is installed here rather than by ArgoCD because the secret's
# ARN only exists once RDS has been created.
resource "helm_release" "db_secret" {
  name             = "db-secret"
  chart            = "${path.module}/../../charts/db-secret"
  namespace        = "tasks"
  create_namespace = true

  values = [yamlencode({
    region    = var.region
    secretArn = aws_db_instance.this.master_user_secret[0].secret_arn
  })]

  depends_on = [helm_release.external_secrets]
}

# The tasks app: an ArgoCD Application that deploys charts/tasks from Git.
#   from Git        : image tags (written by CI) and the human-owned settings
#   from Terraform  : values that only exist after infrastructure is created
# Parameters set here win over the files from Git.
resource "helm_release" "tasks_app" {
  name       = "tasks-app"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argocd-apps"
  version    = local.chart_versions.argocd_apps
  namespace  = "argocd"

  values = [yamlencode({
    applications = {
      tasks = {
        namespace  = "argocd"
        project    = "default"
        finalizers = ["resources-finalizer.argocd.argoproj.io"] # deleting the app deletes the ALB
        source = {
          repoURL        = var.gitops_repo_url
          targetRevision = var.gitops_revision
          path           = "charts/tasks"
          helm = {
            releaseName = "tasks"
            valueFiles = [
              "../../gitops/envs/eks-dev/config.yaml",
              "../../gitops/envs/eks-dev/tasks.yaml",
            ]
            valuesObject = {
              appEnv    = var.environment
              awsRegion = var.region
              database = {
                host = aws_db_instance.this.address
              }
              api = {
                s3Bucket = aws_s3_bucket.attachments.bucket
              }
              networkPolicies = {
                # the ALB's traffic arrives from IPs inside the VPC
                ingressControllerCIDRs = [module.vpc.vpc_cidr]
              }
            }
          }
        }
        destination = {
          server    = "https://kubernetes.default.svc"
          namespace = "tasks"
        }
        syncPolicy = {
          automated = { prune = true, selfHeal = true }
          syncOptions = [
            "CreateNamespace=true",
            "SkipDryRunOnMissingResource=true", # the ServiceMonitor type exists only once monitoring has installed its CRDs
          ]
          retry = {
            limit   = 10
            backoff = { duration = "15s", factor = 2, maxDuration = "3m" }
          }
        }
      }
    }
  })]

  depends_on = [
    helm_release.argocd,
    helm_release.db_secret,
    helm_release.metrics_server,
    aws_eks_pod_identity_association.api,
  ]
}

# The platform: everything that is not the app itself (storage class, monitoring, logging, secrets for them).
# One Application that points at a folder of Applications in Git (the "app of apps" pattern), so adding a
# platform component is a commit, not a Terraform change.
resource "helm_release" "platform_apps" {
  name       = "platform-apps"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argocd-apps"
  version    = local.chart_versions.argocd_apps
  namespace  = "argocd"

  values = [yamlencode({
    applications = {
      platform = {
        namespace  = "argocd"
        project    = "default"
        finalizers = ["resources-finalizer.argocd.argoproj.io"]
        source = {
          repoURL        = var.gitops_repo_url
          targetRevision = var.gitops_revision
          path           = "gitops/apps/eks-dev"
        }
        destination = {
          server    = "https://kubernetes.default.svc"
          namespace = "argocd"
        }
        syncPolicy = {
          automated = { prune = true, selfHeal = true }
          retry = {
            limit   = 10
            backoff = { duration = "15s", factor = 2, maxDuration = "3m" }
          }
        }
      }
    }
  })]

  # the Grafana secret must exist in AWS before External Secrets is asked to copy it
  depends_on = [
    helm_release.argocd,
    helm_release.db_secret, # creates the ClusterSecretStore that the platform's ExternalSecrets use
    aws_secretsmanager_secret_version.grafana_admin,
  ]
}
