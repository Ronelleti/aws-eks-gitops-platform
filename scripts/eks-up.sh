#!/usr/bin/env bash
# Builds the whole AWS environment: VPC, EKS, RDS, S3, IAM, ALB controller, External Secrets,
# ArgoCD, and the app (deployed by ArgoCD from Git). Takes about 20 minutes.
#   bash scripts/eks-up.sh              # asks for confirmation
#   bash scripts/eks-up.sh -auto-approve
# Anything you pass is handed to `terraform apply`.
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER="aws-eks-gitops-platform-dev"
REGION="eu-north-1"
TF=(terraform -chdir=infra/dev)

step() { printf '\n==> %s\n' "$1"; }

step "Checking AWS access"
aws sts get-caller-identity --query Arn --output text

step "Checking that CI has published real image tags"
if grep -q 'tag: "initial"' gitops/envs/eks-dev/tasks.yaml; then
  echo "gitops/envs/eks-dev/tasks.yaml still has the placeholder tag 'initial'."
  echo "Run 'git pull'. If it is still 'initial', wait for the app-ci workflow on GitHub to finish."
  exit 1
fi
grep 'tag:' gitops/envs/eks-dev/tasks.yaml

step "terraform apply (the cost clock starts when the EKS cluster appears: about \$0.45 per hour)"
"${TF[@]}" init -input=false
"${TF[@]}" apply "$@"

step "Pointing kubectl at the cluster"
aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" >/dev/null

step "Waiting for the load balancer (the first ArgoCD sync, then the ALB: 3-6 minutes)"
host=""
for _ in $(seq 1 60); do
  host=$(kubectl get ingress tasks -n tasks -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
  [[ -n "$host" ]] && break
  printf '.'; sleep 10
done
echo

kubectl get applications -n argocd
kubectl get pods -n tasks

echo
if [[ -n "$host" ]]; then
  echo "App:    http://$host   (a new ALB can take another minute or two to start answering)"
else
  echo "No ALB address yet. Check:  kubectl get applications -n argocd   and   kubectl describe ingress tasks -n tasks"
fi
echo "Monitoring, logging and ArgoCD take a few more minutes to settle. When they have:"
echo "  bash scripts/eks-open.sh     (opens ArgoCD, Grafana, Prometheus and Kibana on your computer, and prints the logins)"
echo
echo "When you are done:  bash scripts/eks-down.sh      (do NOT just run terraform destroy)"
