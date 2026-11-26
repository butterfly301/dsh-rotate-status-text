# dsh-rotate-status-text

一个通用的 DSH web 客户端插件，让聊天的运行状态行在一组配置的文案之间轮换。插件**自身不附带任何文案**——所有字符串都来自配置，语言 ID 由配置决定，数量不限。

此包是 [`dsh-pirate-mode`](https://github.com/butterfly301/dsh-pirate-mode) 的组件，也可以单独安装使用。

## 作用

聊天的运行状态行通过 `chat.deepDiving` / `chat.deepDivingFor`（以及 `message.turnProcess.deepDivingFor`）渲染文案。框架用 `ctx.locale.bind(ns)` 构造 `t`，这个绑定函数在调用时解析 `this.translate(ns, key, params)`。本插件遮蔽（shadow） locale 服务的 `translate` 方法，从而把这些键替换成配置的文案，其余所有键原样透传。

`phrases` 按语言 ID 索引。渲染时用当前 DSH active 语言选取对应词表：先精确匹配完整 ID，再匹配主语言子标签（如 `en-US` → `en`），接着回退到英语（`en` / `en-*`），最后才取第一组。切换语言无需重启。

除在 `cordis.patch.yml` 中配置外，插件也在 DSH 设置侧栏提供「状态短句轮换 / Status phrase rotation」独立设置页，可在线增删语种、编辑三段与摇晃短句、调整间隔与阈值，以及配置三段状态颜色。

文案按真实时间窗口轮换：在同一个 `intervalMs` 窗口内，每次重渲染都显示同一句，到下一个窗口才切换到下一句，避免在每秒重渲染的行上造成闪烁。

每个语言的词表可以再按回合进行时长分三段：`start`、`progress`、`long`。分段依据是当前回合已经跑了多少秒，跟 token 数无关。

覆盖用的 `translate` 在 effect 内安装，并在其清理函数中还原。移除配置行或停用插件就会放回原方法——不写文件、不保存用户设置、不留残余。

## 配置

```yaml
- insert:
    - id: dsh-rotate-status-text
      name: 'dsh-rotate-status-text'
      config:
        pack:
          intervalMs: 8000
          thresholds: [30, 60]
          phrases:
            zh:
              start:
                - 正在展开海图，研判航路…
                - 正在校准罗盘，锁定航向…
              progress:
                - 正在满帆追击…
              long:
                - 正在深潜，别催…
            en:
              start:
                - Charting the course…
              progress:
                - Making way…
              long:
                - Still diving…
          shakePhrases:
            zh:
              - 船长，再摇桅杆要断了
          stageColors:
            light:
              start: '#0284c7'
              progress: '#1d4ed8'
              long: '#ea580c'
            dark:
              start: '#38bdf8'
              progress: '#60a5fa'
              long: '#fb923c'
```

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `pack.phrases` | `{ 语言ID: string[] }` 或 `{ 语言ID: { start, progress, long } }` | 必填 | 每种语言的分段候选文案，段内按时间窗口依次选中 |
| `pack.intervalMs` | `number` | `8000` | 窗口时长（毫秒），最小 100 |
| `pack.thresholds` | `[number, number]` | `[30, 60]` | 两段分界，单位秒；必须是整数，第一个大于 0，第二个大于第一个 |
| `pack.shakePhrases` | `{ 语言ID: string[] }` | `{}` | 窗口被摇晃时临时顶替的文案 |
| `pack.stageColors` | `false` 或 `{ light, dark }` | `{}` 即启用默认配色 | 三段的状态文字颜色；写 `false` 关闭着色 |

新增语言只需在 `phrases` 里加一个键——代码不写死任何语言。旧的 `string[]` 写法仍兼容，会被当作 `progress` 段，所以老配置不用改。

文案可以包含 `{duration}` 占位符，会被框架提供的时长替换；不含占位符的文案按原样使用。

把 `pack` 设为 `false`（或省略）时，DSH 自带文案保持不变。

`config.pack` 声明为 `volatile()`：插件不持有任何持久的用户设置，也从不把配置写回。

## 分段

回合开始时插件记下起始时刻，之后的渲染按已经过去的秒数选段：

- 小于 `thresholds[0]` 秒走 `start`。
- 小于 `thresholds[1]` 秒走 `progress`。
- 再往后走 `long`。

某一段没有配置文案时，依次回退到 `progress`、`start`、`long`，所以只写一段也能用。跨段的切换等到下一个 `intervalMs` 窗口才生效，避免在一句话中间跳变。

起始时刻从宿主取。宿主端在 `/rotate-status-text/turn-state?sessionId=<id>` 返回当前会话的 `{ ok, sessionId, turnOpen, turnStartAt }`；客户端在回合进行中每 2 秒查一次，回合结束后停止。宿主接口不可用时，第一次看到状态行的时间当作起点。

## 临时覆盖

其他插件可以往 `window` 上派发事件，临时改写状态文案，不必改配置：

```js
window.dispatchEvent(new CustomEvent('dsh:status-text:override', {
  detail: {
    text: { zh: ['正在处理你的请求…'] },  // string、string[] 或 { 语言ID: string[] }
    source: 'my-plugin',
    priority: 30,
    ttlMs: 5000,
  },
}));
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `text` | 必填 | 覆盖文案；字符串、字符串数组，或按语言 ID 索引的字符串数组 |
| `source` | `default` | 覆盖来源；同一来源再次派发会替换上一次 |
| `sessionId` | `*` | 只作用于某个会话；`*` 表示全部 |
| `priority` | `30` | 同时存在多个覆盖时大的赢，同分则后设置的赢 |
| `ttlMs` | `5000` | 存活时长；`0` 或 `null` 表示不过期，需要派发 `clear: true` 撤掉 |
| `interleaveEvery` | `0` | 大于 1 时每隔这么多个窗口让位一次，让底层轮换文案露脸 |
| `clear` | `false` | 置 `true` 时按 `source` 与 `sessionId` 清掉对应覆盖 |

派发 `dsh:window-shake` 事件则使用 `shakePhrases`：取当前语言的一句，以 `priority: 30`、`ttlMs: 5000` 顶替，只在回合进行时生效。插件本身不监听摇晃手势，这个事件由别的插件或页面派发。

## 状态色

`stageColors` 打开时，插件把当前段写到根元素属性 `data-dsh-status-stage`（`start` / `progress` / `long`），并设置六个 CSS 变量：

```
--dsh-status-start-light     --dsh-status-start-dark
--dsh-status-progress-light  --dsh-status-progress-dark
--dsh-status-long-light      --dsh-status-long-dark
```

注入的样式据此给 `[data-chat-running="true"]` 上色，亮色主题用 `-light` 一组，`body[data-ds-dark-theme]` 下用 `-dark` 一组。默认色：亮色 `#0284c7` / `#1d4ed8` / `#ea580c`，暗色 `#38bdf8` / `#60a5fa` / `#fb923c`。写成 `stageColors: false` 就完全不着色。

## 设计说明

- **通用内核，内容归配置。** 插件不含任何专属措辞，示例文案仅作演示。
- **在 translate 层覆盖，而非词典。** 配置里的 locale 词典触及不到运行状态组件自身的 `t` 绑定；只有在服务层覆盖 `translate`，才能让文案真正渲染出来。
- **干净的生命周期。** 包装函数在 `ctx.effect` 中安装，并在清理时（或 `pack` 变化时）还原，编辑配置不会留下失效的覆盖。状态样式与轮询同样在清理时撤掉。

## 安装

```powershell
dsh plugin --profile desktop add dsh-rotate-status-text
```

## 许可

MIT
