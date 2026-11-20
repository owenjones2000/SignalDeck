# 长桥行情：安装、部署与许可

## 本地使用

在项目根目录执行 `npm run setup:longbridge`。该命令创建或复用 quant 的虚拟环境，先安装锁定的基础依赖、以 `--no-deps` 安装本地 quant 包，再以 `--no-deps` 安装 `longbridge==5.4.0`。5.4.0 的 Python 包没有声明运行时 Python 依赖；固定版本避免自动升级后接口漂移。任一步失败立即停止，并返回子进程退出码。可通过 `PYTHON` 指定符合项目要求的解释器。

`npm run setup:quant` 保持原行为，不额外安装 SDK；它也不会卸载已安装的 SDK。现有可选依赖声明允许 `longbridge>=5.4,<6`，但本项目的运维安装和容器构建固定到已核实的 5.4.0；手动安装其他版本需要重新验证接口契约。

仅在服务器环境配置以下三个变量，值来自你自己的 OpenAPI 应用及授权：

```dotenv
LONGPORT_APP_KEY=
LONGPORT_APP_SECRET=
LONGPORT_ACCESS_TOKEN=
```

根目录的 `.env.example` 只提供空值模板。按需复制并填入本地私密环境文件，勿提交、打印或共享这些值。`npm run dev:quant` 和 `npm run dev:all` 会按现有脚本加载根目录 `.env`、`.env.local`。安装命令不加载这两个文件。非开发部署必须由进程管理器注入环境，不能假设 Python 自动读取 dotenv。

启动服务后，在长桥面板输入明确证券后缀，例如 `AAPL.US`、`700.HK`、`600000.SH`、`000001.SZ`，订阅或取消报价。单次最多 20 个证券；面板提供报价推送，不提供历史 K 线或交易能力，也不改变原有量化业务市场范围。

## Compose 部署

默认 `INSTALL_LONGBRIDGE=false`，quant 镜像不安装 SDK。开关只控制构建，不代表已经配置凭据或具备行情权限。接受 `true`、`1`、`false`、`0`，其他值使构建失败，避免拼写错误被静默忽略。

启用时在本机私密环境文件设置 `INSTALL_LONGBRIDGE=true`，或执行：

```bash
INSTALL_LONGBRIDGE=true docker compose up -d --build
```

Compose 将三项 `LONGPORT_*` 以空值为默认值，仅注入 quant 的运行环境，不传给 api/web、不作为构建参数，不写入镜像层。不要把它们配置成 `NEXT_PUBLIC_*` 或 URL 参数。能访问 Docker daemon 的管理员仍可查看容器环境，需限制主机权限；不要分享包含真实值的 `docker compose config` 输出。

修改开关后必须重建并重建容器；单纯 `restart` 不会安装或卸载 SDK。关闭开关后同样执行带 `--build` 的 `up`，新镜像不包含 SDK。凭据修改需要重新创建容器。quant 仍不发布主机端口，api/web 保持现有本机绑定和认证设置。

## SDK 5.4.0 契约与排查

使用的是 PyPI 包 `longbridge`、导入路径 `longbridge.openapi`。应用显式将环境变量映射到实际 SDK 工厂，不依赖 `Config.from_env()` 对 `LONGPORT_*` 命名的支持：

| 环境变量 | `Config.from_apikey` 参数 |
| --- | --- |
| `LONGPORT_APP_KEY` | `app_key` |
| `LONGPORT_APP_SECRET` | `app_secret` |
| `LONGPORT_ACCESS_TOKEN` | `access_token` |

工厂同时设置 `enable_print_quote_packages=False`。订阅使用 `QuoteContext.subscribe(symbols, [SubType.Quote])`，取消使用 `unsubscribe(symbols, [SubType.Quote])`，回调通过 `set_on_quote(callback)` 注册，签名为 `(symbol, event)`。不假设 SDK 提供 `close()`。这份说明描述既有适配器，本次仅修改运维文件。

三项凭据任一为空时状态为 `not_configured`，不创建连接；全部存在但未安装 SDK 时为 `sdk_unavailable`。已配置且安装 SDK 时的 `available` 仅表示本地配置和 SDK 检查通过，并不证明远程授权、网络或实时行情可用。连接和订阅失败会报告 `connection_failed`、`subscription_failed`，需核对网络、令牌有效期及账户行情权限，不要在日志或工单里附凭据。

未配置验证可检查 `/api/longbridge/status`；该接口沿用 API 认证，浏览器经现有同源代理访问。契约测试可以直接运行 `npm run test:quant`；没有 SDK 时真实签名测试会跳过，不能据此宣称 SDK 契约验证成功。运维测试使用 `node --test scripts/*.test.mjs`，只读取示例与配置、使用临时假凭据/进程边界，不加载私密环境文件。

本次在安装了 5.4.0 的本地环境验证接口签名及无网络测试，不创建真实 `QuoteContext`，不验证实际行情。本机没有 Docker CLI，不能执行 Compose 原生解析、镜像构建、Linux wheel 安装及容器健康检查；YAML 解析和构建 shell 分支测试不能替代这些检查。具备 Docker 的环境应先使用空环境文件、假值及 `docker compose --env-file /dev/null config --quiet`，分别构建关闭和开启 SDK 的 quant 镜像，再以空凭据确认健康状态及 `not_configured`。

## 许可与行情权限

本项目采用根目录 `LICENSE` 的 MIT 许可；SDK 的许可独立于本项目。SDK 5.4.0 上游 Python 包声明 `MIT OR Apache-2.0`，本项目选择 MIT 分支随镜像分发 SDK，不将本项目许可证当作 SDK 的许可证。

已在 `docs/licenses/longbridge-MIT.txt` 保留上游 MIT 全文，并复制至 quant 镜像 `/usr/share/licenses/longbridge/LICENSE-MIT`。上游这份文件没有单独的版权署名行，保留原文，不编造署名；其他第三方依赖的许可义务仍需单独履行。分发镜像或包含 SDK 的软件时，应保留许可及适用的版权通知；选择 Apache-2.0 分支时需自行满足该分支义务。

开源 SDK 的代码许可不授予交易所数据使用或再分发权限。行情等级、延迟、市场覆盖及订阅额度由账户授权、地区、交易所和服务条款决定。不要将所有推送标为实时，也不要据此承诺沪深等市场可访问；对外展示、商用或转发行情前需取得相应许可。本次不复制外部业务代码，不读取凭据，不验证真实行情授权。

上游版本来源：

- Python 5.4.0 包信息：https://pypi.org/project/longbridge/5.4.0/
- Python SDK 许可声明：https://github.com/longbridge/openapi/blob/v5.4.0/python/Cargo.toml
- MIT 全文：https://github.com/longbridge/openapi/blob/v5.4.0/LICENSE-MIT
- 官方 OpenAPI 文档：https://open.longbridge.com/en/docs
