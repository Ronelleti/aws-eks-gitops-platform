# Alerts and cost protection. Persistent on purpose: the safety net has to exist
# even when the dev environment is destroyed.
#
#   SNS topic  ->  your email (one topic; Alertmanager and CloudWatch alarms can use it later)
#   Budget     ->  emails at 50%, 80% and 100% of the monthly limit
#   Watchdog   ->  hourly Lambda that emails you if EKS or RDS has been up too long
#
# The email address is NOT in Git. Put it in infra/global/terraform.tfvars (git-ignored):
#   alert_email = "you@example.com"

data "aws_caller_identity" "current" {}

# ---- the topic and the email subscription ----

resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alerts"
}

# Budgets must be allowed to publish to the topic. Lambda and CloudWatch use IAM, so they don't need this.
data "aws_iam_policy_document" "alerts_topic" {
  statement {
    sid       = "AllowBudgetsToPublish"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

# AWS sends a confirmation email; nothing is delivered until you click "Confirm subscription".
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---- monthly budget ----

resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Track what you actually use, before credits. With credits counted, a $160 credit would
  # keep this budget at $0 and it would never warn you.
  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = var.budget_alert_percentages
    content {
      comparison_operator       = "GREATER_THAN"
      threshold                 = notification.value
      threshold_type            = "PERCENTAGE"
      notification_type         = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
    }
  }

  depends_on = [aws_sns_topic_policy.alerts]
}

# ---- cost watchdog: hourly check for a forgotten environment ----

data "archive_file" "watchdog" {
  type        = "zip"
  source_file = "${path.module}/lambda/cost_watchdog.py"
  output_path = "${path.module}/.build/cost_watchdog.zip"
}

data "aws_iam_policy_document" "watchdog_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Read-only on EKS and RDS, publish to our one topic, write its own logs. Nothing else.
data "aws_iam_policy_document" "watchdog" {
  statement {
    sid       = "ReadWhatIsRunning"
    actions   = ["eks:ListClusters", "eks:DescribeCluster", "rds:DescribeDBInstances"]
    resources = ["*"] # list and describe calls can't be limited to a resource
  }

  statement {
    sid       = "SendTheAlert"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
  }

  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.watchdog.arn}:*"]
  }
}

resource "aws_iam_role" "watchdog" {
  name               = "${var.project}-cost-watchdog"
  assume_role_policy = data.aws_iam_policy_document.watchdog_trust.json
}

resource "aws_iam_role_policy" "watchdog" {
  name   = "watchdog"
  role   = aws_iam_role.watchdog.id
  policy = data.aws_iam_policy_document.watchdog.json
}

# Created here (not by Lambda) so the retention is set and it is removed with everything else.
resource "aws_cloudwatch_log_group" "watchdog" {
  name              = "/aws/lambda/${var.project}-cost-watchdog"
  retention_in_days = 7
}

resource "aws_lambda_function" "watchdog" {
  function_name    = "${var.project}-cost-watchdog"
  role             = aws_iam_role.watchdog.arn
  runtime          = "python3.12"
  handler          = "cost_watchdog.handler"
  filename         = data.archive_file.watchdog.output_path
  source_code_hash = data.archive_file.watchdog.output_base64sha256
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      TOPIC_ARN       = aws_sns_topic.alerts.arn
      MAX_HOURS       = tostring(var.watchdog_max_hours)
      HOURLY_COST_USD = tostring(var.dev_hourly_cost_usd)
    }
  }

  depends_on = [aws_cloudwatch_log_group.watchdog, aws_iam_role_policy.watchdog]
}

resource "aws_cloudwatch_event_rule" "watchdog" {
  name                = "${var.project}-cost-watchdog"
  description         = "Run the cost watchdog every hour"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "watchdog" {
  rule = aws_cloudwatch_event_rule.watchdog.name
  arn  = aws_lambda_function.watchdog.arn
}

resource "aws_lambda_permission" "watchdog" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.watchdog.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.watchdog.arn
}
