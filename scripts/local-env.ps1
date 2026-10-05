# Loads local dev secrets from AWS Secrets Manager into this shell.
# Usage (note the dot + space):  . .\scripts\local-env.ps1
$env:DB_PASSWORD = aws secretsmanager get-secret-value `
  --secret-id aws-eks-gitops-platform/local/db-password `
  --query SecretString --output text
if (-not $env:DB_PASSWORD) { throw "Could not read the secret - check 'aws sts get-caller-identity' and region eu-north-1" }
Write-Host "DB_PASSWORD loaded from AWS Secrets Manager"
