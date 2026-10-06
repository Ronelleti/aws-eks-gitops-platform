#!/usr/bin/env bash
# One command that shows what is NOT ready yet, and why. Safe to run any time; it only reads.
#   bash scripts/eks-status.sh
# (A plain `kubectl get pods | grep -v Running` hides pods that are Running but not ready, which is
# exactly the state most pods spend their first minutes in.)
set -uo pipefail

CLUSTER="aws-eks-gitops-platform-dev"
REGION="eu-north-1"
aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" >/dev/null 2>&1 || true

echo "== Argo CD applications"
kubectl get applications.argoproj.io -n argocd

echo
echo "== What exactly is not synced or healthy yet"
PY=$(cat << 'PYEND'
import json, sys
found = False
for app in json.load(sys.stdin)["items"]:
    name = app["metadata"]["name"]
    status = app.get("status", {})
    for r in status.get("resources", []):
        health = (r.get("health") or {})
        h, s = health.get("status"), r.get("status")
        if h not in (None, "Healthy") or s not in (None, "Synced"):
            found = True
            print("  %-13s %s/%s   sync=%s health=%s %s" % (name, r.get("kind"), r.get("name"), s, h, health.get("message", "")[:160]))
    for c in status.get("conditions", []):
        found = True
        print("  %-13s PROBLEM %s: %s" % (name, c.get("type"), c.get("message", "")[:300]))
    op = status.get("operationState") or {}
    if op.get("phase") not in (None, "Succeeded"):
        found = True
        print("  %-13s last sync %s: %s" % (name, op.get("phase"), op.get("message", "")[:300]))
if not found:
    print("  nothing: every application is synced and healthy")
PYEND
)
kubectl get applications.argoproj.io -n argocd -o json | python3 -c "$PY"

echo
echo "== Pods that are not ready"
bad=$(kubectl get pods -A --no-headers | awk '{ split($3, r, "/"); if ($4 != "Completed" && (r[1] != r[2] || $4 != "Running")) print "  " $0 }')
if [[ -n "$bad" ]]; then printf '%s\n' "$bad"; else echo "  none: every pod is running and ready"; fi

echo
echo "== Elasticsearch and Kibana"
kubectl get elasticsearch,kibana -n logging 2>/dev/null || echo "  not installed yet"
