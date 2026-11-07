# 部署

这是一个零第三方依赖的 Node 服务：一个进程 + 一个目录就能跑，数据库是 SQLite 单文件（`node:sqlite`），上传的图片也放在同一个数据目录里。

## 最小部署

```bash
# 服务器上
cd /opt/pawplanet
PORT=4780 DATA_DIR=/var/lib/pawplanet node server.js
```

`PORT` 与 `DATA_DIR` 都能用环境变量覆盖，`DATA_DIR` 里会有 `app.db` 和 `uploads/`。**这个目录就是全部数据，丢了就没了，务必纳入备份。**

## systemd

`/etc/systemd/system/pawplanet.service`：

```ini
[Unit]
Description=Paw Planet
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pawplanet
Environment=PORT=4780
Environment=DATA_DIR=/var/lib/pawplanet
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node /opt/pawplanet/server.js
Restart=always
RestartSec=2
StandardOutput=append:/var/log/pawplanet.log
StandardError=append:/var/log/pawplanet.log

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now pawplanet
systemctl status pawplanet
curl -s http://127.0.0.1:4780/api/stats
```

## nginx 反代

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 25m;   # 上传上限是 20MB，留点余量

    location / {
        proxy_pass http://127.0.0.1:4780;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`X-Forwarded-For` 不是可选项：登录限流按它取客户端 IP，不传这个头的话所有请求会被当成同一个 IP，几个人一起登录就可能互相触发锁定。

## 升级

```bash
# 本地打包（排除数据目录）
tar -czf pawplanet.tar.gz --exclude=pawplanet/data --exclude=pawplanet/shots pawplanet

# 服务器上
tar -xzf pawplanet.tar.gz -C /tmp
cp -r /tmp/pawplanet/. /opt/pawplanet/
systemctl restart pawplanet
```

`DATA_DIR` 不在包里，覆盖代码不会动数据。静态资源走 `no-cache` + ETag，重启后浏览器自然会拿到新代码。

## 备份

```bash
systemctl stop pawplanet
tar -czf /root/pawplanet-backup-$(date +%F).tar.gz /var/lib/pawplanet
systemctl start pawplanet
```

更轻的做法是在线备份数据库：

```bash
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/var/lib/pawplanet/app.db').exec(\"VACUUM INTO '/root/app-$(date +%F).db'\")"
```

`uploads/` 里的图片需要单独打包或同步。

## 图片放 Cloudflare R2

在项目根写 `.env`（见 README 的「图片存储」一节），重启后新上传的图会走 R2，`/media/<key>` 会 302 到公开域名；R2 不可用时自动回落本地磁盘。把存量图片搬过去：

```bash
node tools/r2-migrate.js            # 先看计划
node tools/r2-migrate.js --apply --delete-local   # 真搬并删本地副本
```

## 清理演示数据

`tools/seed-demo.js` 会建 `alice` / `bob` 两个演示账号。清掉它们（保留其他真实用户内容）：

```bash
node tools/cleanup-test-accounts.js --handles alice,bob           # 先看计划
node tools/cleanup-test-accounts.js --handles alice,bob --apply   # 真删，自动先备份数据库
```

想彻底重置（**会清空所有数据**）：

```bash
systemctl stop pawplanet
rm -rf /var/lib/pawplanet/*
systemctl start pawplanet
```
