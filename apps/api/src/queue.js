// SQS helpers. On AWS the SDK finds credentials by itself (EKS Pod Identity): there are no keys here.
const {
  SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand,
} = require('@aws-sdk/client-sqs');
const config = require('./config');
const log = require('./log');

const enabled = Boolean(config.queue.url);

const client = enabled
  ? new SQSClient({ region: config.queue.region, endpoint: config.queue.endpoint })
  : null;

// Best effort: the task has already been saved, so a queue outage must never fail the user's request.
// Returns true when the job was queued.
async function sendJob(job) {
  if (!enabled) return false;
  try {
    await client.send(
      new SendMessageCommand({ QueueUrl: config.queue.url, MessageBody: JSON.stringify(job) }),
      { abortSignal: AbortSignal.timeout(3000) },
    );
    return true;
  } catch (err) {
    log.warn({ err: err.message, type: job.type }, 'could not queue job');
    return false;
  }
}

// Long polling: waits up to waitSeconds for a message instead of asking over and over.
async function receive(abortSignal) {
  const r = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: config.queue.url,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: config.worker.waitSeconds,
    }),
    { abortSignal },
  );
  return r.Messages || [];
}

const remove = (receiptHandle) =>
  client.send(new DeleteMessageCommand({ QueueUrl: config.queue.url, ReceiptHandle: receiptHandle }));

async function depth(queueUrl) {
  const r = await client.send(new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
  }), { abortSignal: AbortSignal.timeout(3000) });
  return {
    visible: Number(r.Attributes?.ApproximateNumberOfMessages || 0),
    inFlight: Number(r.Attributes?.ApproximateNumberOfMessagesNotVisible || 0),
  };
}

module.exports = { enabled, sendJob, receive, remove, depth };
