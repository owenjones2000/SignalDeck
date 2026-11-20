# 默认主图公式实施计划

**目标：** 将用户通达信公式作为两处 K 线图的独立内置主图指标，默认开启、可关闭，与自定义 Pine 共存。不修改行情源、交易或量化策略。

**架构：** 纯 TypeScript 计算器生成七条 MA、双 KDJ、压力支撑与大涨标记；使用 Vela 已安装的公开原生指标及绘制扩展实现，不调用 runPine。ChartAdapter 统一管理生命周期；ChartWidget 和 DailyChart 提供双语开关。

## 公式契约

- Z=5，Y=55。RSV=(C-LLV(L,N))/(HHV(H,N)-LLV(L,N))*100；窗口不足时使用已有历史。零振幅输出未定义并保持平滑的上一有效状态，首次有效 RSV 为 SMA 初值；K=(RSV+2*K_prev)/3，D=(K+2*D_prev)/3，J=3*K-2*D。文档明确无通达信导出数据，初值/零振幅边界仅按当前约定，不声称已逐值对齐通达信。
- CROSS(A,B) 为当前 A>B 且前根 A<=B；缺失任一值不触发。压力取 CROSS(J55,J) 所在根的 H；支撑取 CROSS(J,J55) 所在根的 L，保持最近值，首事件前未定义，无未来数据。
- 七条 MA 使用完整窗口，周期5/10/15/30/50/100/200；颜色依次 #FFFFFF/#00FFFF/#FFFF00/#FF00FF/#FF0000/#FFCC66/#FF6600，按用户颜色字面解析，不额外交换RGB。
- 压力黄色点线、支撑 #00FF00 点线。大涨条件为 (C-C_prev)/C_prev*100>=8.5，前收盘为零或缺失不触发；覆盖 O 到 C 的黄色实心矩形，保留原影线；宽度按当前图表 bar 宽适配而非通达信像素宽度2。
- 图例说明基于当前图表周期；8.5%为相邻bar涨幅，分钟线不称为日涨幅。数据少于200根时提示长均线不足，不自动获取或伪造历史；窗口外压力支撑事件不恢复。

## 文件与步骤

- [ ] 新建 web/lib/vela/main-formula.ts 和测试：先断言递推初值、平盘、交叉相等边界、VALUEWHEN保持、MA199/200边界、8.5%门槛、不同标的数据隔离、前缀无未来数据，再实现纯计算。
- [ ] 新建 web/lib/vela/main-formula-indicator.ts：核对 node_modules/@luxalgo/vela 已安装公开接口，注册独立overlay指标及黄色实体绘制层。测试正确系列/点线/颜色、渲染坐标、缺失不画、开关重复与清理；不能更改node_modules或使用私有接口。
- [ ] 修改 chart-adapter.ts：setMainFormula(boolean)，默认启用；行情变化更新，关闭移除所有图层，销毁释放资源；不移除自定义Pine或其它指标；补adapter测试。
- [ ] 修改 ChartWidget.tsx/DailyChart.tsx 与双语字典及测试：默认开启可关闭，UI反映状态，加载异步不复活已关闭指标，切换证券后重算，增加历史不足说明；不重挂载图表。
- [ ] 新建 docs/main-chart-formula.md：保存公式参数/颜色/计算边界/绘图宽度和验证限制；不提交Git，不新增代码注释，不覆盖用户暂存改动。
- [ ] 验证 npm test、npm run test:quant、npm run typecheck、npm run build、git diff --check；独立审查公式和公开接口；用显式fixture浏览器验收七条均线、点线和黄色实体、开关、缩放及Pine共存。真实行情不可用不以fixture冒充真实验证。
