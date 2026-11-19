# 个人量化工作台接入计划

**目标：** 在本仓库完成 A 股选股、行情监控、策略回测和自动提醒，不修改外部项目，不包含实盘下单。

**架构：** 新增内部 Python FastAPI 服务，负责行情及指标计算；Express 提供认证后的统一入口、SQLite 持久任务和提醒调度；Next.js 提供量化工作台。Python 服务默认监听本机，内部接口不向浏览器暴露。通知凭据通过服务端环境变量配置，不写入业务表或浏览器。

**技术栈：** 现有 Next.js、Express、better-sqlite3、Vitest；新增 FastAPI、pandas、NumPy、AKShare、pytest。

## 统一接口

内部 Python API：GET /health、GET /formulas、GET /strategies、POST /quotes {codes}、POST /history {code,count}、POST /screen {formula,codes,count}、POST /backtest {code,strategy,count,init_capital,position_pct,commission,stamp_tax}、POST /signals {codes}。

所有行情使用六位 A 股代码；日线日期为 YYYY-MM-DD，复权明确标注 qfq；报价携带 source、as_of、stale。历史返回 {code,source,adjustment,bars:[{date,open,high,low,close,volume}]}。选股返回 {hits,failures}；信号返回 {signals:[{code,key,name,type,date,price}],failures}。API 错误使用 {error}；不伪造行情，不以空结果掩盖供应商失败。

Express /api/quant：GET /status、/formulas、/strategies、/watchlist、/quotes、/history/:code、/jobs、/jobs/:id、/alerts、/notifications；POST /watchlist {code}、/jobs {kind:screen|backtest,params}、/alerts {name,codes,signal,enabled,interval_minutes,channel:local|feishu|email}、/alerts/:id/test；DELETE /watchlist/:code、/alerts/:id；PATCH /alerts/:id {enabled}。列表均返回数组，状态返回服务可用性和通知渠道配置布尔值。任务返回 {id,kind,status,params,result,error,created_at,updated_at}；状态 queued/running/completed/failed，单任务执行，重启时中断任务明确失败。提醒事件与投递分离存储，重试不产生新事件。

## 分步执行

- [ ] Python 服务：先编写指标、成交时序、费用、参数和数据校验的失败测试，再实现四个选股公式、五种策略及三种信号；只复用许可证允许的算法，采用确定性行情夹具测试。
- [ ] Python 数据层：新增 AKShare 适配、可选长桥适配、有限缓存、充足历史检查；每标的异常保留原因；提供依赖、内部启动命令和健康检查。
- [ ] Express：先用注入的计算客户端和临时 SQLite 测试任务、持久化、提醒去重和重试，再实现 API、单 worker 和独立调度器；全部接口沿用现有 API key 保护。
- [ ] 工作台：新增独立量化面板入口，涵盖自选管理、报价、日线图、选股任务、回测参数及结果、提醒启停和投递历史；页面关闭不影响任务；明确离线、空结果和失败状态。
- [ ] 统一启动：增加 setup:quant、dev:quant、dev:all 与 Compose 服务，保留原 npm dev 行为；Python 容器仅内部可达；编写中文部署与渠道环境变量说明。
- [ ] 验证：运行 pytest、npm test、npm run typecheck、npm run build；启动服务并检查认证后的接口及浏览器四项交互；真实数据服务不可用时如实显示失败，不声称公网行情已验证。

## 验收限制

仅单用户、A 股、有限指定股票池和预置策略；提醒默认本地历史，可选飞书和邮件。交易时段使用 Asia/Shanghai，自动扫描须按交易日历判断；交易日历不可用时暂停自动扫描并显示原因，手动测试不受交易时段限制。策略只做多、单笔持仓、次日开盘成交、100 股整数倍，明确缺少滑点及涨跌停撮合模型。不得复制外部配置和凭据，不提交 Git，不恢复用户删除的 .claude/launch.json。
