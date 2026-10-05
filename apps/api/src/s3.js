// S3 helpers. On AWS the SDK finds credentials by itself (EKS Pod Identity): there are no keys here.
const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand, DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('./config');
const log = require('./log');

const enabled = Boolean(config.s3.bucket);

// requestChecksumCalculation WHEN_REQUIRED: newer SDK versions add a CRC32 checksum of the (empty) body to
// presigned PUT URLs, which makes browser uploads fail with a checksum mismatch.
const client = enabled
  ? new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      forcePathStyle: config.s3.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  : null;

const Bucket = config.s3.bucket;

const presignUpload = (key, contentType) =>
  getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), { expiresIn: 300 });

const presignDownload = (key, filename, inline) =>
  getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket,
      Key: key,
      ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`,
    }),
    { expiresIn: 300 },
  );

async function headObject(key) {
  const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
  return { size: Number(r.ContentLength || 0) };
}

// Best effort: a failed delete is logged and never blocks the request.
async function deleteObjects(keys) {
  if (!enabled) return;
  await Promise.all(
    keys.map((Key) =>
      client.send(new DeleteObjectCommand({ Bucket, Key })).catch((err) => log.warn({ key: Key, err: err.message }, 'could not delete object')),
    ),
  );
}

// Is the bucket reachable? Cached for 20 seconds so the System page cannot hammer S3.
let cached = { at: 0, value: null };
async function bucketStatus() {
  if (!enabled) return { enabled: false };
  if (Date.now() - cached.at < 20000 && cached.value) return cached.value;
  const started = process.hrtime.bigint();
  let value;
  try {
    await client.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(3000) });
    value = { enabled: true, ok: true, latencyMs: Number(process.hrtime.bigint() - started) / 1e6, bucket: Bucket, region: config.s3.region };
  } catch (err) {
    // 403 still proves S3 answered: this role may not be allowed to HeadBucket, only to use the objects
    const answered = err?.$metadata?.httpStatusCode === 403;
    value = { enabled: true, ok: answered, latencyMs: Number(process.hrtime.bigint() - started) / 1e6, bucket: Bucket, region: config.s3.region, note: answered ? 'reachable (bucket-level access not granted)' : err.name };
  }
  cached = { at: Date.now(), value };
  return value;
}

module.exports = { enabled, presignUpload, presignDownload, headObject, deleteObjects, bucketStatus };
