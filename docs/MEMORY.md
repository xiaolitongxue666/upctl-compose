# upctl-compose 部署环境

## 概览

upctl-compose 是一个 Docker Compose 多容器部署栈，所有服务通过 `docker compose up -d` 一键启动，运行在同一个容器网络内。

## 服务清单

| 服务 | 角色 | 容器内端口 | 对外端口 |
|------|------|-----------|---------|
| **nginx** | 反向代理 + 静态文件服务 | `:80` | `:8088` |
| **authcore** | 身份认证 / JWT 签发 | `:3000` | `:3000` |
| **upctl-svc** | 工单 CRUD API (Gitea 代理) | `:3005` | `:3005` |
| **upctl-web** | Vue 3 SPA 工单管理前端 | nginx 内托管 | — |
| **authcoreadmin** | Vue 3 管理后台 (用户/角色) | `:80` | `:8089` |
| **ai-agent** | AI 工单处理 Worker (Python) | — | — |
| **gitea** | 代码托管 + 工单追踪 + CI Runner | `:3000` | `:3001` |
| **postgres** | 全局数据库 (所有服务共享) | `:5432` | `:5432` |
| **redis** | 缓存 / Session 存储 | `:6379` | `:6379` |

## 网络拓扑

```
                    ┌─────────────┐
                    │  浏览器      │
                    │ :8088       │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   nginx     │
                    │ 反向代理    │
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ authcore │ │upctl-svc │ │upctl-web │
        │ :3000    │ │ :3005    │ │ (static) │
        └────┬─────┘ └────┬─────┘ └──────────┘
             │            │
             ▼            ▼
        ┌──────────┐ ┌──────────┐
        │ postgres │ │  gitea   │
        │ :5432    │ │ :3000    │
        └──────────┘ └──────────┘
```

- **nginx** 是唯一对外暴露的入口（`:8088`），负责反代所有后端服务
- **postgres** 和 **redis** 作为基础设施层，被所有需要它们的服务依赖
- **gitea** 通过 **upctl-svc** 代理访问（不直接对外暴露 3000 端口）
- **ai-agent** 通过 upctl-svc 的 API 代理轮询 Gitea 工单

## 环境变量与配置

### 默认值

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEEPSEEK_API_KEY` | 空（需在 `.env` 中配置） | DeepSeek API 密钥 |
| `DEFAULT_MODEL` | `deepseek-v4-flash` | DeepSeek 模型名称 |
| `JWT_KEY` | `upctl-dev-jwt-key-change-in-production` | JWT 签名密钥（开发用） |
| `GITEA_AUTH_HEADER` | `Basic YWktYm90OmFpLWJvdC1kZXYtcGFzcw==` | Gitea API 认证头 |
| `POLL_INTERVAL` | `300` | ai-agent 轮询间隔（秒） |
| `AGENT_BACKEND` | `local` | Agent 后端模式（local/ssh） |
| `DATA_DIR` | `./data` | upctl-svc 数据目录 |

### 配置文件存储

upctl-svc 使用文件系统持久化运行状态：

| 文件 | 路径（相对 DATA_DIR） | 用途 |
|------|----------------------|------|
| `prompt_prefix.txt` | `{DATA_DIR}/prompt_prefix.txt` | 默认 prompt 指令前缀 |
| `memory_dir.txt` | `{DATA_DIR}/memory_dir.txt` | Memory 文档目录路径 |
| `projects.json` | `{DATA_DIR}/projects.json` | 项目定义（含 memory_doc） |
| `deploy_envs.json` | `{DATA_DIR}/deploy_envs.json` | 部署环境定义 |

默认 `DATA_DIR=/app/data`（容器内）。

## 数据持久化

| 卷 | 挂载点 | 用途 |
|----|--------|------|
| `pgdata` | postgres 数据目录 | PostgreSQL 永久数据 |
| `gitea` | `/data` | Gitea 仓库、工单、配置 |
| `uploads` | `/app/uploads` | 附件上传存储 |
| `agent-workspace` | `/app/workspace` | AI Agent 工作目录 |

## AI Agent 配置与工作流程

```
MEMORY.md → agent_prompt → prompt_prefix + 记忆上下文 + 工单上下文 + 用户提示 → DeepSeek
```

- **ai-agent** 容器运行 `poll_worker.py`，每 5 分钟（`POLL_INTERVAL`）轮询一次
- 发现 `approved` 标签的工单 → 添加 `in_progress` 标签 → 调用 `agent_prompt` API → 发送到 DeepSeek → 评论结果 → 关闭工单
- `agent_prompt` API 在 upctl-svc 中组装完整提示词：
  1. **claude_prompt_prefix** — 从 `prompt_prefix.txt` 读取的行为指令
  2. **Memory 上下文** — 指示 Agent 首先 `cat MEMORY.md` 了解环境
  3. **工单上下文** — 工单标题、内容、评论、关联项目信息
  4. **用户提示** — 最终要执行的任务描述
- ai-agent 容器内运行 tmux session + deepseek-tui（YOLO 模式），通过 tmux send-keys 交互

## 健康检查

| 服务 | 检查方式 | 间隔 |
|------|---------|------|
| postgres | `pg_isready -U upctl` | 5s |
| redis | `redis-cli ping` | 5s |
| ai-agent | `tmux has-session -t deepseek-agent` | 30s |

## CI/CD

GitHub Actions 工作流（`.github/workflows/ci.yml`）：
1. **lint** — 验证 docker-compose.yml 格式
2. **submodule-check** — 验证 upctl-agent 子模块
3. **integration** — 构建镜像 → 启动服务 → 冒烟测试 → 初始化 Gitea → E2E 后端测试 → Playwright 前端测试 → 清理

## 本地开发

- 所有业务代码在 `$HOME/works/` 下
- ai-agent 产/测分离：`upctl-agent/` 是子模块，`tests/` 为本地 Playwright 和 E2E 测试
- 初始化脚本：`docker compose exec ai-agent python3 /app/setup-gitea.py`
- 手动触发 AI 处理：`docker compose exec ai-agent python3 /app/poll_worker.py --once`

## 出网代理

moicen 服务器上的 Rust 编译、npm install、git 操作等需要通过代理出网：

```
moicen SSH :1080 → alchemy V2Ray SOCKS5 :1080 → 互联网
```

通过 `huiwing-tunnel-alchemy` 脚本一键建立 SSH 隧道：
```bash
ssh -N -L 127.0.0.1:1080:127.0.0.1:1080 weli@alchemy-studio.cn
```

## 相关文档

| 主题 | 路径 |
|------|------|
| 系统架构 | `ARCHITECTURE.md` |
| 部署架构 | `docs/deployment-architecture.md` |
| 用户手册（PDF） | `userguide/userguide.pdf` |
| Agent 可靠性工程（PDF） | `userguide/upctl-pitch.pdf` |
| docker-compose.yml | `docker-compose.yml` |
