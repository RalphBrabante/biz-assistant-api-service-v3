const fs = require('fs');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getModels } = require('../sequelize');

function isDevEnvironment() {
  const env = String(process.env.NODE_ENV || 'development').toLowerCase().trim();
  return env === 'development' || env === 'dev' || env === '';
}

function logStorageDev(level, message, details = undefined) {
  if (!isDevEnvironment()) {
    return;
  }
  const payload = details ? ` ${JSON.stringify(details)}` : '';
  const line = `[storage-dev] ${message}${payload}`;
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

const STORAGE_KEYS = {
  provider: 'storage_provider',
  endpoint: 'do_spaces_endpoint',
  region: 'do_spaces_region',
  bucket: 'do_spaces_bucket',
  accessKey: 'do_spaces_access_key',
  secretKey: 'do_spaces_secret_key',
  cdnBaseUrl: 'do_spaces_cdn_base_url',
  directory: 'do_spaces_directory',
};

function normalizeProvider(value) {
  const provider = String(value || 'local').trim().toLowerCase();
  return provider === 'do_spaces' ? 'do_spaces' : 'local';
}

function trimOrEmpty(value) {
  return String(value || '').trim();
}

function encodeObjectKey(key) {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function getRawStorageSettings() {
  const models = getModels();
  if (!models || !models.AppSetting) {
    return {};
  }

  const rows = await models.AppSetting.findAll({
    where: {
      key: Object.values(STORAGE_KEYS),
    },
    attributes: ['key', 'valueText'],
  });

  const map = {};
  for (const row of rows) {
    map[row.key] = String(row.valueText || '');
  }
  return map;
}

async function getStorageConfig() {
  const settings = await getRawStorageSettings();
  const provider = normalizeProvider(settings[STORAGE_KEYS.provider]);

  const doSpaces = {
    endpoint: trimOrEmpty(settings[STORAGE_KEYS.endpoint]),
    region: trimOrEmpty(settings[STORAGE_KEYS.region]),
    bucket: trimOrEmpty(settings[STORAGE_KEYS.bucket]),
    accessKey: trimOrEmpty(settings[STORAGE_KEYS.accessKey]),
    secretKey: trimOrEmpty(settings[STORAGE_KEYS.secretKey]),
    cdnBaseUrl: trimOrEmpty(settings[STORAGE_KEYS.cdnBaseUrl]),
    directory: trimOrEmpty(settings[STORAGE_KEYS.directory]),
  };

  const isDoSpacesConfigured = Boolean(
    doSpaces.endpoint &&
      doSpaces.region &&
      doSpaces.bucket &&
      doSpaces.accessKey &&
      doSpaces.secretKey
  );

  return {
    provider,
    doSpaces,
    isDoSpacesConfigured,
  };
}

function normalizeEndpoint(endpoint) {
  const value = trimOrEmpty(endpoint);
  if (!value) {
    return '';
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `https://${value}`;
}

function toEndpointHost(endpoint) {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) {
    return '';
  }
  try {
    return new URL(normalized).host || '';
  } catch (_err) {
    return '';
  }
}

function normalizeDoSpacesEndpoint(endpoint, bucket) {
  const host = toEndpointHost(endpoint);
  const bucketName = trimOrEmpty(bucket);
  if (!host) {
    return normalizeEndpoint(endpoint);
  }

  // If user entered bucket-prefixed endpoint (e.g. mybucket.sgp1.digitaloceanspaces.com),
  // normalize it to region endpoint (e.g. sgp1.digitaloceanspaces.com) to avoid
  // TLS SAN mismatch and duplicate bucket host generation.
  if (bucketName && host.toLowerCase().startsWith(`${bucketName.toLowerCase()}.`)) {
    const strippedHost = host.slice(bucketName.length + 1);
    return `https://${strippedHost}`;
  }

  return normalizeEndpoint(endpoint);
}

function buildPublicUrl(config, key) {
  const encodedKey = encodeObjectKey(key);
  const cdnBaseUrl = trimOrEmpty(config.cdnBaseUrl);
  if (cdnBaseUrl) {
    return `${cdnBaseUrl.replace(/\/+$/, '')}/${encodedKey}`;
  }

  const endpointUrl = new URL(normalizeDoSpacesEndpoint(config.endpoint, config.bucket));
  const protocol = endpointUrl.protocol || 'https:';
  const host = endpointUrl.host;
  const bucket = trimOrEmpty(config.bucket);
  const bucketHost = host.startsWith(`${bucket}.`) ? host : `${bucket}.${host}`;
  return `${protocol}//${bucketHost}/${encodedKey}`;
}

function buildObjectKey(config, folder, fileName) {
  const baseDir = trimOrEmpty(config.directory).replace(/^\/+|\/+$/g, '');
  const normalizedFolder = trimOrEmpty(folder).replace(/^\/+|\/+$/g, '');
  const normalizedFileName = trimOrEmpty(fileName).replace(/^\/+|\/+$/g, '');
  const parts = [baseDir, normalizedFolder, normalizedFileName].filter(Boolean);
  return parts.join('/');
}

function decodeObjectKey(key) {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch (_err) {
        return part;
      }
    })
    .join('/');
}

class StorageProviderError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'StorageProviderError';
    this.code = code || 'STORAGE_ERROR';
    this.details = details;
  }
}

function describeStorageError(err) {
  const name = String(err?.name || '').trim();
  const message = String(err?.message || '').trim();
  const statusCode = Number(err?.$metadata?.httpStatusCode || 0);

  if (name === 'CredentialsProviderError' || message.toLowerCase().includes('credential')) {
    return 'Bucket credentials are invalid or missing.';
  }
  if (name === 'TimeoutError' || message.toLowerCase().includes('timeout')) {
    return 'Connection to DigitalOcean Spaces timed out.';
  }
  if (statusCode === 403 || name === 'AccessDenied') {
    return 'Access denied by DigitalOcean Spaces. Check access key, secret key, and bucket policy.';
  }
  if (statusCode === 404 || name === 'NoSuchBucket') {
    return 'DigitalOcean Spaces bucket was not found.';
  }
  if (statusCode === 400 || name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch') {
    return 'Invalid DigitalOcean Spaces credentials or endpoint configuration.';
  }

  return message || 'DigitalOcean Spaces upload failed.';
}

async function uploadImageFromDisk(localPath, options = {}) {
  const config = await getStorageConfig();
  if (config.provider !== 'do_spaces' || !config.isDoSpacesConfigured) {
    return null;
  }

  const endpoint = normalizeDoSpacesEndpoint(config.doSpaces.endpoint, config.doSpaces.bucket);
  const key = buildObjectKey(
    config.doSpaces,
    options.folder || 'uploads',
    options.fileName || `upload-${Date.now()}`
  );
  const startedAt = Date.now();
  const bodyBuffer = await fs.promises.readFile(localPath);
  logStorageDev('info', 'Upload start', {
    provider: 'do_spaces',
    endpoint: config.doSpaces.endpoint,
    bucket: config.doSpaces.bucket,
    key,
    contentType: options.contentType || 'application/octet-stream',
    sizeBytes: bodyBuffer.length,
  });

  const client = new S3Client({
    region: config.doSpaces.region,
    endpoint,
    credentials: {
      accessKeyId: config.doSpaces.accessKey,
      secretAccessKey: config.doSpaces.secretKey,
    },
  });

  const putObject = async (withAcl) => {
    const response = await client.send(
      new PutObjectCommand({
        Bucket: config.doSpaces.bucket,
        Key: key,
        Body: bodyBuffer,
        ...(withAcl ? { ACL: 'public-read' } : {}),
        ContentType: options.contentType || 'application/octet-stream',
        CacheControl: 'public, max-age=31536000',
      })
    );
    logStorageDev('info', 'Upload success', {
      withAcl,
      httpStatusCode: Number(response?.$metadata?.httpStatusCode || 0) || null,
      requestId:
        String(response?.$metadata?.requestId || response?.$metadata?.extendedRequestId || '')
          .trim() || null,
      durationMs: Date.now() - startedAt,
      key,
    });
    return response;
  };

  try {
    await putObject(true);
  } catch (err) {
    // Some Spaces credentials allow PutObject but not PutObjectAcl.
    // Retry without ACL to support these policies.
    const shouldRetryWithoutAcl =
      Number(err?.$metadata?.httpStatusCode || 0) === 403 ||
      String(err?.name || '').trim() === 'AccessDenied';
    logStorageDev('warn', 'Upload attempt failed', {
      withAcl: true,
      willRetryWithoutAcl: shouldRetryWithoutAcl,
      errorName: String(err?.name || ''),
      errorMessage: String(err?.message || ''),
      httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
      requestId:
        String(err?.$metadata?.requestId || err?.$metadata?.extendedRequestId || '').trim() || null,
      key,
    });
    if (shouldRetryWithoutAcl) {
      try {
        await putObject(false);
      } catch (retryErr) {
        logStorageDev('error', 'Retry without ACL failed', {
          withAcl: false,
          errorName: String(retryErr?.name || ''),
          errorMessage: String(retryErr?.message || ''),
          httpStatusCode: Number(retryErr?.$metadata?.httpStatusCode || 0) || null,
          requestId:
            String(retryErr?.$metadata?.requestId || retryErr?.$metadata?.extendedRequestId || '').trim() || null,
          key,
          durationMs: Date.now() - startedAt,
        });
        throw new StorageProviderError('STORAGE_UPLOAD_ERROR', describeStorageError(retryErr), {
          provider: 'do_spaces',
          bucket: config.doSpaces.bucket,
          endpoint: config.doSpaces.endpoint,
          originalErrorName: String(retryErr?.name || ''),
          originalErrorMessage: String(retryErr?.message || ''),
          httpStatusCode: Number(retryErr?.$metadata?.httpStatusCode || 0) || null,
        });
      }
    } else {
      logStorageDev('error', 'Upload failed without retry', {
        withAcl: true,
        errorName: String(err?.name || ''),
        errorMessage: String(err?.message || ''),
        httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
        requestId:
          String(err?.$metadata?.requestId || err?.$metadata?.extendedRequestId || '').trim() || null,
        key,
        durationMs: Date.now() - startedAt,
      });
      throw new StorageProviderError('STORAGE_UPLOAD_ERROR', describeStorageError(err), {
        provider: 'do_spaces',
        bucket: config.doSpaces.bucket,
        endpoint: config.doSpaces.endpoint,
        originalErrorName: String(err?.name || ''),
        originalErrorMessage: String(err?.message || ''),
        httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
      });
    }
  }

  await fs.promises.unlink(localPath).catch(() => undefined);
  return buildPublicUrl(config.doSpaces, key);
}

function extractObjectKeyFromUrl(fileUrl, doSpacesConfig) {
  const rawUrl = trimOrEmpty(fileUrl);
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_err) {
    return null;
  }

  const cdnBaseUrl = trimOrEmpty(doSpacesConfig.cdnBaseUrl);
  if (cdnBaseUrl) {
    const normalizedBase = cdnBaseUrl.replace(/\/+$/, '');
    if (rawUrl.startsWith(`${normalizedBase}/`)) {
      return decodeObjectKey(rawUrl.slice(normalizedBase.length + 1));
    }
  }

  const endpointHost = toEndpointHost(doSpacesConfig.endpoint);
  const bucket = trimOrEmpty(doSpacesConfig.bucket);
  const host = String(parsed.host || '').toLowerCase();
  const bucketHost = `${bucket.toLowerCase()}.${endpointHost.toLowerCase()}`;
  const pathNoSlash = String(parsed.pathname || '').replace(/^\/+/, '');

  if (host === bucketHost) {
    return decodeObjectKey(pathNoSlash);
  }
  if (host === String(endpointHost || '').toLowerCase()) {
    if (pathNoSlash.toLowerCase().startsWith(`${bucket.toLowerCase()}/`)) {
      return decodeObjectKey(pathNoSlash.slice(bucket.length + 1));
    }
  }

  return null;
}

async function deleteRemoteFileByUrl(fileUrl) {
  const config = await getStorageConfig();
  if (config.provider !== 'do_spaces' || !config.isDoSpacesConfigured) {
    return { deleted: false, skipped: true, reason: 'provider_not_configured' };
  }

  const key = extractObjectKeyFromUrl(fileUrl, config.doSpaces);
  if (!key) {
    return { deleted: false, skipped: true, reason: 'url_not_bucket_object' };
  }

  const endpoint = normalizeDoSpacesEndpoint(config.doSpaces.endpoint, config.doSpaces.bucket);
  const client = new S3Client({
    region: config.doSpaces.region,
    endpoint,
    credentials: {
      accessKeyId: config.doSpaces.accessKey,
      secretAccessKey: config.doSpaces.secretKey,
    },
  });

  try {
    const response = await client.send(
      new DeleteObjectCommand({
        Bucket: config.doSpaces.bucket,
        Key: key,
      })
    );
    logStorageDev('info', 'Delete success', {
      bucket: config.doSpaces.bucket,
      key,
      httpStatusCode: Number(response?.$metadata?.httpStatusCode || 0) || null,
      requestId:
        String(response?.$metadata?.requestId || response?.$metadata?.extendedRequestId || '')
          .trim() || null,
    });
    return { deleted: true, skipped: false };
  } catch (err) {
    logStorageDev('warn', 'Delete failed', {
      bucket: config.doSpaces.bucket,
      key,
      errorName: String(err?.name || ''),
      errorMessage: String(err?.message || ''),
      httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
      requestId:
        String(err?.$metadata?.requestId || err?.$metadata?.extendedRequestId || '').trim() || null,
    });
    throw new StorageProviderError('STORAGE_DELETE_ERROR', describeStorageError(err), {
      provider: 'do_spaces',
      bucket: config.doSpaces.bucket,
      endpoint: config.doSpaces.endpoint,
      key,
      originalErrorName: String(err?.name || ''),
      originalErrorMessage: String(err?.message || ''),
      httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
    });
  }
}

async function compressImageAtPath(localPath, maxBytes = 2 * 1024 * 1024) {
  const targetPath = String(localPath || '').trim();
  if (!targetPath) {
    return { compressed: false, bytes: 0 };
  }

  const originalBuffer = await fs.promises.readFile(targetPath);
  if (originalBuffer.length <= maxBytes) {
    return { compressed: false, bytes: originalBuffer.length };
  }

  let sharpLib;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    sharpLib = require('sharp');
  } catch (_err) {
    return { compressed: false, bytes: originalBuffer.length };
  }

  let instance = sharpLib(originalBuffer, { failOnError: false });
  const metadata = await instance.metadata();
  const baseWidth = Number(metadata.width || 0);
  const format = String(metadata.format || 'jpeg').toLowerCase();
  const supported = ['jpeg', 'jpg', 'png', 'webp', 'avif', 'heif'];
  const outputFormat = supported.includes(format) ? format : 'jpeg';

  let bestBuffer = null;
  let bestSize = Number.MAX_SAFE_INTEGER;
  const qualitySteps = [85, 75, 65, 55, 45, 35];
  const resizeFactors = [1, 0.9, 0.8, 0.7, 0.6];

  for (const factor of resizeFactors) {
    const width = baseWidth > 0 ? Math.max(320, Math.floor(baseWidth * factor)) : undefined;
    for (const quality of qualitySteps) {
      let candidate = sharpLib(originalBuffer, { failOnError: false });
      if (width && baseWidth > width) {
        candidate = candidate.resize({ width, withoutEnlargement: true, fit: 'inside' });
      }

      switch (outputFormat) {
        case 'png':
          candidate = candidate.png({
            quality,
            compressionLevel: 9,
            palette: true,
            effort: 10,
          });
          break;
        case 'webp':
          candidate = candidate.webp({ quality, effort: 6 });
          break;
        case 'avif':
          candidate = candidate.avif({ quality, effort: 6 });
          break;
        default:
          candidate = candidate.jpeg({ quality, mozjpeg: true });
          break;
      }

      // eslint-disable-next-line no-await-in-loop
      const output = await candidate.toBuffer();
      const size = output.length;
      if (size < bestSize) {
        bestSize = size;
        bestBuffer = output;
      }
      if (size <= maxBytes) {
        await fs.promises.writeFile(targetPath, output);
        return { compressed: true, bytes: size };
      }
    }
  }

  if (bestBuffer && bestBuffer.length < originalBuffer.length) {
    await fs.promises.writeFile(targetPath, bestBuffer);
    return { compressed: true, bytes: bestBuffer.length };
  }

  return { compressed: false, bytes: originalBuffer.length };
}

module.exports = {
  STORAGE_KEYS,
  StorageProviderError,
  compressImageAtPath,
  deleteRemoteFileByUrl,
  getStorageConfig,
  uploadImageFromDisk,
};
