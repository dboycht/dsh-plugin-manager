# dsh-plugin-manager

DeepSeek Harness 插件管理 —— 列出全部插件、维护持久化的备注、导出/导入备份、启停动态插件。

Plugin manager for DeepSeek Harness: list every plugin, keep durable per-plugin notes, export/import backups, and start/stop dynamic plugins.

## 功能 / Features

- **插件清单**：枚举全部**部署插件**（Cordis Loader，含启用状态与运行阶段）和全部**动态 Cordis 插件**（含包名、用途、运行状态）。
- **一键禁用/启用部署插件**：设置页每个部署插件行都有「禁用 / 启用」开关（模型工具用 `toggle-deployment`），点击写入当前 profile 的 `cordis.patch.yml`（`disabled: true|false`），利用 Loader 的按 id 合并语义与 patch 热重载**即时生效，无需重启**。
- **备注管理**：为每个插件添加/编辑/删除备注，持久化到 `<工作目录>/.dsh-plugin-notes.json`（UTF-8，重启不丢；支持历史位置回退读取 + 自动迁移）。
- **导出 / 导入**：一键备份/恢复全部备注（JSON）。
- **筛选**：按关键字 + 状态（运行中 / 已启用 / 禁用或已停止 / 失败 / 有备注）过滤。
- **动态插件启停**：对动态 Cordis 插件一键启动/停止。
- **总开关**：一键停用/启用整个插件管理（状态持久化；停用后所有写操作被拒绝，重新启用即恢复）。
- **模型工具**：注册 `plugin_manager` 工具，代理可直接在对话中读写备注与启停插件（`list/get/set/remove/export/import/start/stop/toggle-deployment/enable/disable`）。
- **设置页**：设置 → 插件 → 「备注」标签页。

## 安装 / Installation

### 方式 A：永久安装（推荐，开机自启，重启不丢）

以 `dsh web` 的 web profile 为例（其他 profile 同理）：

1. 把本仓库放到任意位置（或直接 link 本地目录），例如 `D:\code\DeepSeekHarness\PluginWork\dsh-plugin-manager`。
2. 编辑 profile 的 `package.json`（如 `C:\Users\micak\.dsh\profiles\web\package.json`）：

   ```jsonc
   {
     "dependencies": {
       "@dsh-external/dsh-plugin-manager": "link:D:/code/DeepSeekHarness/PluginWork/dsh-plugin-manager"
     },
     "dsh": {
       "profile": {
         "bundles": [
           // ...原有 bundles...
           "@dsh-external/dsh-plugin-manager"
         ]
       }
     }
   }
   ```

3. 在 profile 目录执行 `pnpm install`（link 依赖，本地即可，无需网络）。
4. 重启应用（`pnpm dsh web` / 桌面端）。包的 `cordis.patch.yml` 会自动插入插件行；客户端入口由 `dsh.client` 声明自动扫描打包。

也可手动在 profile 的 `cordis.patch.yml` 加一行：

```yaml
- insert:
    - id: plugin-manager
      name: '@dsh-external/dsh-plugin-manager'
```

### 方式 B：动态插件（进程内临时，重启后需重建）

让代理（agent）把 `dynamic/` 参考代码或下述能力通过 `cordis_define` 创建并 `cordis_run` 运行。动态插件适合快速试用；**注意**：动态插件随进程重启消失，备注数据仍在文件中。

## 使用 / Usage

- **界面**：设置 → 插件 → 「备注」。每个插件一行：备注文本框 + 保存 / 删除备注；**部署插件还有 禁用 / 启用 开关**（写入 profile patch，热重载即时生效）；动态插件还有 启动 / 停止 按钮。
- **对话**：直接对代理说「给 XX 插件加个备注」「导出我的插件备注」「禁用 XX 插件」「启用 XX 插件」，代理会调用 `plugin_manager` 工具。

## 备注文件格式 / Notes file format

`<工作目录>/.dsh-plugin-notes.json`：

```json
{
  "version": 1,
  "notes": {
    "include:ui-conversation": {
      "note": "对话界面插件",
      "updatedAt": "2026-08-17T13:27:53.640Z"
    }
  }
}
```

键约定：部署插件用 loader entry id（如 `include:ui-conversation`），动态插件用 `pluginId`（如 `plugn-1`），也可自定义任意字符串。详见 [docs/NOTES_FORMAT.md](docs/NOTES_FORMAT.md)。

## API（Host 内部，供设置页调用）

同源 JSON API，前缀 `/_dsh/plugin-manager`：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/list` | 插件清单 + 备注 |
| GET | `/export` | 导出全部备注 |
| POST | `/save` | 保存备注 `{key, note}` |
| POST | `/remove` | 删除备注 `{key}` |
| POST | `/import` | 导入备注 `{json}`（覆盖） |
| POST | `/set-deployment` | 禁用/启用部署插件 `{id, enabled}`（写 profile patch，热重载生效） |
| POST | `/stop` | 停止动态插件 `{pluginId, agentId}` |
| POST | `/start` | 启动动态插件 `{pluginId, agentId, packageId}` |
| POST | `/enable` | 启停插件管理 `{enabled: true/false}` |

### 部署插件禁用/启用原理

Loader 按 id 逐字段合并 patch（`applyEntryPatches`：`target[key] = value`），所以只需在 profile 的 `cordis.patch.yml` 写入：

```yaml
- id: <entryId>
  disabled: true
```

即可让该插件行 `disabled: true` 而不影响 bundle 层提供的 `name` / `config`。DSH 的 `watchUserPatches` 监视 patch 文件变化并热重载，因此**保存即生效，无需重启**。本插件定位当前 profile 的 patch 文件（优先 `ctx.baseUrl` 推断的 profile 目录，回退 `$DSH_HOME/cordis.patch.yml`），以**行级编辑**只改动目标行的 `disabled` 字段，其余内容（含 `!!js` 表达式）逐字节保留。

## 卸载 / Uninstall

- 永久版：从 profile 的 `package.json`（dependencies + bundles）移除并 `pnpm install`，或删除 `cordis.patch.yml` 中手动插入的行，然后重启。
- 备注数据文件保留，可随时删除。

## 开发说明 / Notes for developers

- 纯 JavaScript（ESM），无构建步骤：Host 入口 `lib/index.js`，Client 入口 `lib/client.js`。
- Client 使用 `React.createElement`（无 JSX），样式用主题 CSS 变量。
- Host 经 `ctx.tools.register(defineTool(...))` 注册模型工具，经 `ctx.webServer.register(...)` 暴露 JSON API。
- 请先阅读 [DeepSeek Harness 动态插件开发技能](https://github.com/deepseek-ai/DeepSeekHarness) 了解 Cordis 插件模型。

## License

[MIT](LICENSE)
