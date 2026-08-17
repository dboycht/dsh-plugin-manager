# 备注文件格式 / Notes file format

备注数据保存在应用的**当前工作目录**下：

```
<工作目录>/.dsh-plugin-notes.json
```

例如：

- web / 源码启动：`D:\Toolkit\tkFile\deepseek-harness-master\.dsh-plugin-notes.json`
- 桌面端：`D:\Program New\DeepSeekHarness\DSH Desktop\.dsh-plugin-notes.json`

## 结构 / Schema

```jsonc
{
  "version": 1,            // 格式版本（当前固定 1）
  "notes": {
    "<key>": {
      "note": "备注文本（最长 4000 字符）",
      "updatedAt": "ISO 8601 时间戳"
    }
  }
}
```

## 键约定 / Key conventions

| 类型 | 键 | 示例 |
|---|---|---|
| 部署插件 | Loader entry id | `include:ui-conversation` |
| 动态插件 | pluginId | `plugn-1` |
| 自定义 | 任意字符串 | `my-notes` |

## 读取优先级 / Read fallback order

插件按以下顺序查找备注文件，读到第一个存在的即加载；若来自非当前目录，会自动在当前目录**写一份拷贝**（迁移），保证两边一致：

1. 当前 `sandboxPolicy.workspaceRoot` 下的 `.dsh-plugin-notes.json`
2. 历史工作目录（代码内 `LEGACY_ROOTS` 常量）下的同名文件

## 备份与恢复 / Backup & restore

- 界面「导出备注」或工具 `plugin_manager export` 输出完整 JSON。
- 界面「导入备注」或工具 `plugin_manager import`（`note` 参数放 JSON）覆盖导入。
- 迁移：把旧目录的 `.dsh-plugin-notes.json` 拷到新工作目录即可。
