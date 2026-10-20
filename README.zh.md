# dsh-find-viewer

给 DeepSeek Harness 侧边栏的文本预览加一条查找栏，位置就在预览自带的文档工具栏里。
它搜索文件、显示命中数量、高亮命中，并在命中之间跳转。

[English](README.md) | 中文

![查找栏覆盖在 Markdown 预览上，当前命中为橙色](assets/find-bar.png)

![查找栏：输入框、计数、上一个/下一个、区分大小写、全字匹配、关闭](assets/find-bar-closeup.png)

## 功能

- **文档工具栏里的放大镜按钮**，紧挨 *Open in app*。只在预览显示文本文件时出现，因此
  PDF、图片、HTML、表格与 Office 预览的工具栏保持原样。
- **查找栏**：输入框、`n/m` 计数、上一个/下一个、区分大小写（`Aa`）、全字匹配（`W`）、
  关闭。`Enter` 到下一处，`Shift+Enter` 到上一处，`Esc` 关闭。
- **`Cmd/Ctrl+F`**：当预览是你最后点击的面板时打开查找栏。
- **搜索选中文本**：在预览里选中一段文字后打开查找栏，选中内容会直接成为关键词。多行
  选区取第一行；超过 200 字符的选区忽略。
- **配色与 Edge/Chrome 页内查找一致**：命中 `#FFFF00` 黄，当前命中 `#FF9632` 橙，两者
  文字都是黑色。输入关键词时会自动滚到第一处命中。

## 计数范围

| 预览 | 计数 | 跳转 | 高亮 |
|---|---|---|---|
| 纯文本、代码 | 整份文件，精确 | 任意行，包括查看器尚未加载的行 | 已渲染的每一处 |
| Markdown | 当前已渲染的文字 | 已渲染的每一处 | 已渲染的每一处 |

Markdown 不同，是因为官方 Markdown 视图渲染的是排版后的 HTML：源码标记已不存在，也
没有源码行锚点，所以它上面的查找只能在已渲染的内容里计数与跳转，计数随加载增长。纯文本
与代码把源码行保留在 DOM 里，因此这两者是整份文件计数。

覆盖的文件：Markdown（`.md`、`.markdown`、`.mdx`）、纯文本与日志、以及代码
（`.js`、`.ts`、`.py`、`.go`、`.rs`、`.java`、`.c`、`.cpp`、`.css`、`.json`、`.yaml`、
`.toml`、`.sh`、`.sql` 等）。表格（`.csv`、`.tsv`）、HTML 与 SVG 保留各自的预览。
`Dockerfile` 这类没有后缀的文件不在覆盖范围内，因为查看器按文件名后缀选择渲染器。

## 安装

从 npm：

```sh
dsh plugin --profile web add dsh-find-viewer
```

直接从 GitHub：

```sh
dsh plugin --profile web add github:Makk9609/dsh-find-viewer
```

然后重启 `dsh web`。也可以在插件市场或插件管理器里一键安装，它们会顺带启用该 bundle。

卸载：

```sh
dsh plugin --profile web remove dsh-find-viewer
```

## 实现方式

插件没有构建步骤，也没有运行时依赖。它的浏览器半边只在文档工具栏的追加型 list 槽位
（`sidebar.right.tab.document.actions`）里注册一个条目；list 槽位只做追加，不会顶掉任何
既有控件。

- 整份文件计数用 harness 自己的分页读取（`remote.workspaceFiles.read`）——与预览本身
  用的是同一个读取入口。
- 高亮走 CSS Custom Highlight API：只登记 Range，不修改官方渲染器拥有的 DOM。
- 跳到尚未加载的行时，请求侧边栏导航到该行（`sidebarRight.openResource`），由查看器
  自己加载所需页面。
- 文案走客户端 locale 服务（内置中英文字典）。

它不以模块方式引用任何 harness 客户端包，也不注册全局快捷键；只有在预览是你最后点击的
面板时才会接管 `Cmd/Ctrl+F`。

## 限制

- 整份文件扫描最多覆盖前 20,000 行或 4 MiB（先到者为准），文件更大时查找栏会注明。
  最多绘制 3,000 处高亮，最多计数 50,000 处（超出显示 `50000+`）。
- 高亮需要 CSS Custom Highlight API（Chromium 105+、Safari 17.2+、Firefox 140+）。缺少
  该 API 时计数与跳转照常，只是不绘制高亮。
- 命中不跨行。
- 已在 DeepSeek Harness `0.2.0-rc.2` 上验证。清单里没有声明 `engines.dsh` 范围，因为
  与后续版本的兼容性尚未测试。

## 开发

```sh
npm test        # 用桩件加载浏览器半边，检查匹配、地址解码、注册形态与输出的高亮规则
```

`client.js` 是浏览器半边，`index.js` 是空的宿主半边——它的存在只是为了让 loader 载入
这个包。

## 许可

MIT
