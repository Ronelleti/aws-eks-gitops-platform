# ---- EKS cluster: control plane + managed node group + core add-ons ----

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.0"

  name               = local.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.public_subnet_ids

  # kubectl, Terraform and ArgoCD reach the API over the internet (no VPN in this lab).
  # Every request still needs valid AWS IAM credentials.
  endpoint_public_access       = true
  endpoint_private_access      = true
  endpoint_public_access_cidrs = var.api_allowed_cidrs

  # The IAM user that runs `terraform apply` becomes cluster admin (EKS access entries).
  enable_cluster_creator_admin_permissions = true

  # IMPORTANT: this account's organization policy (SCP) blocks creating IAM OIDC providers.
  # IRSA needs one, so it is disabled. Pods get AWS access through EKS Pod Identity instead.
  enable_irsa = false

  # No customer-managed KMS key: saves about $1/month and avoids another service the SCP
  # might block. Kubernetes secrets are still encrypted at rest by AWS. In production you
  # would use your own key.
  create_kms_key    = false
  encryption_config = null

  # control-plane logs go to CloudWatch (kept 7 days so storage stays near zero)
  enabled_log_types                      = ["api", "audit", "authenticator"]
  cloudwatch_log_group_retention_in_days = 7

  addons = {
    # networking add-ons must exist BEFORE the nodes, or the nodes never become Ready
    vpc-cni = {
      before_compute = true
    }
    eks-pod-identity-agent = {
      before_compute = true
    }
    kube-proxy = {}
    coredns    = {}

    # lets Kubernetes create EBS disks for PersistentVolumeClaims (Prometheus, Grafana)
    aws-ebs-csi-driver = {
      pod_identity_association = [{
        role_arn        = aws_iam_role.ebs_csi.arn
        service_account = "ebs-csi-controller-sa"
      }]
    }
  }

  eks_managed_node_groups = {
    default = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = var.node_instance_types
      capacity_type  = var.node_capacity_type

      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_desired_size

      block_device_mappings = {
        root = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size           = var.node_disk_size_gb
            volume_type           = "gp3"
            delete_on_termination = true
          }
        }
      }
    }
  }
}

# ---- IAM role for the EBS CSI driver, assumed through EKS Pod Identity ----
data "aws_iam_policy_document" "pod_identity_trust" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${local.name}-ebs-csi"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}
