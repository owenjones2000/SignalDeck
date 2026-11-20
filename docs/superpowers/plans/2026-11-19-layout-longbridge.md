# 布局与长桥订阅实施计划

**目标：** 增加侧栏折叠、仅剩单图时自动铺满、中英切换及指定证券长桥报价订阅。不绑定默认市场，不扩展量化回测市场，不修改外部项目。

**架构：** 页面布局使用临时派生尺寸，保留持久网格。长桥由 Python 内部服务持有共享 QuoteContext，使用 SSE 将报价传至 Express，再经 Next 专用流式路由送至浏览器。凭据留在服务器，不出现在 URL、响应、日志或前端包。

**技术栈：** 现有 React、Zustand、FastAPI、Express；可选 longbridge 5 SDK；浏览器 EventSource。

## 契约

Python GET /longbridge/status 返回 {configured,available,source:"longbridge",error}，未配置不创建SDK连接。GET /longbridge/stream?symbols=AAPL.US,700.HK,600000.SH 返回 text/event-stream，事件 ready、quote、error、heartbeat。quote 数据为 {symbol,price,open,high,low,volume,turnover,timestamp,source:"longbridge"}；timestamp为ISO UTC，数值有限或null，不伪造实时等级。最多20个证券，支持明确.US/.HK/.SH/.SZ后缀，不把未验证北交所映射为深圳。连接终止须释放全部订阅引用。Quote事件为最新值，不无界积压。

Express GET /api/longbridge/status 和 /api/longbridge/stream，沿用requireApiKey；流接入前验证symbols，超过连接额度返回429。取消浏览器连接时中止内部流。Next web/app/api/longbridge/stream/route.ts 为专用同源流式代理，在服务器注入API key，仅允许同源请求；不经过现有缓冲catch-all代理。状态接口可走catch-all。禁止把key放到查询字符串。

新面板type为longbridge，提供代码输入、订阅/取消、连接状态、最新报价及来源时间；断线有退避重连，卸载取消，未配置明确显示，不影响其它行情。此轮Quote推送不冒充历史K线；原量化历史复权口径不改。

## 执行任务

- [ ] 布局：测试侧栏开关、单chart临时铺满、多chart/无chart不重排、新增退出临时模式和旧布局不被覆盖；再修改Terminal/Sidebar/Workspace并补resize验证。
- [ ] 国际化：新增轻量类型化字典与持久化locale；翻译外壳、图表控件、普通面板及量化操作/状态/空态，未知上游错误保留原文；同步html lang，不以译文驱动逻辑；补中英切换测试。
- [ ] 长桥内部服务：核对外部lb_quote.py与realtime.py及SDK接口，只复用有权业务逻辑；通过注入假SDK测试首订末退、失败回滚、并发、队列合并、断开清理和生命周期，再实现真实SDK工厂。可选依赖不破坏未配置启动，应用关闭集中退订，不假设SDK存在close方法。
- [ ] 流式网关：使用假内部SSE测试认证、symbols约束、错误状态传递、逐块转发和断开中止；实现限流、超时与关闭流管理，再接入longbridge面板和前端重连测试。
- [ ] 运维：更新.env.example变量 LONGPORT_APP_KEY/LONGPORT_APP_SECRET/LONGPORT_ACCESS_TOKEN，实际工厂必须按所用SDK已验证接口映射；增加setup:longbridge可选安装脚本，Compose按可选依赖配置；docs内补使用、许可和权限限制说明。
- [ ] 验收：npm test、npm run test:quant、npm run typecheck、npm run build、git diff --check；浏览器验证折叠、单图铺满、语言切换、未配置订阅状态。无凭据时只能验收mock及未配置路径，不能声称实际长桥行情通过。不提交Git。
