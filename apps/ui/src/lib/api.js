// The only file that talks to the API. Everything goes through /api (nginx forwards it to the API pods).
export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `The request failed (${res.status}).`, data?.fields);
  return data;
}

export const api = {
  tasks: () => request('GET', '/tasks'),
  task: (id) => request('GET', `/tasks/${id}`),
  create: (input) => request('POST', '/tasks', input),
  update: (id, patch) => request('PATCH', `/tasks/${id}`, patch),
  remove: (id) => request('DELETE', `/tasks/${id}`),
  requestUpload: (taskId, file) =>
    request('POST', `/tasks/${taskId}/attachments`, {
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }),
  confirmUpload: (attachmentId) => request('POST', `/attachments/${attachmentId}/confirm`),
  downloadUrl: (attachmentId, inline = false) => request('GET', `/attachments/${attachmentId}/download${inline ? '?inline=1' : ''}`),
  deleteAttachment: (attachmentId) => request('DELETE', `/attachments/${attachmentId}`),
  stats: () => request('GET', '/stats'),
  activity: (limit = 15) => request('GET', `/activity?limit=${limit}`),
  info: () => request('GET', '/info'),
  system: () => request('GET', '/system'),
  seedDemo: () => request('POST', '/demo/seed'),
};

// The browser sends the file straight to S3 (not through our servers). XHR is used for upload progress.
export function putFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'Storage refused the upload.')));
    xhr.onerror = () => reject(new ApiError(0, 'The upload was interrupted. Try again.'));
    xhr.send(file);
  });
}
