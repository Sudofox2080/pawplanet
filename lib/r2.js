'use strict';
// 最小 S3/R2 客户端（零依赖，node:crypto 手写 SigV4）。
// 只做本项目的需要：PutObject / GetObject / DeleteObject / HeadObject / ListObjectsV2 / ListBuckets。
const crypto = require('crypto');
const fs = require('fs');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

function cfg() {
  const accountId = process.env.R2_ACCOUNT_ID || '';
  return {
    accountId,
    accessKey: process.env.R2_ACCESS_KEY_ID || '',
    secretKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || '',
    endpoint: process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ''),
    publicBase: (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, ''),
  };
}

function ready(c = cfg()) {
  return !!(c.accountId && c.accessKey && c.secretKey && c.bucket);
}

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
// key 里的 / 要保留，逐段编码
const encodeKey = (key) => key.split('/').map(enc).join('/');

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

// query 必须是 [[k,v],...] 且按 k,v 排序后编码
function canonicalQuery(pairs) {
  return (pairs || [])
    .map(([k, v]) => [enc(String(k)), enc(String(v))])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

async function signedFetch({ method, bucket, key = '', query = [], body, contentType, extraHeaders = {}, expect = null }, c = cfg()) {
  const host = new URL(c.endpoint).host;
  const path = '/' + (bucket || c.bucket) + (key ? '/' + key : '');
  const canonicalUri = '/' + (bucket || c.bucket) + (key ? '/' + key.split('/').map(enc).join('/') : '');
  const cq = canonicalQuery(query);

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body === undefined || body === null
    ? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    : sha256Hex(body);

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  for (const [k, v] of Object.entries(extraHeaders)) headers[k.toLowerCase()] = String(v);

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${String(headers[h]).trim()}\n`).join('');
  const signedHeaderList = signedHeaders.join(';');

  const canonicalRequest = [method, canonicalUri, cq, canonicalHeaders, signedHeaderList, payloadHash].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + c.secretKey, dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;

  const url = `${c.endpoint}${canonicalUri}${cq ? '?' + cq : ''}`;
  const res = await fetch(url, { method, headers, body });
  if (expect !== null && res.status !== expect) {
    const text = await res.text().catch(() => '');
    const err = new Error(`R2 ${method} ${key || bucket} -> ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function listBuckets(c = cfg()) {
  const res = await signedFetch({ method: 'GET', bucket: '', key: '', expect: 200 }, c);
  const xml = await res.text();
  return [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
}

async function listObjects(prefix = '', { max = 1000, continuation = null } = {}, c = cfg()) {
  const q = [['list-type', '2'], ['prefix', prefix], ['max-keys', String(max)]];
  if (continuation) q.push(['continuation-token', continuation]);
  const res = await signedFetch({ method: 'GET', bucket: c.bucket, key: '', query: q, expect: 200 }, c);
  const xml = await res.text();
  const keys = [...xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>/g)]
    .map((m) => ({ key: m[1], size: Number(m[2]) }));
  const next = (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] || null;
  return { keys, next };
}

async function putObject(key, body, contentType, cacheControl = 'public, max-age=31536000, immutable', c = cfg()) {
  const extra = cacheControl ? { 'cache-control': cacheControl } : {};
  await signedFetch({ method: 'PUT', bucket: c.bucket, key, body, contentType, extraHeaders: extra, expect: 200 }, c);
  return { key, size: body.length, contentType };
}

async function putFile(key, filePath, contentType, c = cfg()) {
  const buf = fs.readFileSync(filePath);
  const type = contentType || MIME[require('path').extname(filePath).toLowerCase()] || 'application/octet-stream';
  return putObject(key, buf, type, undefined, c);
}

async function getObject(key, c = cfg()) {
  const res = await signedFetch({ method: 'GET', bucket: c.bucket, key, expect: 200 }, c);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteObject(key, c = cfg()) {
  const res = await signedFetch({ method: 'DELETE', bucket: c.bucket, key }, c);
  return res.status === 204 || res.status === 200;
}

async function headObject(key, c = cfg()) {
  const res = await signedFetch({ method: 'HEAD', bucket: c.bucket, key }, c);
  return { exists: res.status === 200, size: Number(res.headers.get('content-length') || 0) };
}

// 公开访问地址（r2.dev 或自定义域名）
function publicUrl(key, c = cfg()) {
  if (!c.publicBase) return null;
  return `${c.publicBase}/${encodeKey(key)}`;
}

module.exports = {
  cfg, ready, listBuckets, listObjects, putObject, putFile, getObject, deleteObject, headObject, publicUrl, MIME,
};
