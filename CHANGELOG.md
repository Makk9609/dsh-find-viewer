# Changelog

Notable changes per release. Versions follow [SemVer](https://semver.org/).

## v0.1.1 — 2026-10-23

- **Fixed:** code and plain-text files could search forever. `remote.workspaceFiles.read`
  returns an `{ok, value}` envelope; reading page fields off the envelope gave no line count,
  so the paging offset became `NaN` and the scan re-issued reads without end while the bar
  stayed on "Scanning…". Reads are now unwrapped, a failed read reports "Could not read the
  file", and a page without new lines ends the scan. Verified on a 118-line Python file:
  `1/12` stable, `Enter` advances to `2/12`, one read per search after the cache fills.
- **Added:** opening the find bar from the toolbar button or `Cmd/Ctrl+F` uses the text
  selected in the preview as the keyword (first line, up to 200 characters).
- 中文：修复代码与纯文本文件搜索永不结束——读取结果是 `{ok, value}` 信封，未解包导致分页
  偏移变成 `NaN`、请求无限重发，面板停在"扫描中"；现在解包、失败即报错、无新页即收尾。
  新增：在预览里选中文本后打开查找栏，直接以选中内容为关键词。

## v0.1.0 — 2026-10-15

- First release. Find bar in the document toolbar; whole-file match counts for plain text and
  code, rendered-text counts for Markdown; Edge/Chrome find colours; per-hit jumps; match case
  and whole word.
- 中文：首个版本。文档工具栏查找栏；纯文本与代码按整份文件计数，Markdown 按已渲染文本计数；
  Edge/Chrome 页内查找配色；逐处跳转；区分大小写与全字匹配。
