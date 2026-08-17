# 动态安装参考 / Dynamic install reference

`lib/` 是本插件的**永久安装**形态（写入 profile 组合，开机自启）。

如果你只想**快速试用**（进程内临时），可以让 DeepSeek Harness 的代理（agent）用
`cordis_define` / `cordis_run` 创建一个动态 Cordis 插件，功能等价：

- Host 半部：枚举 loader 插件 + 动态插件清单、备注读写/导出/导入、动态插件启停、注册 `plugin_manager` 工具。
- Client 半部：设置 → 插件 → 「备注」标签页。

直接把本仓库 README 或 `lib/` 的功能描述发给代理，它会生成对应的动态包代码。
**注意**：动态插件随进程重启消失（进程内注册表），但备注数据文件始终保留在磁盘。

This folder documents the optional quick-try path; the permanent form is `lib/`.
