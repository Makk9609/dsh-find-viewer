/**
 * Sidebar text preview find bar.
 *
 * Seat: the document toolbar's additive list slot `sidebar.right.tab.document.actions`,
 * beside the shipped "Open in app" entry. A list slot only appends, so no existing
 * control is replaced. The magnifier renders only while the pane shows a text body,
 * so PDF, image, HTML, spreadsheet and Office previews keep their toolbar unchanged.
 *
 * The body's shape is detected at runtime, never from a renderer id:
 * - Source mode: the body exposes per-line anchors (plain text's
 *   `[data-textpreview-line]`, code's `pre .line`). The find bar reads the complete
 *   file itself for an exact whole-file count, paints highlights on rendered lines,
 *   and jumps to an unrendered line by asking the viewer to load it first.
 * - Rendered-text mode: the body has no line anchors (Markdown). Count, highlight and
 *   jump all come from one Range index over the text currently rendered.
 *
 * Highlights use the CSS Custom Highlight API: the bar registers Ranges and never
 * mutates the DOM the official renderers own.
 */
window.__ModuleLoader__.load({
  id: 'dsh-find-viewer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dshFindViewer';
    const SLOT = 'sidebar.right.tab.document.actions';
    const ENTRY_ID = 'find-viewer';
    /** 高亮数量上限；超出的命中仍然计数。 */
    const MAX_HIGHLIGHTS = 3000;
    /** 命中列表上限；达到上限时计数显示为“上限+”。 */
    const MAX_MATCHES = 50000;
    /** 全文件扫描的行数与字节上限，超出时查找栏标注实际扫描范围。 */
    const MAX_SCAN_LINES = 20000;
    const MAX_SCAN_BYTES = 4 * 1024 * 1024;
    /** 等待官方查看器把目标行渲染出来的上限。 */
    const LINE_WAIT_MS = 3000;
    /** DOM 变化到重新计算的去抖间隔。 */
    const SETTLE_MS = 120;
    const SOURCE_CACHE_LIMIT = 8;
    /** 打开时自动填入的选中文本上限，超过这个长度说明选中的不是关键词。 */
    const MAX_SELECTION_QUERY = 200;
    const FILE_PREFIX = 'dsh-resource://file/';

    const zh = {
      'action.label': '在文件中查找',
      'action.tooltip': '在文件中查找',
      'bar.placeholder': '查找',
      'bar.prev': '上一个',
      'bar.next': '下一个',
      'bar.close': '关闭',
      'bar.case': '区分大小写',
      'bar.word': '全字匹配',
      'bar.scanning': '扫描中…',
      'bar.none': '无结果',
      'bar.failed': '读取失败',
      'bar.capped': '{count}+',
      'bar.scope.rendered': '仅搜索已渲染内容',
      'bar.scope.truncated': '仅搜索前 {lines} 行',
    };

    const en = {
      'action.label': 'Find in file',
      'action.tooltip': 'Find in file',
      'bar.placeholder': 'Find',
      'bar.prev': 'Previous match',
      'bar.next': 'Next match',
      'bar.close': 'Close',
      'bar.case': 'Match case',
      'bar.word': 'Match whole word',
      'bar.scanning': 'Scanning…',
      'bar.none': 'No results',
      'bar.failed': 'Could not read the file',
      'bar.capped': '{count}+',
      'bar.scope.rendered': 'Searching rendered content only',
      'bar.scope.truncated': 'Searching the first {lines} lines only',
    };

    const STYLES = `
.dfv-anchor{display:inline-flex;align-items:center}
.dfv-tool{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:6px;border:none;background:transparent;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.dfv-tool:hover,.dfv-tool[aria-expanded="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dfv-tool svg{width:15px;height:15px}
/* 弹出卡片沿用原生 Menu 的表面：Menu.module.css 的卡片材质与 MenuSurface 的圆角。 */
.dfv-panel{position:fixed;z-index:1100;box-sizing:border-box;max-width:calc(100vw - 16px);display:flex;align-items:center;gap:4px;padding:4px;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-overlay));backdrop-filter:var(--dsw-menu-backdrop-filter,none);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:20px}
/* 输入框沿用原生 Input：Input.module.css 的边框、圆角、底色与聚焦色。 */
.dfv-input{width:150px;min-width:64px;flex:0 1 auto;height:28px;box-sizing:border-box;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;outline:none}
.dfv-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.dfv-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dfv-count{min-width:40px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}
/* 按钮沿用原生工具按钮：与文档工具栏的 reload/wrap 同尺寸、同悬停与按下表现。 */
.dfv-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;font:inherit;font-size:12px;line-height:1}
.dfv-btn:hover:not(:disabled),.dfv-btn[aria-pressed="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dfv-btn:disabled{opacity:.4;cursor:default}
.dfv-btn svg{width:15px;height:15px}
`;

    /** 每个面板一组高亮名，并排的两个预览因此不会互相覆盖高亮。 */
    let instanceSeq = 0;

    /**
     * 面板样式：容器样式固定，高亮伪元素按本面板的高亮名生成。
     * @param names - 本面板的命中与当前命中高亮名。
     * @returns 该面板的样式表文本。
     */
    function styleText(names) {
      // 命中与当前命中的配色取 Edge/Chromium 页内查找本身的值
      // （LayoutTheme::PlatformTextSearchHighlightColor：非当前 255,255,0；当前 255,150,50）
      // 与文字色（PlatformTextSearchColor：黑）。
      return `${STYLES}::highlight(${names.match}){background-color:#ffff00;color:#000000}
::highlight(${names.current}){background-color:#ff9632;color:#000000}
`;
    }

    const IDLE_FIND = {
      status: 'idle',
      mode: 'source',
      query: '',
      matches: [],
      index: 0,
      capped: false,
      truncated: false,
      scanned: 0,
      error: null,
    };

    /** 整份源码缓存，按文件地址保存；先用单行读取核对版本，版本未变直接复用。 */
    const sourceCache = new Map();
    /** 最后一次点击落在哪个预览面板内；Cmd/Ctrl+F 据此判断作用于哪个预览。 */
    let activeTextRoot = null;

    // ---------------------------------------------------------------- 纯函数

    /** 转义正则元字符，让关键词按字面量匹配。 */
    function escapeRegExp(text) {
      return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * 关键词 → 逐行匹配函数。
     * @param query - 用户输入的关键词。
     * @param caseSensitive - 区分大小写时按原样匹配。
     * @param wholeWord - 全字匹配时要求两侧不是字母、数字或下划线。
     * @returns 返回该行内 `{col, len}` 列表的函数；空关键词返回 null。
     */
    function buildMatcher(query, caseSensitive, wholeWord) {
      if (query === '') return null;
      const body = escapeRegExp(query);
      const pattern = wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
      const source = new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
      return (text) => {
        const hits = [];
        for (const match of text.matchAll(source)) hits.push({ col: match.index, len: match[0].length });
        return hits;
      };
    }

    /**
     * 选中文本 → 关键词：取第一段非空行并去掉首尾空白。
     * @param text - 预览区里选中的文本。
     * @returns 可用的关键词；没有内容或整行过长时返回 null。
     */
    function queryFromSelection(text) {
      for (const line of text.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        return trimmed.length > MAX_SELECTION_QUERY ? null : trimmed;
      }
      return null;
    }

    /**
     * 在整份源码上求命中。
     * @param lines - 逐行源码。
     * @param matcher - {@link buildMatcher} 的返回值。
     * @param cap - 命中数量上限。
     * @returns `{line, col, len}` 列表，达到上限时截断。
     */
    function matchLines(lines, matcher, cap) {
      const matches = [];
      for (let index = 0; index < lines.length; index += 1) {
        for (const hit of matcher(lines[index])) {
          matches.push({ line: index + 1, col: hit.col, len: hit.len });
          if (matches.length >= cap) return matches;
        }
      }
      return matches;
    }

    /**
     * 文件地址 → 会话与路径。
     * 地址由产品生成，解码失败时按“无法定位文件”处理，异常不外抛。
     * @param address - `dsh-resource://file/session/<sessionId>/<path>`。
     * @returns `{sessionId, path}`，或非 session 作用域时的 null。
     */
    function decodeAddress(address) {
      if (typeof address !== 'string' || address.startsWith(FILE_PREFIX) === false) return null;
      const rest = address.slice(FILE_PREFIX.length).replace(/[?#][\s\S]*$/u, '');
      const parts = rest.split('/');
      if (parts.length < 3 || parts[0] !== 'session') return null;
      try {
        return {
          sessionId: decodeURIComponent(parts[1]),
          path: parts.slice(2).map((segment) => decodeURIComponent(segment)).join('/'),
        };
      } catch {
        return null;
      }
    }

    // ------------------------------------------------------------- DOM 助手

    /** 正文形态：源码模式有逐行锚点，渲染文本模式只有排版后的文字。 */
    function surfaceKind(body) {
      if (body.querySelector('[data-textpreview-plain]') !== null) return 'source';
      if (body.querySelector('[data-code-preview]') !== null) return 'source';
      if (body.querySelector('[data-document-markdown]') !== null) return 'rendered';
      return null;
    }

    /** 正文里参与查找的文本节点。 */
    function textNodesOf(body) {
      const nodes = [];
      let lastParent = null;
      let parentOk = true;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeValue === '') return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (parent !== lastParent) {
            lastParent = parent;
            parentOk = parent !== null && parent.closest('script, style, noscript, textarea') === null;
          }
          return parentOk ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      let node = walker.nextNode();
      while (node !== null) {
        nodes.push(node);
        node = walker.nextNode();
      }
      return nodes;
    }
    /** 一行的 DOM 元素：纯文本用源码行号属性，代码用行序。 */
    function lineElement(body, line) {
      const plain = body.querySelector(`[data-textpreview-line="${line}"]`);
      if (plain !== null) return plain;
      const code = body.querySelector('[data-code-block-content]');
      if (code === null) return null;
      return code.querySelectorAll('pre .line').item(line - 1);
    }

    /**
     * 滚动到命中位置。
     * 滚动容器交给 scrollIntoView 决定：代码视图的容器是 [data-code-block-content]，
     * 纯文本与 Markdown 是正文本身，Markdown 里的代码围栏同样带这个属性却不是容器。
     * 目标取命中所在文本节点的父元素，因此代码视图会居中命中所在的分词而不是整行。
     * @returns 是否定位成功；目标行尚未渲染或 Range 已失效时返回 false，由调用方兜底。
     */
    function revealMatch(body, match, mode) {
      const segments = mode === 'rendered' ? textSegments(body) : undefined;
      const range = rangeOf(body, match, mode, segments);
      if (range === null) return false;
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const target = range.startContainer.parentElement;
      if (target === null) return false;
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    }

    /**
     * 在元素内按字符偏移建 Range，偏移跨越多个子节点时逐段推进。
     * @param root - 文本节点或元素。
     * @param start - 起始字符偏移。
     * @param length - 命中长度。
     * @returns 对应的 Range，目标位置不存在时返回 null。
     */
    function rangeWithin(root, start, length) {
      if (root === null) return null;
      if (root.nodeType === Node.TEXT_NODE) {
        if (start + length > root.nodeValue.length) return null;
        const direct = document.createRange();
        direct.setStart(root, start);
        direct.setEnd(root, start + length);
        return direct;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let from = null;
      let node = walker.nextNode();
      while (node !== null) {
        const size = node.nodeValue.length;
        if (from === null && start < seen + size) from = { node, offset: start - seen };
        if (from !== null && seen + size >= start + length) {
          const range = document.createRange();
          range.setStart(from.node, from.offset);
          range.setEnd(node, start + length - seen);
          return range;
        }
        seen += size;
        node = walker.nextNode();
      }
      return null;
    }

    /**
     * 正文当前的文本分段：记录每个文本节点在正文文本里的起止偏移。
     * 渲染文本模式的命中用绝对偏移表达，每次使用前重新分段，因此产品重渲染替换
     * 文本节点也不会让高亮或跳转失效。
     */
    function textSegments(body) {
      const segments = [];
      let offset = 0;
      for (const node of textNodesOf(body)) {
        const length = node.nodeValue.length;
        segments.push({ node, start: offset, end: offset + length });
        offset += length;
      }
      return segments;
    }

    /** 绝对偏移 → Range；命中落在同一个文本节点内。 */
    function rangeAtOffset(segments, start, length) {
      for (const segment of segments) {
        if (start < segment.start) return null;
        if (start + length <= segment.end) {
          const range = document.createRange();
          range.setStart(segment.node, start - segment.start);
          range.setEnd(segment.node, start + length - segment.start);
          return range;
        }
      }
      return null;
    }

    /**
     * 一个命中对应的 Range。
     * @param segments - 渲染文本模式的当前分段表；源码模式不需要。
     */
    function rangeOf(body, match, mode, segments) {
      if (mode === 'rendered') return segments === undefined ? null : rangeAtOffset(segments, match.start, match.len);
      return rangeWithin(lineElement(body, match.line), match.col, match.len);
    }

    function canHighlight() {
      return typeof Highlight === 'function' && typeof CSS !== 'undefined' && CSS.highlights !== undefined;
    }

    function clearHighlights(names) {
      if (canHighlight() === false) return;
      CSS.highlights.delete(names.match);
      CSS.highlights.delete(names.current);
    }

    /** 命中全部登记为 Range，当前命中单独一个高亮名。 */
    function applyHighlights(body, find, names) {
      if (canHighlight() === false) return;
      const normal = new Highlight();
      const current = new Highlight();
      const segments = find.mode === 'rendered' ? textSegments(body) : undefined;
      let lastLine = 0;
      let lastElement = null;
      const limit = Math.min(find.matches.length, MAX_HIGHLIGHTS);
      for (let index = 0; index < limit; index += 1) {
        const match = find.matches[index];
        let range = null;
        if (find.mode === 'rendered') range = rangeAtOffset(segments, match.start, match.len);
        else {
          if (match.line !== lastLine) {
            lastLine = match.line;
            lastElement = lineElement(body, match.line);
          }
          range = rangeWithin(lastElement, match.col, match.len);
        }
        if (range === null) continue;
        if (index === find.index) current.add(range);
        else normal.add(range);
      }
      const active = find.matches[find.index];
      if (active !== undefined && find.index >= limit) {
        const range = rangeOf(body, active, find.mode, segments);
        if (range !== null) current.add(range);
      }
      CSS.highlights.set(names.match, normal);
      CSS.highlights.set(names.current, current);
    }

    /** 等待官方查看器渲染出某一行。 */
    function waitForLine(body, line, timeoutMs) {
      if (lineElement(body, line) !== null) return Promise.resolve(true);
      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (lineElement(body, line) === null) return;
          observer.disconnect();
          window.clearTimeout(timer);
          resolve(true);
        });
        const timer = window.setTimeout(() => {
          observer.disconnect();
          resolve(false);
        }, timeoutMs);
        observer.observe(body, { childList: true, subtree: true });
      });
    }

    // ------------------------------------------------------------ 文件读取

    /**
     * 读一页。
     * `remote.workspaceFiles.read` 的结果是 `{ok, value}` 信封：成功取 `value`，
     * 失败抛出具名错误，由调用方置为读取失败。
     */
    async function readPageOrThrow(readPage, sessionId, path, range, signal) {
      const result = await readPage(sessionId, path, range, signal);
      if (result.ok !== true) {
        const code = result.error !== undefined && result.error.code !== undefined ? result.error.code : 'gateway/unknown';
        const message = result.error !== undefined && result.error.message !== undefined ? result.error.message : 'read failed';
        throw new Error(`${code}: ${message}`);
      }
      return result.value;
    }

    /**
     * 按页读完整文件。
     * @returns `{lines, version, truncated}`；被中止返回 null，扫描期间文件版本变化返回 null。
     */
    async function readSourceLines(readPage, sessionId, path, signal, expectedVersion) {
      const lines = [];
      let bytes = 0;
      let offset = 1;
      for (;;) {
        const page = await readPageOrThrow(readPage, sessionId, path, { offset }, signal);
        if (signal.aborted) return null;
        if (page.version !== expectedVersion) return null;
        if (page.lines > 0) {
          for (const text of page.text.split('\n')) {
            lines.push(text);
            bytes += text.length + 1;
          }
        }
        if (page.eof) return { lines, version: page.version, truncated: false };
        // 没有新页时收尾：页码不前进的页不能进入下一次循环。
        if (page.lines <= 0) return { lines, version: page.version, truncated: true };
        if (lines.length >= MAX_SCAN_LINES || bytes >= MAX_SCAN_BYTES) {
          return { lines, version: page.version, truncated: true };
        }
        offset += page.lines;
      }
    }

    /** 取整份源码：先用单行读取核对版本，版本未变直接复用缓存。 */
    async function ensureSource(readPage, address, target, signal) {
      const probe = await readPageOrThrow(readPage, target.sessionId, target.path, { offset: 1, limit: 1 }, signal);
      if (signal.aborted) return null;
      const cached = sourceCache.get(address);
      if (cached !== undefined && cached.version === probe.version) return cached;
      const scanned = await readSourceLines(readPage, target.sessionId, target.path, signal, probe.version);
      if (scanned === null || signal.aborted) return null;
      const entry = { version: scanned.version, lines: scanned.lines, truncated: scanned.truncated };
      sourceCache.delete(address);
      sourceCache.set(address, entry);
      while (sourceCache.size > SOURCE_CACHE_LIMIT) sourceCache.delete(sourceCache.keys().next().value);
      return entry;
    }

    // -------------------------------------------------------------- 组件

    function SearchIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', {
          fill: 'currentColor',
          d: 'M6.75 1.5a5.25 5.25 0 1 0 3.28 9.35l3.06 3.06a.75.75 0 1 0 1.06-1.06l-3.06-3.06A5.25 5.25 0 0 0 6.75 1.5Zm0 1.5a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5Z',
        }),
      );
    }

    /** 线性图标，笔画宽度与尺寸同原生工具按钮里的图标一致。 */
    function StrokeIcon(path) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: path }),
      );
    }

    /** 查找栏里的一个图标按钮；尺寸、悬停与按下表现由 .dfv-btn 统一给出。 */
    function IconButton(props, child) {
      return h('button', { type: 'button', className: 'dfv-btn', ...props }, child);
    }

    function FindControl(props) {
      const { t, sidebarRight, readPage } = props;
      const anchorRef = React.useRef(null);
      const buttonRef = React.useRef(null);
      const inputRef = React.useRef(null);
      const surfaceRef = React.useRef(null);
      const settleRef = React.useRef(0);
      /** 已经为哪一组关键词与开关滚动过第一处命中。 */
      const revealRef = React.useRef('');
      const [open, setOpen] = React.useState(false);
      const [query, setQuery] = React.useState('');
      const [caseSensitive, setCaseSensitive] = React.useState(false);
      const [wholeWord, setWholeWord] = React.useState(false);
      const [find, setFind] = React.useState(IDLE_FIND);
      const [stamp, setStamp] = React.useState(0);
      const [surfaceReady, setSurfaceReady] = React.useState(false);
      const [placement, setPlacement] = React.useState(null);
      const namesRef = React.useRef(null);
      if (namesRef.current === null) {
        instanceSeq += 1;
        namesRef.current = {
          match: `dsh-find-viewer-match-${instanceSeq}`,
          current: `dsh-find-viewer-current-${instanceSeq}`,
        };
      }
      const names = namesRef.current;

      const rootOf = React.useCallback(() => {
        const anchor = anchorRef.current;
        return anchor === null ? null : anchor.closest('[data-textpreview-url]');
      }, []);

      const addressOf = React.useCallback(() => {
        const root = rootOf();
        return root === null ? null : root.getAttribute('data-textpreview-url');
      }, [rootOf]);

      const bodyOf = React.useCallback(() => {
        const root = rootOf();
        if (root === null) return null;
        const body = root.querySelector('[data-textpreview-body]');
        if (body === null || surfaceKind(body) === null) return null;
        return body;
      }, [rootOf]);

      const settle = React.useCallback((run) => {
        window.clearTimeout(settleRef.current);
        settleRef.current = window.setTimeout(run, SETTLE_MS);
      }, []);

      /** 把查找栏放到放大镜正下方。 */
      const measure = React.useCallback(() => {
        const button = buttonRef.current ?? anchorRef.current;
        if (button === null) return;
        const rect = button.getBoundingClientRect();
        setPlacement({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
      }, []);

      /** 光标进入查找输入框并选中已有内容。 */
      const focusInput = React.useCallback(() => {
        const input = inputRef.current;
        if (input === null) return;
        input.focus({ preventScroll: true });
        input.select();
      }, []);

      /** 预览区里选中了文本时，用它的第一行作为关键词。 */
      const selectionQuery = React.useCallback(() => {
        const root = rootOf();
        const selection = window.getSelection();
        if (root === null || selection === null || selection.isCollapsed) return null;
        if (root.contains(selection.anchorNode) === false || root.contains(selection.focusNode) === false) return null;
        return queryFromSelection(selection.toString());
      }, [rootOf]);

      // 正文变化（翻页、重载、换渲染器）时递增 stamp，驱动探测与重算。
      React.useEffect(() => {
        const root = rootOf();
        if (root === null) return undefined;
        const observer = new MutationObserver((records) => {
          const own = anchorRef.current;
          for (const record of records) {
            const target = record.target;
            if (own !== null && target instanceof Node && own.contains(target)) continue;
            settle(() => {
              setStamp((value) => value + 1);
            });
            return;
          }
        });
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-document-preview'],
        });
        // 正文本身不可聚焦，用最后一次点击判断 Cmd/Ctrl+F 该作用于哪个预览。
        const onPointerDown = (event) => {
          activeTextRoot = root.contains(event.target) ? root : null;
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          if (activeTextRoot === root) activeTextRoot = null;
          observer.disconnect();
          window.clearTimeout(settleRef.current);
        };
      }, [settle, rootOf]);

      // 探测当前正文，决定放大镜是否出现。
      React.useEffect(() => {
        const body = bodyOf();
        surfaceRef.current = body;
        setSurfaceReady(body !== null);
      }, [bodyOf, stamp, open]);

      // 命中计算：源码模式读整份文件，渲染文本模式遍历已渲染文本节点。
      React.useEffect(() => {
        const body = surfaceRef.current;
        if (open === false || query === '' || body === null) {
          setFind(IDLE_FIND);
          return undefined;
        }
        const mode = surfaceKind(body);
        if (mode === null) {
          setFind(IDLE_FIND);
          return undefined;
        }
        const matcher = buildMatcher(query, caseSensitive, wholeWord);
        if (mode === 'rendered') {
          const matches = [];
          let offset = 0;
          for (const node of textNodesOf(body)) {
            const text = node.nodeValue;
            for (const hit of matcher(text)) {
              matches.push({ start: offset + hit.col, len: hit.len });
              if (matches.length >= MAX_MATCHES) break;
            }
            offset += text.length;
            if (matches.length >= MAX_MATCHES) break;
          }
          setFind((current) => ({
            status: 'ready',
            mode,
            query,
            matches,
            // 同一关键词重新计算（正文翻页、重载）时保持当前命中，新关键词从第一处开始。
            index: current.query === query ? Math.min(current.index, Math.max(0, matches.length - 1)) : 0,
            capped: matches.length >= MAX_MATCHES,
            truncated: false,
            scanned: 0,
            error: null,
          }));
          return undefined;
        }
        const address = addressOf();
        const target = address === null ? null : decodeAddress(address);
        if (target === null) {
          setFind({ ...IDLE_FIND, status: 'failed', mode, query, error: 'unreadable address' });
          return undefined;
        }
        const controller = new AbortController();
        // 同一关键词已有结果时继续显示，只在还没有结果时才提示扫描中。
        setFind((current) =>
          current.query === query && current.matches.length > 0
            ? { ...current, mode, error: null }
            : { ...IDLE_FIND, status: 'scanning', mode, query },
        );
        ensureSource(readPage, address, target, controller.signal)
          .then((entry) => {
            if (controller.signal.aborted) return;
            if (entry === null) {
              setFind({ ...IDLE_FIND, status: 'failed', mode, query, error: 'file changed while scanning' });
              return;
            }
            const matches = matchLines(entry.lines, matcher, MAX_MATCHES);
            setFind((current) => ({
              status: 'ready',
              mode,
              query,
              matches,
              index: current.query === query ? Math.min(current.index, Math.max(0, matches.length - 1)) : 0,
              capped: matches.length >= MAX_MATCHES,
              truncated: entry.truncated,
              scanned: entry.lines.length,
              error: null,
            }));
          })
          .catch((error) => {
            if (controller.signal.aborted) return;
            setFind({
              ...IDLE_FIND,
              status: 'failed',
              mode,
              query,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return () => {
          controller.abort();
        };
      }, [open, query, caseSensitive, wholeWord, stamp, bodyOf, addressOf, readPage]);

      // 高亮跟随命中与当前项；官方 DOM 只被登记 Range。
      React.useEffect(() => {
        const body = surfaceRef.current;
        const ready = find.status === 'ready' && find.query === query;
        if (open === false || ready === false || body === null) {
          clearHighlights(names);
          return undefined;
        }
        applyHighlights(body, find, names);
        return () => {
          clearHighlights(names);
        };
      }, [open, find, query, names]);

      // 弹出层位置跟随工具栏按钮。
      React.useEffect(() => {
        if (open === false) {
          setPlacement(null);
          return undefined;
        }
        measure();
        window.addEventListener('resize', measure);
        return () => {
          window.removeEventListener('resize', measure);
        };
      }, [open, measure]);

      // 打开时聚焦并选中已有内容。
      React.useEffect(() => {
        if (open === false) return;
        focusInput();
      }, [open, focusInput]);

      /**
       * 打开查找栏。
       * 位置在这里同步量好：首帧就可见，输入框才能拿到焦点；visibility:hidden 的
       * 元素无法获得焦点，若把定位留给 effect，输入框会一直不被聚焦。
       * 预览区里有选中文本时直接用它作为关键词。
       */
      const openBar = React.useCallback(() => {
        const seeded = selectionQuery();
        if (seeded !== null) setQuery(seeded);
        measure();
        setOpen(true);
        focusInput();
      }, [measure, focusInput, selectionQuery]);

      const closeBar = React.useCallback(() => {
        setOpen(false);
        const button = buttonRef.current;
        if (button !== null) button.focus();
      }, []);

      // 焦点位于本预览内时接管 Cmd/Ctrl+F，其余位置留给浏览器自身的查找。
      React.useEffect(() => {
        const onKeyDown = (event) => {
          const isFindKey = (event.key === 'f' || event.key === 'F') && (event.metaKey || event.ctrlKey);
          if (isFindKey === false || event.altKey || event.shiftKey) return;
          const root = rootOf();
          if (root === null) return;
          const inside = (node) => node instanceof Node && root.contains(node);
          const owned = inside(document.activeElement) || inside(event.target) || activeTextRoot === root;
          if (owned === false || bodyOf() === null) return;
          event.preventDefault();
          openBar();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [openBar, rootOf]);

      const jumpTo = React.useCallback(
        (match) => {
          const body = surfaceRef.current;
          if (body === null) return;
          if (revealMatch(body, match, find.mode)) return;
          if (find.mode !== 'source') return;
          const address = addressOf();
          if (address === null || sidebarRight === undefined) return;
          // 命中不在已渲染的范围里：先让官方查看器按行加载，再滚到命中的列。
          sidebarRight.openResource(address, { params: { line: match.line } });
          waitForLine(body, match.line, LINE_WAIT_MS).then((found) => {
            if (found) revealMatch(body, match, find.mode);
          });
        },
        [find.mode, addressOf, sidebarRight],
      );

      const goTo = React.useCallback(
        (delta) => {
          const total = find.matches.length;
          if (find.status !== 'ready' || find.query !== query || total === 0) return;
          const index = ((find.index + delta) % total + total) % total;
          setFind((current) => ({ ...current, index }));
          jumpTo(find.matches[index]);
        },
        [find, query, jumpTo],
      );

      // 关键词或开关变化后，第一次算出命中就滚到第一处，与编辑器里的查找一致。
      React.useEffect(() => {
        if (open === false || query === '' || find.status !== 'ready' || find.query !== query) return;
        const key = `${query}\u0000${caseSensitive}\u0000${wholeWord}`;
        if (revealRef.current === key) return;
        revealRef.current = key;
        if (find.matches.length === 0) return;
        jumpTo(find.matches[0]);
      }, [open, query, caseSensitive, wholeWord, find, jumpTo]);

      const onInputKeyDown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          goTo(event.shiftKey ? -1 : 1);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeBar();
        }
      };

      const ready = find.status === 'ready' && find.query === query;
      const total = ready ? find.matches.length : 0;
      let label = '';
      let hint = '';
      if (query !== '') {
        if (find.status === 'failed' && find.query === query) {
          label = t('bar.failed');
          hint = find.error ?? '';
        } else if (ready === false) {
          label = t('bar.scanning');
        } else if (total === 0) {
          label = t('bar.none');
        } else {
          label = `${find.index + 1}/${find.capped ? t('bar.capped', { count: total }) : total}`;
        }
        if (find.mode === 'rendered') hint = t('bar.scope.rendered');
        else if (find.truncated) hint = t('bar.scope.truncated', { lines: find.scanned });
      }
      const keys = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform ?? '') ? '⌘F' : 'Ctrl+F';

      // 放大镜、查找栏、样式同挂一个容器：正文变化的观察器据此整块跳过我们自己产生的
      // DOM 变化。查找栏与放大镜若是兄弟节点，计数文字每次更新都会被当成正文变化。
      const anchorChildren = [
        h('style', { key: 'style', 'data-dsh-find-viewer': true, dangerouslySetInnerHTML: { __html: styleText(names) } }),
        surfaceReady
          ? h(
              'button',
              {
                type: 'button',
                ref: buttonRef,
                className: 'dfv-tool',
                'aria-label': t('action.label'),
                'aria-expanded': open,
                title: `${t('action.tooltip')} (${keys})`,
                onClick: () => {
                  if (open) closeBar();
                  else openBar();
                },
              },
              h(SearchIcon),
            )
          : null,
      ];
      if (open) {
        const panelStyle = placement === null
          ? { visibility: 'hidden' }
          : { top: `${placement.top}px`, right: `${placement.right}px` };
        anchorChildren.push(
          h(
            'div',
            { key: 'panel', className: 'dfv-panel', style: panelStyle, role: 'dialog', 'aria-label': t('action.label') },
            h('input', {
              ref: inputRef,
              className: 'dfv-input',
              type: 'text',
              value: query,
              placeholder: t('bar.placeholder'),
              'aria-label': t('bar.placeholder'),
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: onInputKeyDown,
            }),
            h('span', { className: 'dfv-count', title: hint }, label),
            IconButton(
              { disabled: total === 0, 'aria-label': t('bar.prev'), title: t('bar.prev'), onClick: () => goTo(-1) },
              StrokeIcon('M4 9.75 8 5.75l4 4'),
            ),
            IconButton(
              { disabled: total === 0, 'aria-label': t('bar.next'), title: t('bar.next'), onClick: () => goTo(1) },
              StrokeIcon('M4 6.25 8 10.25l4-4'),
            ),
            IconButton(
              { 'aria-pressed': caseSensitive, 'aria-label': t('bar.case'), title: t('bar.case'), onClick: () => setCaseSensitive((value) => !value) },
              'Aa',
            ),
            IconButton(
              { 'aria-pressed': wholeWord, 'aria-label': t('bar.word'), title: t('bar.word'), onClick: () => setWholeWord((value) => !value) },
              'W',
            ),
            IconButton(
              { 'aria-label': t('bar.close'), title: t('bar.close'), onClick: closeBar },
              StrokeIcon('M4.5 4.5l7 7M11.5 4.5l-7 7'),
            ),
          ),
        );
      }
      return h('span', { className: 'dfv-anchor', ref: anchorRef }, anchorChildren);
    }

    // -------------------------------------------------------------- 注册

    /**
     * Client plugin body: register the toolbar entry for the document preview.
     * @param ctx - client context carrying the slot registry, copy, and navigation face.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'find-viewer: zh');
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'find-viewer: en');
      const t = ctx.locale.bind(NS);
      const readPage = (sessionId, path, range, signal) => ctx.remote.workspaceFiles.read(sessionId, path, range, signal);
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register({ name: SLOT, id: ENTRY_ID, order: 10 }, (props) =>
              h(FindControl, { ...props, t, sidebarRight: ctx.sidebarRight, readPage }),
            ),
          ),
        'find-viewer: toolbar entry',
      );
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'remote', 'remote.workspaceFiles'],
      apply,
      __test: { buildMatcher, matchLines, decodeAddress, styleText, queryFromSelection, readSourceLines },
    };
  },
});
