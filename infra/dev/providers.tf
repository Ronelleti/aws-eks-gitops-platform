# Helm talks to the cluster that module.eks creates. The token comes from `aws eks get-token`,
# which is refreshed on every call, so it never expires in the middle of a long apply.
# (Needs the AWS CLI installed - same credentials Terraform itself uses.)
provider "helm" {
  kubernetes = {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)

    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
    }
  }
}
