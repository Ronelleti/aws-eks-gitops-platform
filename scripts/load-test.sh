#!/usr/bin/env bash
# Load test with k6. Needs Docker (nothing else to install).
#   bash scripts/load-test.sh                         # the EKS app: finds the load balancer address by itself
#   bash scripts/load-test.sh http://localhost:8080   # the local docker compose app
#   bash scripts/load-test.sh <url> <hold-time> <users>      e.g.  ... http://localhost:8080 5m 20
#
# To watch a canary rollout, start this in one terminal, then push the change that starts the rollout.
# A canary can only be judged on real traffic: with no requests, the error rate looks perfect.
set -uo pipefail

url="${1:-}"
duration="${2:-2m}"
users="${3:-10}"

if [[ -z "$url" ]]; then
  aws eks update-kubeconfig --name aws-eks-gitops-platform-dev --region eu-north-1 >/dev/null 2>&1 || true
  host=$(kubectl get ingress tasks -n tasks -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
  if [[ -z "$host" ]]; then
    echo "Could not find the app's load balancer. Is the cluster up (scripts/eks-up.sh)?"
    echo "Or pass the address yourself:  bash scripts/load-test.sh http://localhost:8080"
    exit 1
  fi
  url="http://$host"
fi

script="$(dirname "$0")/../tests/load/api.js"
echo "Load test: $url  ($users users, $duration at full load)"

# k6 can see localhost only through this name when it runs inside Docker
docker_url="${url/localhost/host.docker.internal}"
docker_url="${docker_url/127.0.0.1/host.docker.internal}"

if command -v k6 >/dev/null 2>&1; then
  BASE_URL="$url" VUS="$users" DURATION="$duration" k6 run "$script"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -i -e BASE_URL="$docker_url" -e VUS="$users" -e DURATION="$duration" \
    grafana/k6:1.3.0 run - < "$script"
else
  echo "Install Docker (or k6) first: https://docs.docker.com/get-docker/"
  exit 1
fi
