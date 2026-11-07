'use strict';
// R2 连通性与权限自检：读、列、写、删逐项验，最后给出结论。
// 用法：node tools/r2-check.js
require('../lib/env');
const R = require('../lib/r2');

const PROBE = `${process.env.R2_PREFIX || 'pawplanet'}/_r2check.txt`;

function line(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}

(async () => {
  const c = R.cfg();
  console.log(`endpoint  ${c.endpoint}`);
  console.log(`bucket    ${c.bucket}`);
  console.log(`public    ${c.publicBase || '（未配置）'}`);
  console.log(`key       ${c.accessKey ? c.accessKey.slice(0, 6) + '…' : '（未配置）'}`);
  console.log('');

  if (!R.ready()) {
    line(false, '配置完整', '缺 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET');
    process.exit(1);
  }
  line(true, '配置完整');

  let readable = false;
  try {
    const buckets = await R.listBuckets();
    line(true, 'ListBuckets', JSON.stringify(buckets));
    readable = true;
  } catch (e) {
    line(false, 'ListBuckets', e.message.slice(0, 140));
  }

  try {
    const list = await R.listObjects('media/', { max: 3 });
    line(true, 'ListObjects', `${list.keys.length} 个对象`);
    readable = true;
  } catch (e) {
    line(false, 'ListObjects', e.message.slice(0, 140));
  }

  let writable = false;
  try {
    await R.putObject(PROBE, Buffer.from('r2check ' + new Date().toISOString()), 'text/plain', null);
    line(true, 'PutObject', PROBE);
    writable = true;
  } catch (e) {
    const denied = e.status === 403 || e.status === 401;
    line(false, 'PutObject', denied ? '403 权限不足：令牌需要「对象 读取和写入」' : e.message.slice(0, 140));
  }

  let deletable = false;
  if (writable) {
    try {
      const ok = await R.deleteObject(PROBE);
      line(ok, 'DeleteObject', PROBE);
      deletable = ok;
    } catch (e) {
      line(false, 'DeleteObject', e.message.slice(0, 140));
    }
  } else {
    line(false, 'DeleteObject', '跳过（当前令牌不能写）');
  }

  console.log('');
  if (readable && writable && deletable) {
    console.log('结论：读写删都可用，可以跑 node tools/r2-migrate.js --apply --delete-local');
  } else if (readable) {
    console.log('结论：只能读，不能写。到 Cloudflare 控制台 → R2 → Manage R2 API Tokens → 新建令牌，');
    console.log('      权限选「对象 读取和写入 / Object Read & Write」，桶选 xiaobei，再用新 Secret 重跑本脚本。');
    process.exit(1);
  } else {
    console.log('结论：连读取都不通，检查账号 ID、Access Key、Secret 是否属于同一套 R2 令牌。');
    process.exit(1);
  }
})();
