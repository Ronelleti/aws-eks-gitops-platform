#!/usr/bin/env bash
# Preflight: what does this AWS account's organization policy (SCP) allow?
# Uses only FREE calls: dry-runs, reads, or create-then-delete of free objects.
# Run it before `terraform apply` in infra/dev.
#   bash scripts/preflight-aws.sh
set -u

export AWS_DEFAULT_REGION="${AWS_REGION:-eu-north-1}"
export AWS_PAGER=""
blocked=0

# check "<label>" <command...>
check() {
  local label="$1"; shift
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [[ $rc -eq 0 || "$out" == *DryRunOperation* ]]; then
    printf "  ALLOWED        %s\n" "$label"
  elif [[ "$out" == *"explicit deny"* ]]; then
    printf "  BLOCKED (SCP)  %s\n" "$label"; blocked=1
  elif [[ "$out" == *UnauthorizedOperation* || "$out" == *AccessDenied* ]]; then
    printf "  BLOCKED        %s\n" "$label"; blocked=1
  else
    printf "  INCONCLUSIVE   %s -> %s\n" "$label" "$(echo "$out" | tr '\n' ' ' | cut -c1-170)"
  fi
}

# roundtrip "<label>" "<create command>" "<delete command>": creates something free, then removes it again
roundtrip() {
  local label="$1" create="$2" delete="$3" out rc
  out=$(eval "$create" 2>&1); rc=$?
  if [[ $rc -eq 0 ]]; then
    printf "  ALLOWED        %s\n" "$label"
    eval "$delete" >/dev/null 2>&1
  elif [[ "$out" == *"explicit deny"* ]]; then
    printf "  BLOCKED (SCP)  %s\n" "$label"; blocked=1
  elif [[ "$out" == *AccessDenied* || "$out" == *UnauthorizedOperation* || "$out" == *"not authorized"* ]]; then
    printf "  BLOCKED        %s\n" "$label"; blocked=1
  else
    printf "  INCONCLUSIVE   %s -> %s\n" "$label" "$(echo "$out" | tr '\n' ' ' | cut -c1-170)"
  fi
}

echo "Account / identity (region: $AWS_DEFAULT_REGION)"
aws sts get-caller-identity --query '[Account,Arn]' --output text || { echo "AWS login failed"; exit 1; }

echo; echo "Networking (EC2 dry-runs, nothing is created)"
check "create VPC"              aws ec2 create-vpc --cidr-block 10.99.0.0/16 --dry-run
check "create internet gateway" aws ec2 create-internet-gateway --dry-run
check "create launch template"  aws ec2 create-launch-template --launch-template-name preflight-probe \
                                  --launch-template-data '{"InstanceType":"t3.large"}' --dry-run

echo; echo "Worker node instance types (dry-run launch)"
AMI=$(aws ec2 describe-images --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text 2>/dev/null)
if [[ -z "$AMI" || "$AMI" == "None" ]]; then
  echo "  (could not find an AMI to test with - skipping instance checks)"
else
  for t in t3.medium t3.large; do
    check "$t on-demand" aws ec2 run-instances --dry-run --image-id "$AMI" --instance-type "$t" --count 1
    check "$t spot"      aws ec2 run-instances --dry-run --image-id "$AMI" --instance-type "$t" --count 1 \
                           --instance-market-options MarketType=spot
  done
fi

echo; echo "IAM and logging (create + delete of free objects)"
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"pods.eks.amazonaws.com"},"Action":["sts:AssumeRole","sts:TagSession"]}]}'
if aws iam create-role --role-name preflight-probe-role --assume-role-policy-document "$TRUST" >/dev/null 2>/tmp/preflight-iam.err; then
  printf "  ALLOWED        create IAM role (Pod Identity trust)\n"
  aws iam delete-role --role-name preflight-probe-role >/dev/null 2>&1
else
  check "create IAM role (Pod Identity trust)" cat /tmp/preflight-iam.err; blocked=1
fi
if aws logs create-log-group --log-group-name /preflight/probe >/dev/null 2>/tmp/preflight-logs.err; then
  printf "  ALLOWED        create CloudWatch log group\n"
  aws logs delete-log-group --log-group-name /preflight/probe >/dev/null 2>&1
else
  check "create CloudWatch log group" cat /tmp/preflight-logs.err; blocked=1
fi

echo; echo "Services reachable (read-only)"
check "EKS"             aws eks list-clusters
check "RDS (postgres)"  aws rds describe-orderable-db-instance-options --engine postgres --db-instance-class db.t4g.micro --max-items 1
check "Secrets Manager" aws secretsmanager list-secrets --max-results 1
check "Load balancers"  aws elbv2 describe-load-balancers --page-size 1

echo; echo "More AWS services we could add (free probes only)"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
roundtrip "SQS queue (event-driven work, dead-letter queues)" \
  "aws sqs create-queue --queue-name preflight-probe --query QueueUrl --output text" \
  "aws sqs delete-queue --queue-url \$(aws sqs get-queue-url --queue-name preflight-probe --query QueueUrl --output text)"
roundtrip "SNS topic (email and alert notifications)" \
  "aws sns create-topic --name preflight-probe --query TopicArn --output text" \
  "aws sns delete-topic --topic-arn arn:aws:sns:$AWS_DEFAULT_REGION:$ACCOUNT:preflight-probe"
roundtrip "CloudWatch alarm" \
  "aws cloudwatch put-metric-alarm --alarm-name preflight-probe --namespace Preflight --metric-name Probe --statistic Sum --period 60 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanThreshold" \
  "aws cloudwatch delete-alarms --alarm-names preflight-probe"
check "EventBridge rules (schedules, event routing)"        aws events list-rules --max-items 1
check "AWS Budgets (cost alerts as code)"                   aws budgets describe-budgets --account-id "$ACCOUNT" --max-items 1
check "Lambda functions"                                    aws lambda list-functions --max-items 1
check "AWS Backup vaults"                                   aws backup list-backup-vaults --max-results 1
check "GuardDuty (threat detection)"                        aws guardduty list-detectors
check "WAFv2 web ACLs (firewall in front of the ALB)"       aws wafv2 list-web-acls --scope REGIONAL
check "ACM certificates"                                    aws acm list-certificates --max-items 1
check "KMS keys (customer-managed encryption)"              aws kms list-keys --limit 1
check "CloudFront (HTTPS with no domain; a global service)" aws cloudfront list-distributions --max-items 1

echo; echo "Kubernetes versions EKS offers with standard support:"
aws eks describe-cluster-versions --query "clusterVersions[?status=='STANDARD_SUPPORT'].clusterVersion" --output text 2>/dev/null \
  || echo "  (your AWS CLI is too old for this call - fine, skip it)"

echo
echo "Note: creating an EKS cluster or an RDS instance can't be tested for free. If one is blocked,"
echo "terraform apply fails within seconds of that step, before any hourly charge starts."
[[ $blocked -eq 0 ]] && echo "Result: no blocks found." || echo "Result: something is BLOCKED - paste this output before applying."
