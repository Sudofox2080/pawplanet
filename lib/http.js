'use strict';
// HTTP 基础设施：JSON/multipart、cookie、静态文件（含 Range）、错误
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}
const bad = (code, message = code, status = 400) => new HttpError(status, code, message);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}
const ok = (res, data = {}) => sendJSON(res, 200, { ok: true, data });
const fail = (res, status, code, message) =>
  sendJSON(res, status, { ok: false, error: { code, message } });

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(bad('payload_too_large', '请求体过大', 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw bad('bad_json', 'JSON 解析失败');
  }
}

// 最小 multipart/form-data 解析（够接收单文件 + 少量字段）
async function readMultipart(req, limit = 24 * 1024 * 1024) {
  const ctype = req.headers['content-type'] || '';
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
  if (!m) throw bad('bad_multipart', '缺少 boundary');
  const boundary = '--' + (m[1] || m[2]).trim();
  const buf = await readBody(req, limit);
  const bBuf = Buffer.from(boundary);
  const parts = [];
  let start = buf.indexOf(bBuf);
  if (start < 0) throw bad('bad_multipart', '分片解析失败');
  start += bBuf.length;
  while (start < buf.length) {
    // 分片头结束于 \r\n\r\n
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd < 0) break;
    const head = buf.slice(start, headEnd).toString('utf8');
    const bodyStart = headEnd + 4;
    const next = buf.indexOf(bBuf, bodyStart);
    const bodyEnd = next < 0 ? buf.length : next - 2; // 去掉尾部 \r\n
    const data = buf.slice(bodyStart, Math.max(bodyStart, bodyEnd));
    const nameM = /name="([^"]*)"/i.exec(head);
    const fileM = /filename="([^"]*)"/i.exec(head);
    const typeM = /content-type:\s*([^\r\n]+)/i.exec(head);
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : null,
      mime: typeM ? typeM[1].trim().toLowerCase() : 'application/octet-stream',
      data,
    });
    if (next < 0) break;
    start = next + bBuf.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    start += 2;
  }
  const fields = {};
  const files = {};
  for (const p of parts) {
    if (p.filename !== null) files[p.name] = p;
    else fields[p.name] = p.data.toString('utf8');
  }
  return { fields, files };
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeSec = 0) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec > 0) bits.push(`Max-Age=${maxAgeSec}`);
  if (maxAgeSec === 0) bits.push('Max-Age=0');
  res.setHeader('set-cookie', bits.join('; '));
}

// 静态文件 + SPA 回退 + Range（视频/大图拖动）
function serveFile(req, res, file, { cache, spa = false, root = null } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const type = mimeOf(file);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'content-type': type,
    'last-modified': new Date(st.mtimeMs).toUTCString(),
    etag,
    'cache-control': cache || 'no-cache',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const range = req.headers.range;
  if (range && (type.startsWith('video/') || type.startsWith('image/'))) {
    const mm = /bytes=(\d*)-(\d*)/.exec(range);
    if (mm) {
      let s = mm[1] ? parseInt(mm[1], 10) : 0;
      let e = mm[2] ? parseInt(mm[2], 10) : st.size - 1;
      if (Number.isNaN(s) || Number.isNaN(e) || s > e || s >= st.size) {
        res.writeHead(416, { 'content-range': `bytes */${st.size}` });
        res.end();
        return true;
      }
      e = Math.min(e, st.size - 1);
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${s}-${e}/${st.size}`,
        'accept-ranges': 'bytes',
        'content-length': e - s + 1,
      });
      fs.createReadStream(file, { start: s, end: e }).pipe(res);
      return true;
    }
  }
  res.writeHead(200, { ...headers, 'content-length': st.size, 'accept-ranges': 'bytes' });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

const rid = () => crypto.randomBytes(9).toString('hex');

module.exports = {
  HttpError, bad, mimeOf, sendJSON, ok, fail,
  readBody, readJSON, readMultipart, parseCookies, setCookie, serveFile, rid,
};
