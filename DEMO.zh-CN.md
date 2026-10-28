# OpenTerminal × Vela 最小可用工作站

本项目基于 ErTasselli/OpenTerminal，保留其 Next.js / React 工作区、Express 多源数据服务和 SQLite 组合追踪，将主图表组件替换为 LuxAlgo Vela 0.9 和 PineTS Worker。上游许可证保留在 LICENSE；没有重新实现一套外观相似但功能缺失的外壳。

## 启动

建议使用 Node.js 22 或更新版本，以及 npm。当前环境验证版本为 Node.js 26.8.1、npm 11.19.0。

```bash
cd /Users/zhongxin/openterminal-vela-demo
npm ci
npm run dev
```

打开 http://localhost:3000；Express 默认仅监听 127.0.0.1:4000。本地组合 API 密钥会生成到 data/.api-key，由 Next.js 服务端读取，不向浏览器暴露。没有付费行情密钥也能启动；公网数据是否可用取决于供应商及网络环境。

生产模式：

```bash
npm run build
npm start
```

不要在同一目录同时运行 next dev 和 next build，两者会共用 .next。端口冲突时分别设置 API_PORT、API_URL 和 Next.js 的 -p 参数。

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
