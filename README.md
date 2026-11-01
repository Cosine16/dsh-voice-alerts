# DeepSeek Harness voice alerts

Windows 离线人声提示插件 v0.2.0，包含 26 条短句，独立安装到现有 DeepSeek Harness Desktop，无需构建 Harness 源码。针对本机 `0.2.1-rc.5` 验证；本包限制在 `>=0.2.1-rc.5 <0.2.2`，升级 Harness 后请重新验证事件兼容性。

## 播报

| 状态 | 短句 |
|---|---|
| 授权请求等待超过 1 秒 | Authorization required. |
| 请求原因包含 sudo、管理员、提权等 | Elevated privileges required. |
| 请求原因包含敏感文件、凭据、私钥等 | Sensitive file access requested. |
| agent 或模型请求错误 | Error detected. |
| 模型请求报告 TRANSPORT 等连接错误 | Connection lost. |
| 子 agent 开始执行（含重新启动的执行） | Subagent deployed. |
| 子 agent 正常完成 | Subagent task complete. |
| 主 agent 的一轮任务正常结束（没有活动中的长期目标） | Task complete. |
| 等待用户回答问题 | Awaiting your instructions. |
| 授权拒绝 | Access denied. |
| 没有可用授权通道 | Authorization unavailable. |
| 模型请求超时 | Request timed out. |
| 模型 API 身份验证失败（401 等明确认证错误） | Authentication failed. |
| 模型 API 限流（429 等明确限流错误） | Rate limit reached. |
| 重试策略已记录重试决定 | Retrying request. |
| 已播报的连接故障后，模型成功返回消息 | Connection restored. |
| 已播报的其他请求故障后，模型成功返回消息 | Request recovered. |
| 子 agent 失败 | Subagent failed. |
| 用户主动取消／子 agent 取消，默认关闭 | Task cancelled. |
| 主 agent 被父任务、hook 或释放流程停止 | Task stopped. |
| 输出达到 token 上限 | Token limit reached. |
| 回合受阻 | Task blocked. |
| 长期目标被标记为受阻 | Objective blocked. |
| 长期目标被标记为完成 | Objective complete. |
| 上下文压缩最终失败 | Context compression failed. |
| 工具最终结果失败 | Tool execution failed. |

Microsoft Zira 本地合成女声，加轻度无线电滤波与双音提示。不是游戏原版录音。所有 WAV 已生成，日常使用不需要联网、TTS 服务或 API 密钥。声音只包含上表固定短句，不读出命令、路径、文件内容或模型输出。

## 安装、卸载

已配置 `dsh` 命令的 Windows 机器可直接从 GitHub 安装固定版本，无需构建：

```powershell
dsh plugin --profile desktop add 'github:Cosine16/dsh-voice-alerts#v0.2.0' --registry=https://registry.npmjs.org
```

若希望修改源码和音频，可克隆本仓库，然后用 `dsh plugin --profile desktop add <本地目录>` 链接安装。以下命令展示本机已有的链接安装路径。

PowerShell（安装路径不同请相应修改）：

```powershell
& 'D:\Program\deepseekharness-desktop\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'D:/_share/dsh-voice-alerts' --offline --registry=https://registry.npmjs.org
```

这是链接安装，需保留本目录。关闭并重新打开 DeepSeek Harness 后生效；若桌面宿主已自动重载配置则无需重启。安装不修改 exe 或 app.asar。默认不安装到 headless profile。

```powershell
& 'D:\Program\deepseekharness-desktop\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop remove dsh-voice-alerts --offline --registry=https://registry.npmjs.org
```

安装会使用 Harness 自带的插件管理器。需要分发时运行 `npm pack`，将生成的 `.tgz` 文件通过 `dsh plugin --profile desktop add <路径>` 安装。

上面的离线命令适用于本机已缓存依赖；全新机器缺缓存时去掉 `--offline`。指定官方注册表是为了避免默认镜像的旧缓存找不到已安装的 Codex `0.2.1-rc.5`，不会修改全局 npm 注册表配置。

## 配置与试听

编辑本目录的 `settings.json` 并重启 Harness：`enabled` 为总开关，`volume` 为 0–100，`events` 可分别开关各类提示，`cooldownMs` 控制同一会话同类提示冷却时间，`approvalDelayMs` 过滤很快被回答的请求。队列上限为 `maxQueue`，授权和错误提示排在尚未播放的完成提示前面。正在播放的短句不会被新提示打断。

`maxAlertAgeMs` 默认 30000，排队超过这个时间的提示会丢弃。`errorCoalesceMs` 默认 250，用于等待同一故障的具体结果，避免泛化错误抢先重复播报。播放器失败后清空队列并暂停 `playbackFailureCooldownMs`（默认 30000）毫秒，然后在新事件到达时重新尝试；不会重放旧警报。音量为 0 时不启动播放器。用户主动取消默认静默，需要时启用 `events.taskCancelled`。

```powershell
powershell.exe -NoProfile -File D:\_share\dsh-voice-alerts\scripts\play.ps1 -AudioPath D:\_share\dsh-voice-alerts\audio\taskComplete.wav -Volume 75
```

可用同名的 16-bit PCM WAV 替换 `audio` 文件。重新生成全部语音：

```powershell
node .\scripts\export-phrases.mjs
powershell.exe -NoProfile -File .\scripts\generate-audio.ps1
node .\scripts\radio-effect.mjs
```

滤波脚本仅在重新生成后执行一次，避免反复叠加效果。

## 事件与边界

- 监听 Cordis 的 `approval/request`、`user-questions/request`、`agent/request-error`、`agent/error`、`tools/result`、`subagent/start`、`subagent/end` 和 `session/event`。Waterfall 监听立即调用 `next()`，不代替用户回答，不更改权限和重试策略。
- sudo／管理员及敏感访问分类只根据授权请求的原因文本，不能观察系统 UAC 对话框、终端内密码提示或所有文件访问。没有授权事件时不会猜测。
- 自动审批若在延迟窗口内完成则不播报；耗时较长的自动审批仍可能被当作等待授权。
- Connection lost 指模型请求的连接错误，不代表实时监测整机网络，也不覆盖桌面 UI 与宿主之间的所有断线。超时、HTTP 401、429 分别提示；HTTP 403 不一定是身份验证问题，保留为普通错误。
- 重试提示依据 `llm/retry`，表示策略已经决定重试，包括等待退避时间；同一连续故障只提示一次。恢复依据成功提交的 `assistant/message`，不把开始连接、收到失败尝试或单轮结束当作恢复。尚未开始播放就恢复的警报及其恢复提示都会被抑制。
- Task complete 表示主 agent 一轮正常结束；活动中的 goal 不逐轮播报完成。Objective complete 和 Objective blocked 根据 `goal/change` 的明确状态，加载历史 goal 不会重播旧提示。模型标记完成不等于插件独立验证了结果。
- 工具失败按 `rootCallId` 合并嵌套执行；同一执行树的外层成功恢复时，尚未播放的错误会撤回。授权被拒绝后的对应工具失败不重复播报。子 agent 已播报的请求错误不会在终止时再播同一故障。无法从结构化事件关联的不同执行仍按同类提示冷却限制频率。
- 上下文压缩使用 `compaction/end.error`，只播最终失败，不把已被恢复的中间摘要错误当作最终失败。后续压缩成功会撤回尚未播放的压缩错误。
- 音频在 Harness 宿主所在的 Windows 机器播放。关闭插件会移除监听器、取消计时器和播放进程。播放器失败只记录警告，不中断 agent。
- 本插件无法在自己的模块加载失败、宿主进程崩溃或音频设备不可用时可靠地发出人声，也未安装外部守护进程。加载错误与播放错误由 Harness 日志报告。这些情况和系统 UAC／终端密码提示不属于已覆盖的语音事件。

## 验证

`node --test` 运行授权继续传递、取消、去重、优先级、队列上限、过期丢弃、故障冷却、请求恢复、工具关联、目标状态和子 agent 分类测试。

`scripts/smoke-installed.cjs` 使用已安装桌面版自带的 Cordis 验证插件加载、事件、授权结果保留及卸载。运行方式：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& 'D:\Program\deepseekharness-desktop\DeepSeek Harness.exe' --expose-internals .\scripts\smoke-installed.cjs D:\Program\deepseekharness-desktop | Out-String
Remove-Item Env:\ELECTRON_RUN_AS_NODE
```

无需启动真实模型任务或消耗模型 API 额度。
