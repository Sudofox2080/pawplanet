'use strict';
// 上传落盘与图片尺寸嗅探（零依赖，不转码：前端上传前已压好）
const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR, nowISO } = require('./db');
const { get, run } = require('./db');
const { rid, bad } = require('./http');
const S = require('./storage');

const EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
const KIND_EXT = {
  photo: ['png', 'jpg', 'webp', 'gif', 'avif'],
  avatar: ['png', 'jpg', 'webp', 'gif'],
  cover: ['png', 'jpg', 'webp', 'gif'],
  sticker: ['png', 'jpg', 'webp', 'gif', 'svg'],
  frame: ['png', 'jpg', 'webp', 'gif', 'svg'],
};
const MAX_BYTES = 20 * 1024 * 1024;

function sizeOf(buf, ext) {
  try {
    if (ext === 'png' && buf.length > 24) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (ext === 'gif' && buf.length > 10) {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    if (ext === 'webp' && buf.length > 30) {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') {
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
        return {
          w: 1 + (((b1 & 0x3f) << 8) | b0),
          h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        };
      }
      if (fmt === 'VP8X') {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { w, h };
      }
    }
    if (ext === 'jpg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch { /* 忽略 */ }
  return { w: 0, h: 0 };
}

// 上传落盘：默认进对象存储（R2），没配就落本地磁盘。
// 不管哪种，assets.file 都记「能唯一定位这张图的东西」——
// 远程是对象 key，本地是文件名；remote 字段区分两者。
async function saveUpload(file, { userId, kind }) {
  if (!file || !file.data || !file.data.length) throw bad('no_file', '没有收到文件');
  const ext = EXT[file.mime];
  if (!ext) throw bad('unsupported_type', '只支持图片或视频：' + file.mime);
  const allowed = KIND_EXT[kind] || KIND_EXT.photo;
  if (!allowed.includes(ext)) throw bad('unsupported_type', `该类型不接受 .${ext}`);
  if (file.data.length > MAX_BYTES) throw bad('file_too_large', '文件超过 20MB', 413);
  const id = rid();
  const name = kind === 'sticker' || kind === 'frame'
    ? path.basename(String(file.filename || '')).slice(0, 60)
    : '';
  const { w, h } = sizeOf(file.data, ext);

  let fileKey = `${id}.${ext}`;
  let remote = 0;
  if (S.ready()) {
    const owner = userId ? get('SELECT handle FROM users WHERE id = ?', userId) : null;
    const key = S.keyFor({ kind, handle: owner && owner.handle, id, ext });
    const okRemote = await S.put(key, file.data, file.mime);
    if (okRemote) {
      fileKey = key;
      remote = 1;
    }
  }
  // 没配 R2、或者 R2 写失败（比如凭据只有读权限）→ 老老实实落本地，别让上传失败
  if (!remote) fs.writeFileSync(path.join(UPLOAD_DIR, fileKey), file.data);

  run(
    `INSERT INTO assets (id, user_id, kind, name, file, mime, w, h, size, created_at, remote)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, userId || null, kind, name, fileKey, file.mime, w, h, file.data.length, nowISO(), remote
  );
  const row = get('SELECT * FROM assets WHERE id = ?', id);
  const url = S.urlFor(row);
  return {
    id: row.id, kind: row.kind, url, thumb: url,
    w: row.w, h: row.h, mime: row.mime, name: row.name, remote: !!row.remote,
  };
}

function readUpload(req) {
  return req;
}

module.exports = { saveUpload, sizeOf, KIND_EXT, EXT, MAX_BYTES, readUpload };
