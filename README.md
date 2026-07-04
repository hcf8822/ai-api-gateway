# AI API Gateway - 词元出海中间商平台

> 基于 Node.js 的完整 AI API 中转平台，对接 QuickRouter 上游，开箱即用。

---

## 本地运行（立即可用）

```bash
cd ai-api-gateway

# 安装依赖
npm install

# 启动
npm start
```

打开浏览器访问 `http://localhost:3000`

- 管理员账号：`admin`
- 管理员密码：`admin123`

---

## 项目结构

```
ai-api-gateway/
├── server.js                # 主服务（Express + SQLite）
├── package.json             # 依赖配置
├── public/                  # 前端页面
│   ├── index.html           # 落地页（营销页）
│   ├── login.html           # 登录页
│   ├── register.html        # 注册页
│   ├── dashboard.html       # 用户控制台
│   ├── admin.html           # 管理后台
│   └── common.css           # 共享样式
├── data/                    # SQLite 数据库（自动创建）
├── docker-compose.yml       # Docker 部署文件（生产环境）
├── nginx/                   # Nginx 反向代理配置
├── scripts/                 # 部署脚本
│   ├── deploy.sh            # Docker 一键部署
│   ├── setup-ssl.sh         # SSL 证书自动申请
│   └── test-upstream.sh     # QuickRouter 连通性测试
└── README.md                # 本文件
```

---

## 功能清单

### 用户端
- 注册 / 登录（JWT 鉴权）
- 新用户注册送 $1 免费额度
- API 令牌管理（创建、删除、复制、额度限制）
- 用量统计（按天、按模型）
- 在线充值（测试模式直接到账，生产环境接支付网关）
- 接入文档

### 管理端
- 用户管理（查看、充值、禁用/启用）
- 系统统计（用户数、令牌数、收入、请求量）
- 上游配置状态监控
- 请求日志查看

### API 代理
- 兼容 OpenAI API 标准
- 支持 /v1/models 和 /v1/chat/completions
- 自动计费扣费（按 Token 精确计算）
- 转发到 QuickRouter 上游

---

## 配置 QuickRouter 上游

### 方法 1：环境变量（推荐）

```bash
# Linux/Mac
export UPSTREAM_API_KEY=sk-你的QuickRouter密钥
npm start

# Windows
set UPSTREAM_API_KEY=sk-你的QuickRouter密钥
npm start
```

### 方法 2：修改 server.js

编辑 `server.js` 第 12 行：

```javascript
apiKey: process.env.UPSTREAM_API_KEY || 'sk-你的QuickRouter密钥',
```

### 配置后验证

```bash
curl http://localhost:3000/api/health
# 应返回 "upstream_configured": true
```

---

## 定价配置

编辑 `server.js` 中的 `CONFIG.modelMultipliers`：

```javascript
modelMultipliers: {
    'gpt-4o': 1.2,              // 比上游贵 20%
    'gpt-4o-mini': 1.2,
    'claude-sonnet-4-20250514': 1.25,  // 贵 25%
    'deepseek-chat': 1.3,        // 贵 30%
    'gemini-2.0-flash': 1.3,
    // ... 其他模型
},
defaultMultiplier: 1.2,  // 未列出的模型默认倍率
```

**定价逻辑**：用户价格 = 上游官方价格 × 倍率

| 模型 | 官方输入价 | 你的倍率 | 用户价格 | 利润率 |
|------|-----------|---------|---------|--------|
| gpt-4o | $2.5/M | 1.2 | $3.0/M | 20% |
| gpt-4o-mini | $0.15/M | 1.2 | $0.18/M | 20% |
| claude-sonnet-4 | $3/M | 1.25 | $3.75/M | 25% |
| deepseek-chat | $0.14/M | 1.3 | $0.18/M | 30% |

---

## 生产部署

### 方式 1：Node.js 直接部署

```bash
# 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# 上传项目
scp -r ai-api-gateway/ root@你的IP:/opt/

# 安装并启动
cd /opt/ai-api-gateway
npm install
UPSTREAM_API_KEY=sk-你的密钥 nohup node server.js &
```

用 PM2 做进程管理（推荐）：

```bash
npm install -g pm2
pm2 start server.js --name ai-gateway
pm2 save
pm2 startup  # 开机自启
```

### 方式 2：Docker 部署

```bash
cd /opt/ai-api-gateway
sudo bash scripts/deploy.sh
```

### 配置域名 + SSL

```bash
# 域名解析到服务器 IP 后
sudo bash scripts/setup-ssl.sh
```

---

## 用户使用方式

你的用户只需要：

1. 在你的平台注册账号
2. 充值（或使用免费额度）
3. 在「API 令牌」页面创建 API Key
4. 修改两行代码即可调用：

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-用户从你平台获取的Key",
    base_url="https://api.你的域名.com/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "你好"}]
)
```

---

## 添加更多模型

编辑 `server.js` 中的 `CONFIG.models` 数组：

```javascript
{ id: 'glm-4', name: 'GLM-4', provider: 'Zhipu', input: 0.5, output: 0.5, context: '128K', tags: ['cn'] },
```

然后添加对应的倍率：

```javascript
'glm-4': 1.3,
```

重启服务即可。

---

## 常见问题

### Q: API 请求返回 503？

QuickRouter 上游未配置。设置 `UPSTREAM_API_KEY` 环境变量后重启。

### Q: API 请求返回 402？

用户余额不足。在控制台充值或由管理员在后台添加余额。

### Q: 如何修改落地页？

编辑 `public/index.html`，修改品牌名称、定价、文案。保存后刷新即可生效。

### Q: 如何修改管理员密码？

登录后台 -> 用户管理 -> 找到 admin -> 禁用后用新密码注册（或直接修改数据库）。

### Q: 数据存储在哪里？

SQLite 数据库文件在 `data/gateway.db`。备份这个文件即可。

---

## 技术栈

- 后端：Node.js + Express + SQLite
- 前端：原生 HTML/CSS/JS（无框架依赖）
- 鉴权：JWT
- API 兼容：OpenAI API 标准
