# ---- Background jobs: an SQS queue, its dead-letter queue, and who may use them ----
#
#   API     --SendMessage-->  jobs queue  --ReceiveMessage-->  worker
#                                 |  (a message that fails 3 times moves on)
#                                 v
#                            dead-letter queue (kept 14 days, an alert fires while it is not empty)
#
# Pod Identity roles (no keys anywhere): the API may only SEND to the jobs queue, the worker may only
# READ from it. Neither can touch the other queue operations or any other queue.

resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${local.name}-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days, the maximum: time to find out why jobs failed
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "jobs" {
  name = "${local.name}-jobs"

  # Must be longer than the worker needs for one job; a message that is not deleted in this time is delivered again.
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400 # 1 day: jobs older than that are no longer useful
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

# Only the jobs queue may use the dead-letter queue as its parking place.
resource "aws_sqs_queue_redrive_allow_policy" "jobs_dlq" {
  queue_url = aws_sqs_queue.jobs_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.jobs.arn]
  })
}

# -- API: send jobs --
data "aws_iam_policy_document" "api_sqs" {
  statement {
    sid       = "SendJobs"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.jobs.arn]
  }
}

resource "aws_iam_role_policy" "api_sqs" {
  name   = "send-jobs"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_sqs.json
}

# -- worker: read and delete jobs, and look at both queue sizes for the metrics --
resource "aws_iam_role" "worker" {
  name               = "${local.name}-worker"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json
}

data "aws_iam_policy_document" "worker_sqs" {
  statement {
    sid       = "ReadJobs"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.jobs.arn]
  }

  statement {
    sid       = "QueueSizes"
    actions   = ["sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.jobs.arn, aws_sqs_queue.jobs_dlq.arn]
  }
}

resource "aws_iam_role_policy" "worker_sqs" {
  name   = "read-jobs"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_sqs.json
}

resource "aws_eks_pod_identity_association" "worker" {
  cluster_name    = module.eks.cluster_name
  namespace       = "tasks"
  service_account = "worker" # created by the tasks chart (charts/tasks/templates/worker.yaml)
  role_arn        = aws_iam_role.worker.arn
}
