# Creates the local kind cluster, installs the platform (Traefik, metrics-server, ArgoCD)
# and hands the app over to ArgoCD, which deploys it from GitHub.
# Usage (from the repo root):  .\scripts\kind-up.ps1
$ErrorActionPreference = "Stop"

# Must match the tags in gitops/envs/kind/tasks.yaml
$apiVersion = "0.1.1"
$uiVersion = "0.1.0"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Check() { if ($LASTEXITCODE -ne 0) { throw "Previous command failed (exit code $LASTEXITCODE)" } }

Step "Creating kind cluster 'platform' (1 control plane + 2 workers)"
$existing = kind get clusters
if ($existing -contains "platform") { Write-Host "Cluster already exists, reusing it" }
else { kind create cluster --config k8s/kind-config.yaml; Check }

Step "Adding Helm repositories"
helm repo add traefik https://traefik.github.io/charts --force-update; Check
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ --force-update; Check
helm repo add argo https://argoproj.github.io/argo-helm --force-update; Check
helm repo update; Check

Step "Installing Traefik ingress controller (NodePort 30080 -> http://localhost:8088)"
# publishedService off + fixed ingress IP: kind has no cloud load balancer, so without this
# the Ingress never gets an address and ArgoCD reports the app as "Progressing" forever
helm upgrade --install traefik traefik/traefik --namespace traefik --create-namespace `
  --set service.type=NodePort --set ports.web.nodePort=30080 `
  --set providers.kubernetesIngress.publishedService.enabled=false `
  --set "additionalArguments={--providers.kubernetesingress.ingressendpoint.ip=127.0.0.1}" --wait; Check

Step "Installing metrics-server (needed by the HPA)"
helm upgrade --install metrics-server metrics-server/metrics-server --namespace kube-system `
  --set "args={--kubelet-insecure-tls}" --wait; Check

Step "Building images and loading them into kind (api $apiVersion, ui $uiVersion)"
docker build -t tasks-api:$apiVersion --build-arg APP_VERSION=$apiVersion apps/api; Check
docker build -t tasks-ui:$uiVersion apps/ui; Check
kind load docker-image tasks-api:$apiVersion tasks-ui:$uiVersion --name platform; Check

Step "Creating the db-credentials Secret from AWS Secrets Manager (never stored in Git)"
kubectl create namespace tasks --dry-run=client -o yaml | kubectl apply -f -; Check
$pw = aws secretsmanager get-secret-value --secret-id aws-eks-gitops-platform/local/db-password --query SecretString --output text; Check
kubectl create secret generic db-credentials -n tasks `
  --from-literal=username=tasks --from-literal=password=$pw `
  --dry-run=client -o yaml | kubectl apply -f -; Check
Remove-Variable pw

Step "Creating the grafana-admin Secret from AWS Secrets Manager (generated on first run)"
$grafanaSecretId = "aws-eks-gitops-platform/local/grafana-admin-password"
$ErrorActionPreference = "Continue"
$grafanaPw = aws secretsmanager get-secret-value --secret-id $grafanaSecretId --query SecretString --output text 2>$null
$ErrorActionPreference = "Stop"
if (-not $grafanaPw) {
  Write-Host "Not found in AWS - generating a new password and storing it there"
  $grafanaPw = aws secretsmanager get-random-password --password-length 20 --exclude-punctuation --query RandomPassword --output text; Check
  aws secretsmanager create-secret --name $grafanaSecretId --secret-string $grafanaPw | Out-Null; Check
}
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -; Check
kubectl create secret generic grafana-admin -n monitoring `
  --from-literal=admin-user=admin --from-literal=admin-password=$grafanaPw `
  --dry-run=client -o yaml | kubectl apply -f -; Check
Remove-Variable grafanaPw

Step "Installing ArgoCD"
helm upgrade --install argocd argo/argo-cd --namespace argocd --create-namespace `
  --set dex.enabled=false --set notifications.enabled=false --wait; Check

Step "Bootstrapping: root Application (app-of-apps) -> ArgoCD deploys everything else from GitHub"
kubectl apply -f gitops/bootstrap/root-kind.yaml; Check

Step "Waiting for ArgoCD to sync and the app to become Healthy (up to 5 minutes)"
$ErrorActionPreference = "Continue"   # the Application may not exist yet; don't stop on that
$deadline = (Get-Date).AddMinutes(5)
do {
  Start-Sleep -Seconds 10
  $sync = kubectl get application tasks -n argocd -o jsonpath="{.status.sync.status}" 2>$null
  $health = kubectl get application tasks -n argocd -o jsonpath="{.status.health.status}" 2>$null
  Write-Host "  tasks app: sync=$sync health=$health"
} until ($health -eq "Healthy" -or (Get-Date) -gt $deadline)
$ErrorActionPreference = "Stop"

kubectl get pods -n tasks -o wide

$b64 = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}"
$argoPw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
Write-Host "`nApp:        http://localhost:8088" -ForegroundColor Green
Write-Host "Grafana:    http://grafana.localhost:8088  (user: admin, password: in AWS Secrets Manager -> $grafanaSecretId)" -ForegroundColor Green
Write-Host "Prometheus: http://prometheus.localhost:8088" -ForegroundColor Green
Write-Host "ArgoCD: run  kubectl port-forward -n argocd svc/argocd-server 8443:443" -ForegroundColor Green
Write-Host "        then open https://localhost:8443  (user: admin, password: $argoPw)" -ForegroundColor Green
