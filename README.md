# dsh-rotate-status-text

一个通用的 DSH web 客户端插件，让聊天的运行状态行在一组配置的文案之间轮换。插件**自身不附带任何文案**——所有字符串都来自配置，语言 ID 由配置决定，数量不限。

## 作用

聊天的运行状态行通过 `chat.deepDiving` / `chat.deepDivingFor`（以及 `message.turnProcess.deepDivingFor`）渲染文案。框架用 `ctx.locale.bind(ns)` 构造 `t`，这个绑定函数在调用时解析 `this.translate(ns, key, params)`。本插件遮蔽（shadow）locale 服务的 `translate` 方法，从而把这些键替换成配置的文案，其余所有键原样透传。

`phrases` 按语言 ID 索引。渲染时用当前 DSH active 语言选取对应词表：先精确匹配完整 ID，再匹配主语言子标签（如 `en-US` → `en`），最后取第一组。切换语言无需重启。

文案按真实时间窗口轮换：在同一个 `intervalMs` 窗口内，每次重渲染都显示同一句，到下一个窗口才切换到下一句，避免在每秒重渲染的行上造成闪烁。

覆盖用的 `translate` 在 effect 内安装，并在其清理函数中还原。移除配置行或停用插件就会放回原方法——不写文件、不保存用户设置、不留残余。

## 配置

```yaml
- insert:
    - id: dsh-rotate-status-text
      name: 'dsh-rotate-status-text'
      config:
        pack:
          intervalMs: 8000
          phrases:
            zh:
              - 正在展开海图，研判航路…
              - 正在校准罗盘，锁定航向…
            en:
              - Charting the course…
              - Aligning the compass…
```

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `pack.phrases` | `{ 语言ID: string[] }` | 必填 | 每种语言的候选文案，按时间窗口依次选中 |
| `pack.intervalMs` | `number` | `8000` | 窗口时长（毫秒），最小 100 |

新增语言只需在 `phrases` 里加一个键——代码不写死任何语言。旧的 `string[]` 写法仍兼容，会被当作单一未命名词表。

文案可以包含 `{duration}` 占位符，会被框架提供的时长替换；不含占位符的文案按原样使用。

把 `pack` 设为 `false`（或省略）时，DSH 自带文案保持不变。

`config.pack` 声明为 `volatile()`：插件不持有任何持久的用户设置，也从不把配置写回。

## 设计说明

- **通用内核，内容归配置。** 插件不含任何专属措辞，示例文案仅作演示。
- **在 translate 层覆盖，而非词典。** 配置里的 locale 词典触及不到运行状态组件自身的 `t` 绑定；只有在服务层覆盖 `translate`，才能让文案真正渲染出来。
- **干净的生命周期。** 包装函数在 `ctx.effect` 中安装，并在清理时（或 `pack` 变化时）还原，编辑配置不会留下失效的覆盖。

## 安装

```powershell
dsh plugin --profile desktop add dsh-rotate-status-text
```

## 许可

MIT
