#!/usr/bin/env bash
# Safely tears the AWS environment down so nothing keeps billing. Takes about 15 minutes.
#   bash scripts/eks-down.sh
#   bash scripts/eks-down.sh -auto-approve
# Anything you pass is handed to `terraform destroy`.
#
# Why this is not just `terraform destroy`: the load balancer and any disks are created by
# KUBERNETES (from the Ingress and PVCs), so Terraform doesn't know they exist. Destroying the
# cluster first would orphan them, they would keep billing, and their network interfaces would
# stop the VPC from being deleted.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

CLUSTER="aws-eks-gitops-platform-dev"
REGION="eu-north-1"
TF=(terraform -chdir=infra/dev)

step() { printf '\n==> %s\n' "$1"; }

if aws eks describe-cluster --name "$CLUSTER" --region "$REGION" >/dev/null 2>&1; then
  aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" >/dev/null

  step "1/4 Deleting the ArgoCD applications (this makes Kubernetes remove the ALB and its security groups)"
  kubectl delete applications.argoproj.io --all -n argocd --wait=true --timeout=10m \
    || echo "warning: could not delete all applications - continuing"

  step "2/4 Deleting any remaining PersistentVolumeClaims (releases their EBS disks)"
  kubectl delete pvc --all --all-namespaces --wait=true --timeout=5m \
    || echo "warning: could not delete all PVCs - continuing"

  step "3/4 Waiting until no load balancer is left in the VPC"
  VPC=$("${TF[@]}" output -raw vpc_id 2>/dev/null || true)
  if [[ -n "$VPC" ]]; then
    for _ in $(seq 1 40); do
      n=$(aws elbv2 describe-load-balancers --region "$REGION" \
            --query "length(LoadBalancers[?VpcId=='$VPC'])" --output text 2>/dev/null || echo "?")
      [[ "$n" == "0" ]] && { echo "  none left"; break; }
      echo "  still $n load balancer(s), waiting..."; sleep 15
    done
  else
    echo "  could not read the VPC id from Terraform; waiting 2 minutes instead"; sleep 120
  fi
else
  echo "Cluster $CLUSTER not found - skipping the Kubernetes cleanup."
fi

step "4/4 terraform destroy"
"${TF[@]}" destroy "$@"
rc=$?

step "Leftovers check (every list below should be empty)"
echo "EKS clusters:";        aws eks list-clusters --region "$REGION" --query 'clusters' --output text
echo "RDS instances:";       aws rds describe-db-instances --region "$REGION" --query 'DBInstances[].DBInstanceIdentifier' --output text
echo "Load balancers:";      aws elbv2 describe-load-balancers --region "$REGION" --query 'LoadBalancers[].LoadBalancerName' --output text
echo "EBS volumes:";         aws ec2 describe-volumes --region "$REGION" --query 'Volumes[].VolumeId' --output text
echo "Running instances:";   aws ec2 describe-instances --region "$REGION" --query "Reservations[].Instances[?State.Name!='terminated'].InstanceId" --output text
echo "Attachments buckets:"; aws s3api list-buckets --query "Buckets[?contains(Name,'attachments')].Name" --output text

[[ $rc -ne 0 ]] && echo "terraform destroy FAILED (exit $rc): fix the error and run this script again."
exit $rc
