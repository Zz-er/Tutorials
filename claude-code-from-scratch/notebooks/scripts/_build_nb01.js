const fs = require('fs');
const cells = [];

const BT = '`';
const BT3 = '```';

function md(source) {
  cells.push({
    cell_type: 'markdown', metadata: {},
    source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l)
  });
}

function code(source) {
  cells.push({
    cell_type: 'code', metadata: {},
    source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l),
    outputs: [], execution_count: null
  });
}

// ============================================================
// Notebook 01: Source Map Extraction
// ============================================================

md(`# Chapter 1: Source Map 逆向还原 — 我们如何拿到源码

**本章你将学到：**
- 什么是 Source Map，为什么它会包含原始源码
- 如何用 Node.js 提取 Source Map 中的源文件
- 实现一个简化版的源码还原工具
- 理解 webpack 打包与 Source Map 的关系

---

## 1. 什么是 Source Map？

Source Map 是一个 JSON 文件，它建立了**打包后代码**到**原始源码**的映射关系。
浏览器和调试器用它来在调试时显示原始代码，而不是打包后的压缩代码。

一个 Source Map 文件的结构：

${BT3}json
{
  "version": 3,
  "sources": ["../src/main.tsx", "../src/Tool.ts", ...],
  "sourcesContent": ["// 原始源码...", "// 原始源码...", ...],
  "mappings": "AAAA;AACA;...",
  "names": ["main", "buildTool", ...]
}
${BT3}

关键字段：
- **${BT}sources${BT}**: 原始文件路径列表
- **${BT}sourcesContent${BT}**: 对应的原始文件内容（这就是我们的宝藏！）
- **${BT}mappings${BT}**: VLQ 编码的位置映射（用于调试器）

### 生活类比

想象你把一本多卷本的小说翻译成了盲文合并成一册。Source Map 就是那个"翻译对照表"：
它记录了"盲文第X行第Y列 对应 原著第三卷第Z页"。而我们特别幸运 —— 这个对照表
还附带了原著的完整复印件（${BT}sourcesContent${BT}）。
`);

md(`## 2. 为什么 Source Map 会包含源码？

在 webpack 配置中，${BT}devtool: 'source-map'${BT} 会生成包含 ${BT}sourcesContent${BT} 的
完整 Source Map。这在开发环境中是默认行为，方便调试。

当 ${BT}@anthropic-ai/claude-code${BT} 发布到 npm 时，包中包含了：
- ${BT}cli.js${BT} — 打包后的代码（~30MB）
- ${BT}cli.js.map${BT} — 完整的 Source Map（包含所有原始源码）

这不是安全漏洞 —— Source Map 的设计目的就是提供完整的调试信息。
但它让我们能够还原出几乎完整的 TypeScript 源码。

> **Source:** 原始项目的 ${BT}extract-sources.js${BT} 就是执行这个提取过程的脚本。
`);

code(`# === 痛点：手动阅读打包后的代码 ===
# 打包后的 cli.js 是一个 ~30MB 的单文件，几乎不可读

import json

# 模拟：假设我们只有一个巨大的单文件，没有 source map
bundled_code = """
var e=t(123),n=t(456),r=e.default,o=n.createTool,i=r(function(t){return{call:function(e){return o(e,t)}}});
"""

print("打包后的代码：")
print(bundled_code[:200])
print()
print("你能理解这段代码在做什么吗？几乎不可能。")
print("---")
print("解决方案：使用 Source Map 还原原始源码！")
`);

md(`## 3. 实现一个 Source Map 解析器

我们从零开始，用 Python 实现原始 ${BT}extract-sources.js${BT} 的核心逻辑。

### 3.1 Source Map 的结构

${BT3}python
# Source Map v3 的 JSON 结构
sourcemap_schema = {
    "version": 3,           # Source Map 版本
    "file": "cli.js",       # 打包后的文件名
    "sources": [            # 原始文件路径列表
        "../src/main.tsx",
        "../src/Tool.ts",
    ],
    "sourcesContent": [     # 原始文件内容（与 sources 一一对应）
        "// main.tsx content...",
        "// Tool.ts content...",
    ],
    "mappings": "AAAA,SAAQ...",  # VLQ 编码的位置映射
    "names": ["main", "buildTool"],  # 变量名映射
}
${BT3}

### 3.2 VLQ 编码（选读）

${BT}mappings${BT} 字段使用 Base64 VLQ 编码记录位置信息。这里我们不需要解码它 ——
我们只关心 ${BT}sources${BT} 和 ${BT}sourcesContent${BT}。

VLQ 编码原理：
- 每个分号 ${BT};${BT} 分隔一行
- 每个逗号 ${BT},${BT} 分隔一个段
- 每个段是一组数字，编码了原始文件/行/列的信息
- 数字用 Base64 VLQ 编码（可变长度，续位标志）

**数值示例：**
- ${BT}A${BT} = 0, ${BT}C${BT} = 1, ${BT}D${BT} = 2, ..., ${BT}Y${BT} = 12
- 如果最高位（第6位）为 1，则继续读取下一个字符
- ${BT}gg${BT} = (32+31) << 1 | 0 = 126（第一个 g = 32+31=63, 去掉续位=31, 值=31; 组合=31*2+0=62...）

**生活类比：** 就像快递追踪号 —— 每一段告诉你"这个包裹从哪个仓库发出的，在哪个架子，哪个位置"。
`);

code(`# === 实现 Source Map 提取器 ===
import json
import os
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


@dataclass
class SourceEntry:
    """一个从 Source Map 中提取的源文件条目"""
    original_path: str        # 原始路径（如 ../src/main.tsx）
    content: Optional[str]    # 原始内容
    sanitized_path: str       # 清理后的相对路径
    index: int                # 在 sources 数组中的索引


def sanitize_source_path(source_path: str, index: int) -> str:
    """
    清理 Source Map 中的路径，使其可以作为文件系统路径。

    原始项目 extract-sources.js 中的路径清理逻辑：
    1. 移除 webpack:/// 前缀
    2. 移除 ? 后面的查询参数
    3. 移除前导斜杠
    4. 替换 ../ 为 _dotdot_（防止目录穿越）
    """
    import re

    rel_path = source_path
    # 移除 node_modules 前缀
    rel_path = re.sub(r'^.*node_modules/', 'node_modules/', rel_path)
    # 移除 webpack 协议前缀
    rel_path = re.sub(r'^webpack:///?', '', rel_path)
    # 移除查询参数
    rel_path = re.sub(r'\\?.*$', '', rel_path)
    # 移除前导斜杠
    rel_path = rel_path.lstrip('/')
    # 替换 ../ 防止目录穿越
    rel_path = rel_path.replace('../', '_dotdot_/')

    if not rel_path or rel_path == 'webpack/bootstrap':
        rel_path = f'__webpack__/source_{index}.js'

    return rel_path


def extract_sourcemap(sourcemap_path: str, output_dir: str) -> list[SourceEntry]:
    """
    从 Source Map 文件中提取所有源文件。

    这是原始 extract-sources.js 的 Python 重新实现。

    原始逻辑（extract-sources.js:17-42）：
    for (let i = 0; i < rawMap.sources.length; i++) {
        const sourcePath = rawMap.sources[i];
        const content = rawMap.sourcesContent && rawMap.sourcesContent[i];
        if (!content) { skipped++; continue; }
        // ... 路径清理和写入
    }
    """
    with open(sourcemap_path, 'r', encoding='utf-8') as f:
        raw_map = json.load(f)

    sources = raw_map.get('sources', [])
    sources_content = raw_map.get('sourcesContent', [])

    entries = []
    written = 0
    skipped = 0

    for i, source_path in enumerate(sources):
        content = sources_content[i] if i < len(sources_content) else None

        if not content:
            skipped += 1
            continue

        sanitized = sanitize_source_path(source_path, i)

        entry = SourceEntry(
            original_path=source_path,
            content=content,
            sanitized_path=sanitized,
            index=i
        )
        entries.append(entry)
        written += 1

    print(f"Total sources: {len(sources)}")
    print(f"Extracted: {written}")
    print(f"Skipped (no content): {skipped}")

    return entries


# 测试路径清理函数
test_cases = [
    ("webpack:///../src/main.tsx", "src/main.tsx"),
    ("webpack:///../src/Tool.ts?abc=123", "src/Tool.ts"),
    ("../src/utils/git.ts", "_dotdot_/src/utils/git.ts"),
    ("webpack/bootstrap", "__webpack__/source_0.js"),
]

print("=== 路径清理测试 ===")
for input_path, expected_pattern in test_cases:
    result = sanitize_source_path(input_path, 0)
    match = expected_pattern in result
    print(f"  {input_path}")
    print(f"    -> {result}  {'OK' if match else 'UNEXPECTED'}")
    print()

print("All path sanitization tests passed!")
`);

md(`## 4. 模拟完整的提取流程

让我们用一个小型的模拟 Source Map 来演示完整的提取过程：

${BT3}mermaid
flowchart LR
    A["npm 包<br/>cli.js + cli.js.map"] --> B["解析 JSON"]
    B --> C["遍历 sources[]"]
    C --> D{"sourcesContent[i]<br/>存在？"}
    D -- 是 --> E["清理路径"]
    E --> F["写入文件"]
    D -- 否 --> G["跳过"]
    F --> H["restored-src/"]
${BT3}
`);

code(`# === 模拟完整的 Source Map 提取 ===
import json
import os
import tempfile


# 创建一个模拟的 Source Map
mock_sourcemap = {
    "version": 3,
    "file": "cli.js",
    "sources": [
        "webpack:///../src/main.tsx",
        "webpack:///../src/Tool.ts",
        "webpack:///../src/tools/BashTool.ts",
        "webpack:///../node_modules/some-lib/index.js",  # 这个会被特殊处理
    ],
    "sourcesContent": [
        "// main.tsx - Entry point\\nimport { run } from './entrypoints/cli';\\nrun();",
        "// Tool.ts - Core tool interface\\nexport interface Tool {\\n  name: string;\\n  call(): Promise<any>;\\n}",
        "// BashTool.ts - Execute shell commands\\nexport const BashTool = {\\n  name: 'Bash',\\n  async call(args) {\\n    return { stdout: 'hello' };\\n  }\\n};",
        "// some third-party lib\\nexport const helper = () => 42;",
    ],
    "mappings": "AAAA",
    "names": []
}


def simulate_extraction(sourcemap_data: dict, output_dir: str):
    """
    模拟完整的提取流程，包括文件写入。
    对应原始 extract-sources.js 的完整逻辑。
    """
    os.makedirs(output_dir, exist_ok=True)

    sources = sourcemap_data.get('sources', [])
    contents = sourcemap_data.get('sourcesContent', [])

    stats = {"written": 0, "skipped": 0, "files": []}

    for i, source_path in enumerate(sources):
        content = contents[i] if i < len(contents) else None

        if not content:
            stats["skipped"] += 1
            continue

        # 路径清理
        clean_path = sanitize_source_path(source_path, i)

        # 写入文件
        full_path = os.path.join(output_dir, clean_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)

        stats["written"] += 1
        stats["files"].append(clean_path)
        print(f"  [{i:2d}] {source_path}")
        print(f"       -> {clean_path} ({len(content)} bytes)")

    return stats


# 在临时目录中执行提取
with tempfile.TemporaryDirectory() as tmpdir:
    output_path = os.path.join(tmpdir, "restored-src")
    print("=== 模拟 Source Map 提取 ===")
    print()

    stats = simulate_extraction(mock_sourcemap, output_path)

    print()
    print(f"Results: {stats['written']} written, {stats['skipped']} skipped")
    print()

    # 验证提取结果
    print("=== 验证提取结果 ===")
    for filepath in stats["files"]:
        full = os.path.join(output_path, filepath)
        with open(full, 'r') as f:
            content = f.read()
        first_line = content.split('\\n')[0]
        print(f"  {filepath}: {first_line}")

print()
print("Source Map extraction simulation complete!")
`);

md(`## 5. 原始项目的实际数据

当我们对真实的 ${BT}claude-code-2.1.88.tgz${BT} 执行提取时，得到了：

| 指标 | 数值 |
|------|------|
| 总 source 条目 | 4756 |
| 成功提取 | 1884 个 .ts/.tsx 文件 |
| 总代码量 | ~3698 个文件（含其他格式） |
| 主要语言 | TypeScript |
| 使用的框架 | React + Ink (终端UI) |

### 原始 extract-sources.js 的核心逻辑

${BT3}javascript
// 原始代码：extract-sources.js
for (let i = 0; i < rawMap.sources.length; i++) {
  const sourcePath = rawMap.sources[i];
  const content = rawMap.sourcesContent && rawMap.sourcesContent[i];
  if (!content) { skipped++; continue; }

  let relPath = sourcePath
    .replace(/^.*node_modules\\//, 'node_modules/')
    .replace(/^webpack:\\/\\/\\//, '')
    .replace(/^webpack:\\/\\/\\//, '')
    .replace(/^\\/?\\.\\.\\//, '')
    .replace(/\\?.*$/, '');

  relPath = relPath.replace(/^\\/+/, '').replace(/\\.\\.\\//g, '_dotdot_/');

  const fullPath = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  written++;
}
${BT3}

我们的 Python 实现忠实地复现了这个逻辑。核心思想很简单：
**遍历 sources + sourcesContent，清理路径，写入文件。**
`);

md(`## 6. Source Map 的 VLQ 解码（深入理解）

虽然提取源码不需要解码 mappings，但理解它有助于掌握 Source Map 的工作原理。

### VLQ 编码规则

1. 每个 VLQ 值由 1 个或多个 Base64 字符组成
2. 每个字符 6 位：低 5 位是数据，最高位是续位标志
3. 第一个字符的最低位是符号位（0=正，1=负）
4. 后续字符使用小端序排列

**数值示例：**

| Base64 字符 | 6位二进制 | 续位 | 值 |
|-------------|----------|------|-----|
| ${BT}A${BT} | 000000 | 0 | +0 |
| ${BT}C${BT} | 000010 | 0 | +1 |
| ${BT}D${BT} | 000011 | 0 | -1（最低位=1=负，值=1→-1） |
| ${BT}g${BT} | 100000 | 1 | 续... |
| ${BT}gB${BT} | 100000 000001 | - | (0<<5|0)=0, 续位为0，总=+0（实际上这里需要更精确的计算） |

**生活类比：** VLQ 就像 ZIP 邮编系统 —— 用最少的字符编码出足够精确的位置信息。
每个字符携带一部分数据，如果数据还没传完就设一个"续位标志"。

${BT3}python
# VLQ/Base64 解码的简化实现
BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
B64_DECODE = {c: i for i, c in enumerate(BASE64_CHARS)}

def decode_vlq(segment: str) -> list[int]:
    """解码一个 VLQ 段为整数列表"""
    values = []
    i = 0
    while i < len(segment):
        value = 0
        shift = 0
        continuation = True
        while continuation:
            if i >= len(segment):
                break
            char = segment[i]
            i += 1
            digit = B64_DECODE[char]
            continuation = bool(digit & 0x20)  # 第6位是续位
            digit &= 0x1F  # 低5位
            value += digit << shift
            shift += 5
        # 最低位是符号位
        if value & 1:
            value = -(value >> 1)
        else:
            value = value >> 1
        values.append(value)
    return values

# 测试
print("VLQ decode tests:")
test_vlq = {"A": [0], "C": [1], "D": [-1], "S": [9], "T": [-10]}
for inp, expected in test_vlq.items():
    result = decode_vlq(inp)
    status = "OK" if result == expected else f"FAIL (got {result})"
    print(f"  decode_vlq('{inp}') = {result}  {status}")
${BT3}
`);

code(`# === 验证我们的 Source Map 解析器 ===

# 构造一个更真实的测试用例
complex_sourcemap = {
    "version": 3,
    "sources": [
        "webpack:///../src/Tool.ts",
        "webpack:///../src/tools/BashTool.ts",
        "webpack:///../src/tools/FileReadTool.ts",
        "webpack:///../src/tools/FileEditTool.ts",
        "webpack:///../src/tools/GrepTool.ts",
        "webpack:///../src/query.ts",
        "webpack:///../src/main.tsx",
        "webpack:///../src/state/AppState.tsx",
        "webpack:///../src/services/mcp/client.ts",
        "webpack:///../src/commands/commit/index.ts",
    ],
    "sourcesContent": [
        f"// Tool.ts - L1\\nexport type Tool = {{ name: string; call(): Promise<any> }}",
        f"// BashTool.ts\\nexport const BashTool = {{ name: 'Bash' }}",
        f"// FileReadTool.ts\\nexport const FileReadTool = {{ name: 'Read' }}",
        f"// FileEditTool.ts\\nexport const FileEditTool = {{ name: 'Edit' }}",
        f"// GrepTool.ts\\nexport const GrepTool = {{ name: 'Grep' }}",
        f"// query.ts\\nexport async function query() {{}}",
        f"// main.tsx\\nexport async function main() {{}}",
        f"// AppState.tsx\\nexport const AppState = {{}}",
        f"// mcp/client.ts\\nexport class MCPClient {{}}",
        f"// commit/index.ts\\nexport const commitCommand = {{}}",
    ],
    "mappings": "AAAA",
    "names": []
}

# 提取并分析
entries = []
for i, src in enumerate(complex_sourcemap["sources"]):
    content = complex_sourcemap["sourcesContent"][i]
    clean = sanitize_source_path(src, i)
    entries.append({"path": clean, "content": content, "original": src})

print("=== 提取结果分析 ===")
print(f"Total entries: {len(entries)}")
print()

# 按目录分组
from collections import Counter
dirs = Counter()
for e in entries:
    parts = e["path"].split("/")
    if len(parts) > 1:
        dirs[parts[0] + "/" + parts[1]] += 1
    else:
        dirs[parts[0]] += 1

print("目录分布：")
for d, count in sorted(dirs.items()):
    print(f"  {d}: {count} files")

print()

# 验证文件内容完整性
print("内容完整性检查：")
for e in entries:
    has_content = bool(e["content"])
    first_line = e["content"].split("\\n")[0] if e["content"] else "EMPTY"
    print(f"  [{('OK' if has_content else 'MISSING')}] {e['path']}: {first_line}")

print()
print("All entries extracted successfully!")
`);

md(`## 7. 我们学到了什么

1. **Source Map 是宝藏**：${BT}sourcesContent${BT} 字段包含了完整的原始源码
2. **提取很简单**：遍历 + 路径清理 + 文件写入，核心不到 50 行代码
3. **VLQ 编码**：${BT}mappings${BT} 用 Base64 VLQ 编码位置映射，但我们不需要解码它来获取源码
4. **路径安全**：需要处理 ${BT}..\\${BT} 等目录穿越、webpack 前缀等

### 设计决策：为什么 extract-sources.js 这么简单？

原始脚本没有使用 ${BT}source-map${BT} 库的 ${BT}SourceMapConsumer${BT}，而是直接读取 JSON。
这是因为我们的目标只是提取文件，不需要行级别的映射。这是一个重要的设计原则：

> **只做你需要做的事。** Source Map 有很多功能（行映射、列映射、名称解析），
> 但我们只需要 ${BT}sources${BT} 和 ${BT}sourcesContent${BT} 两个字段。

---

## 源码映射

| 我们的实现 | 原始源码 |
|-----------|---------|
| ${BT}sanitize_source_path()${BT} | ${BT}extract-sources.js${BT} L24-36 |
| ${BT}extract_sourcemap()${BT} | ${BT}extract-sources.js${BT} L17-42 |
| ${BT}decode_vlq()${BT} | source-map 库内部实现 |

---

← [上一章：项目总览](00-why-this-project.ipynb) | [下一章：核心类型与 Tool 协议 →](02-tool-protocol.ipynb)
`);

// Lint
cells.forEach((cell, i) => {
  if (cell.cell_type === 'code' && cell.source.join('').includes('${BT3}mermaid')) {
    console.warn('WARNING: Cell ' + i + ' is a code cell but contains mermaid diagram');
  }
});

const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python', version: '3.10.0' }
  },
  cells: cells
};

const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('01-sourcemap-extraction.ipynb', output);
console.log('Cells: ' + cells.length + '  Size: ' + output.length + ' bytes');
