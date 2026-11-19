# SignalDeck × Vela 工作站

本项目基于 ErTasselli/OpenTerminal，保留其 Next.js / React 工作区、Express 多源数据服务和 SQLite 组合追踪，将主图表组件替换为 LuxAlgo Vela 0.9 和 PineTS Worker。上游许可证保留在 LICENSE；没有重新实现一套外观相似但功能缺失的外壳。

## 启动

建议使用 Node.js 22.9 或更新版本、npm，以及 Python 3.13。quant 要求 Python >=3.11，但锁文件目前基于 Python 3.13 验证；其他版本需核对依赖兼容性。所有 Node 依赖由仓库根目录的 package-lock.json 管理，不在 web 或 server 内单独安装或生成锁文件。

```bash
cd /Users/zhongxin/SignalDeck
npm ci
npm run setup:quant
cp -n /Users/zhongxin/SignalDeck/.env.example /Users/zhongxin/SignalDeck/.env
npm run dev:all
```

打开 http://localhost:3000；Express 默认仅监听 127.0.0.1:4000，Python quant 默认仅监听 127.0.0.1:8010。本地 API 密钥会生成到 /Users/zhongxin/SignalDeck/data/.api-key，由 Next.js 服务端读取，不向浏览器暴露。没有付费行情密钥也能启动；公网数据是否可用取决于供应商及网络环境。

`setup:quant` 创建 /Users/zhongxin/SignalDeck/quant/.venv，先安装 requirements.lock，再以 --no-deps 安装本地包；可通过 `PYTHON=/绝对路径/python3.13 npm run setup:quant` 选择解释器。无需手动激活虚拟环境。`dev:quant` 单独启动 Python 服务，不开启热重载，修改 Python 后需重启；`dev` 仅启动 API 与 Web；`dev:all` 同时启动三项服务，子服务退出后停止其他服务，Ctrl+C 结束整组进程。

根目录 `dev`、`dev:all`、`dev:quant`、`start` 加载 .env 和 .env.local，后者优先；已有进程环境变量优先于文件。工作区单独命令不加载根环境文件，需自行导出变量。端口默认 API 4000、Web 3000、quant 8010；更改 quant 端口时同步设置 QUANT_PORT 与 QUANT_URL，更改 API 端口时同步设置 API_PORT 与 API_URL，Web 可通过 PORT 调整，且同步修改 WEB_ORIGIN。

生产模式：

```bash
npm run build
npm run dev:quant
```

保持 quant 运行，在另一个终端启动 API 和 Web：

```bash
cd /Users/zhongxin/SignalDeck
npm start
```

不要在同一目录同时运行 next dev 和 next build，两者会共用 .next。端口冲突时分别设置 API_PORT、API_URL 和 Next.js 的 -p 参数。

## 四项量化功能

- 自选监控：侧栏“A股自选 / 日线”添加六位 A 股代码（例如 600000、000001），查看报价与前复权日线。上限 100 个代码；失败显示错误，不回退假行情。
- 条件选股：侧栏“量化选股”选择 ma_cross、macd_cross、volume_breakout 或 rsi_rebound，提交异步 screen 任务，查看任务历史、命中和逐股失败原因。
- 策略回测：选择 dual_ma、macd、rsi、bollinger 或 breakout，配置本金、仓位、佣金、印花税和日线数量，提交 backtest 任务，查看权益曲线、交易记录和限制说明。默认 250 根日线，最大 2000；不是实盘下单或完整交易所撮合模拟。
- 信号预警：侧栏“提醒 / 历史”选择 ma_cross、macd_cross 或 breakout，设置代码、扫描间隔（1–1440 分钟）及本地、飞书或邮件通道。未配置外部通道时只能使用本地记录。“测试”立即真实扫描，绕过日历和启用状态，命中时可能发出实际通知；没有命中不会生成通知。

自选、任务、预警与通知持久化到 /Users/zhongxin/SignalDeck/data/terminal.db，容器则使用 terminal-data 卷。选股/回测无需交易时段；只有自动预警扫描受日历控制。日线信号不等同于实时分笔预警。

## 日历与通知

/Users/zhongxin/SignalDeck/config/trading-calendar.example.json 只展示格式，不是完整权威交易日历。示例仅覆盖 2026-01-01 至 2026-01-02，不覆盖当前日期，因此不会在当前日期误开启扫描。不得使用“所有工作日”代替节假日、临时休市等官方交易安排。

```bash
cp -n /Users/zhongxin/SignalDeck/config/trading-calendar.example.json /Users/zhongxin/SignalDeck/config/trading-calendar.json
```

将副本的 valid_from、valid_to 和 trading_days 替换为经过核对的交易所日历，日期格式均为 YYYY-MM-DD，trading_days 列出覆盖区间内所有实际交易日。本地在 /Users/zhongxin/SignalDeck/.env 设置 `QUANT_CALENDAR_FILE=/Users/zhongxin/SignalDeck/config/trading-calendar.json`。Compose 固定读取 `/app/config/trading-calendar.json`，由宿主机 config 目录只读挂载；无需设置宿主机绝对路径到容器环境变量。

自动扫描使用 Asia/Shanghai 的 09:30:00–11:30:00、13:00:00–15:00:00（含端点）。缺少文件、格式非法、未覆盖今天、非交易日或盘外时间均停止扫描，状态接口显示原因；每轮重新读取日历，无需为更新文件重启服务。已排队的通知仍会尝试投递。

/Users/zhongxin/SignalDeck/.env.example 提供真实实现支持的所有 QUANT_* 参数。QUANT_TIMEOUT_MS 范围 100–300000，默认 30000；Web 代理超时为 30 秒，通常应保持默认值。飞书使用 QUANT_FEISHU_WEBHOOK（仅支持 open.feishu.cn/open.larksuite.com 的 HTTPS 自定义机器人地址），启用签名时设置 QUANT_FEISHU_SECRET。邮件需同时配置 QUANT_SMTP_HOST、QUANT_SMTP_USER、QUANT_SMTP_PASS、QUANT_EMAIL_FROM、QUANT_EMAIL_TO；QUANT_SMTP_PORT 默认 587（要求 STARTTLS），465 使用隐式 TLS。配置状态不代表凭据或投递已成功，需通过真实通知验收。敏感值仅放入未跟踪的环境文件，不提交仓库。

## Compose 部署

```bash
cd /Users/zhongxin/SignalDeck
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api web quant
```

Compose 将 QUANT_URL 固定为 http://quant:8010，QUANT_HOST 固定为 0.0.0.0；quant 无 ports 映射，只能经 Compose 网络访问，不可把其未经鉴权的接口直接暴露到宿主机或公网。它需要访问公网行情源，所以不是 Docker `internal: true` 的断网网络。API 等待 quant 的 /health 检查通过后启动；Web 经 API_URL=http://api:4000 访问 API，API 密钥通过共享数据卷或 API_KEY 传递。API 与 Web 默认只发布到宿主机 127.0.0.1:4000/3000。对外开放前需额外配置 HTTPS、身份认证、访问控制及备份，单独的 API_KEY 不等于浏览器用户登录。

Node 镜像均从根锁文件执行 npm ci；Python 镜像使用 Python 3.13 与 requirements.lock。`docker compose down` 停止服务并保留数据卷；不要使用 `down -v`，除非明确要删除全部持久化数据。更新前备份 SQLite（建议停服务后备份 terminal-data 卷）与经过核对的日历文件。

## 服务契约核对

浏览器 → Next.js `/api/quant/*` → Express `/api/quant/*`（附加 X-API-Key）→ Python quant。Python 的原始路径没有 `/api/quant` 前缀：GET /health、/formulas、/strategies；POST /quotes、/history、/screen、/backtest、/signals。Express 提供 GET /status、/formulas、/strategies、/watchlist、/quotes、/history/:code、/jobs、/jobs/:id、/alerts、/notifications，以及相应的自选/任务/预警写操作；选股与回测通过 POST /jobs 的 `{ kind, params }` 异步提交，不直接调用浏览器侧 /screen 或 /backtest。

```bash
curl --fail http://127.0.0.1:8010/health
curl --fail http://localhost:3000/api/quant/status
curl --fail http://localhost:3000/api/quant/formulas
curl --fail http://localhost:3000/api/quant/strategies
```

Python health 返回 `{ status: "ok", source: "akshare/eastmoney", market_verified: false }` 仅表示进程就绪，不验证行情源。Express quant status 即使 quant 不可用也返回 HTTP 200，必须检查 available 字段，并检查 scheduler.allowed/reason 与 channels。直接访问 Express quant 接口需要 X-API-Key；通过 Next.js 无需把密钥放进浏览器。真实行情验收需继续调用报价/日线与选股回测任务，并检查任务状态、failures 和数据来源，不把目录接口或自动化 fixture 测试当作行情成功证明。

## 操作

- 默认 LIVE 使用公共行情；失败明确显示错误，不会自动伪装成模拟行情。
- 在图表工具栏将数据改为 FIXTURE，可在无公网行情时验收真实 Vela 渲染。FIXTURE 是确定性生成的模拟 OHLCV，不代表真实市场价格，仅作用于图表。
- 点击 PINE 打开编辑器，再点击“执行”或 Ctrl/Cmd+Enter，运行默认 Pine v6 SMA20。脚本在 Worker 执行；“清除”移除该脚本指标。
- Ctrl/Cmd+K 打开证券搜索。Alt+1…9 添加图表、报价、新闻、筛选器、热图、加密资产、期权、组合和 AI 面板；macOS 的 Option 键字符映射可能影响 Alt 数字快捷键，可使用侧栏按钮。
- 拖动面板标题栏排列，使用右下角调整大小。布局、自选列表等由 Zustand 保存到浏览器本地；组合交易由 SQLite 保存。
- 可切换范围、周期、蜡烛/柱/线/面积样式以及原生 SMA、EMA、VWAP、BOLL、RSI、MACD。公共数据不足以生成分钟线时显示错误，不从日线虚构分钟数据。

## 解耦结构

```text
OpenTerminal shell / Workspace / Zustand
  → ChartWidget（交互、查询、状态）
  → web/lib/vela/history.client.ts
  → Next.js /api/vela/history/:symbol
  → web/lib/vela/history.server.ts（数据契约、来源、周期校验）
  → Express /api/vela/history/:symbol
  → server/src/history.ts（上游降级、20 秒缓存、失败旧缓存）
  → Nasdaq / Yahoo / Stooq；Binance / FRED 特定市场

标准 OHLCV → chart-adapter.ts → Vela nativeBackend:auto
Pine 源码 → pine-adapter.ts → PineWorkerEngine → 图表指标
```

股票默认周期保留 Nasdaq → Yahoo → Stooq → 旧缓存链。Nasdaq/Stooq/FRED 的日线不能充当分钟线；需要其他粒度时通过 Yahoo 补充，周/月线可从有效更细数据聚合。加密币和 VIX 使用原有特定来源，没有承诺所有市场都具备多供应商。旧缓存有明确标识，但沿用上游缓存机制，目前没有最大陈旧年龄限制。

### 浏览器端接口

```http
GET /api/vela/history/AAPL?range=6M&timeframe=1D&mode=live
GET /api/vela/history/AAPL?range=6M&timeframe=1D&mode=fixture
```

返回 `{ bars, source, mode, timeframe, attempts }`；bars 格式为 `{ time, open, high, low, close, volume }`，time 为 Unix 毫秒。数据过滤无效 OHLCV、排序、按时间去重；聚合保留首开、最高、最低、末收并累加成交量。非法参数返回 400，真实数据不可用返回 502。

Express 同名接口返回 `{ timestamp, open, high, low, close, volume }[]`，timestamp 也是毫秒，X-Vela-* 响应头提供来源、缓存和尝试记录。它的 fixture 为最小三条契约样本；浏览器端 fixture 生成足够数量的 K 线用于图表和指标演示。

## 测试

```bash
npm test
npm run test:quant
npm run typecheck
npm run build
```

测试涵盖原有服务、降级与缓存、毫秒转换、OHLCV 清洗、粗粒度拒绝、周/月聚合、显式 fixture、接口校验、图表生命周期、Pine 清理及真实 PineTS 数值计算。浏览器验收补充真实渲染和 Worker 执行，不把 mock 测试当作公网数据可用性证明。

## 范围与授权

- Vela 使用 WebGL2 优先的 auto 后端，硬件/浏览器不支持时回退 Canvas2D，因此不能保证每个浏览器都使用 GPU。保留 Vela 可见署名。
- Pine v5/v6 由 PineTS 执行，不是 TradingView 官方引擎，也不承诺任意脚本完全兼容；受保护源码不可读取。本 MVP 未配置跨市场 request.security 的数据提供器或 Pine 库 importResolver。
- OpenTerminal 为 MIT，Vela 核心为 Apache-2.0 并要求遵守 NOTICE；vela-pinets/PineTS 为 AGPL-3.0-only。闭源商用需评估 AGPL 义务或获得商业授权，不能将整体宣称为 MIT。
- 行情、新闻、期权和组合组件保留，但第三方端点可能限流、延迟或失效。期权到期日降级和组合核算沿用上游逻辑，尚未做完整金融正确性审计；不提供实盘下单。
- 当前是本地 demo，不是生产安全加固版本。npm audit 仍可能报告上游依赖问题；已执行不跨主版本的安全修复，未强制升级 Next.js/Zod/Vitest。

来源：https://github.com/ErTasselli/OpenTerminal 、https://github.com/luxalgo/vela 、https://github.com/LuxAlgo/Vela-pinets 。
