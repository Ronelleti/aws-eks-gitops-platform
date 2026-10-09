"""Cost watchdog: emails you when the expensive, ephemeral parts are left running.

Runs every hour (EventBridge). It looks for EKS clusters and RDS databases that have been
up longer than MAX_HOURS and publishes one summary to the alerts SNS topic.
It only reads; it never stops or deletes anything.
"""
import os
from datetime import datetime, timezone

import boto3

TOPIC_ARN = os.environ["TOPIC_ARN"]
MAX_HOURS = float(os.environ.get("MAX_HOURS", "4"))
HOURLY_COST = os.environ.get("HOURLY_COST_USD", "0.45")


def _hours_since(moment, now):
    return (now - moment).total_seconds() / 3600


def find_long_running(eks, rds, now, max_hours):
    """Return a list of human-readable lines, one per resource that is over the limit."""
    found = []

    for page in eks.get_paginator("list_clusters").paginate():
        for name in page["clusters"]:
            created = eks.describe_cluster(name=name)["cluster"]["createdAt"]
            hours = _hours_since(created, now)
            if hours > max_hours:
                found.append(f"EKS cluster {name}: running for {hours:.1f} hours")

    for page in rds.get_paginator("describe_db_instances").paginate():
        for db in page["DBInstances"]:
            # A stopped database costs only storage, and "creating" has no create time yet.
            if db["DBInstanceStatus"] != "available" or "InstanceCreateTime" not in db:
                continue
            hours = _hours_since(db["InstanceCreateTime"], now)
            if hours > max_hours:
                found.append(f"RDS database {db['DBInstanceIdentifier']}: running for {hours:.1f} hours")

    return found


def build_message(lines, max_hours):
    return (
        f"These resources have been up for more than {max_hours:g} hours:\n\n"
        + "\n".join(f"  - {line}" for line in lines)
        + f"\n\nWhile they run, the dev environment costs about ${HOURLY_COST} per hour.\n"
        "If you are finished for now, run:  bash scripts/eks-down.sh\n"
        "This check runs every hour, so you will get this email again until they are gone."
    )


def handler(event, context):
    now = datetime.now(timezone.utc)
    lines = find_long_running(boto3.client("eks"), boto3.client("rds"), now, MAX_HOURS)
    if not lines:
        print("Nothing running longer than the limit.")
        return {"alerted": False}

    boto3.client("sns").publish(
        TopicArn=TOPIC_ARN,
        Subject="Cost watchdog: dev environment still running",
        Message=build_message(lines, MAX_HOURS),
    )
    print(f"Alert sent for {len(lines)} resource(s).")
    return {"alerted": True, "resources": lines}
