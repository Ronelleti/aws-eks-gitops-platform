# Creates the local kind cluster and deploys the whole app.
# Usage (from the repo root):  .\scripts\kind-up.ps1
$ErrorActionPreference = "Stop"
$version = "0.1.0"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Check() { if ($LASTEXITCODE -ne 0) { throw "Previous command failed (exit code $LASTEXITCODE)" } }

Step "Creating kind cluster 'platform' (1 control plane + 2 workers)"
$existing = kind get clusters
if ($existing -contains "platform") { Write-Host "Cluster already exists, reusing it" }
else { kind create cluster --config k8s/kind-config.yaml; Check }

Step "Installing Traefik ingress controller (NodePort 30080 -> http://localhost)"
helm repo add traefik https://traefik.github.io/charts --force-update; Check
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ --force-update; Check
helm repo update; Check
helm upgrade --install traefik traefik/traefik --namespace traefik --create-namespace `
  --set service.type=NodePort --set ports.web.nodePort=30080 --wait; Check

Step "Installing metrics-server (needed by the HPA)"
helm upgrade --install metrics-server metrics-server/metrics-server --namespace kube-system `
  --set "args={--kubelet-insecure-tls}" --wait; Check

Step "Building images $version and loading them into kind"
docker build -t tasks-api:$version --build-arg APP_VERSION=$version apps/api; Check
docker build -t tasks-ui:$version apps/ui; Check
kind load docker-image tasks-api:$version tasks-ui:$version --name platform; Check

Step "Creating namespace and the db-credentials Secret from AWS Secrets Manager"
kubectl apply -f k8s/base/00-namespace.yaml; Check
$pw = aws secretsmanager get-secret-value --secret-id aws-eks-gitops-platform/local/db-password --query SecretString --output text; Check
# the Secret is created from AWS, never stored in Git
kubectl create secret generic db-credentials -n tasks `
  --from-literal=username=tasks --from-literal=password=$pw `
  --dry-run=client -o yaml | kubectl apply -f -; Check
Remove-Variable pw

Step "Applying manifests"
kubectl apply -f k8s/base/; Check

Step "Waiting for pods to be ready"
kubectl rollout status deployment/postgres -n tasks --timeout=180s; Check
kubectl rollout status deployment/api -n tasks --timeout=180s; Check
kubectl rollout status deployment/ui -n tasks --timeout=180s; Check

kubectl get pods -n tasks -o wide
Write-Host "`nDone. Open http://localhost:8088" -ForegroundColor Green
