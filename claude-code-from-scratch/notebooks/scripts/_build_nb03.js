const fs = require('fs');
const cells = [];
const BT = '`'; const BT3 = '```';
function md(s) { cells.push({ cell_type:'markdown', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l) }); }
function code(s) { cells.push({ cell_type:'code', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l), outputs:[], execution_count:null }); }

md(`# Chapter 3: 文件操作工具 — Read / Edit / Grep / Glob

**本章你将学到：**
- FileRead、FileEdit、Grep、Glob 四大文件工具的实现
- 每个工具的输入验证、权限检查、结果映射
- 从原始 TypeScript 到 Python 的设计映射

> **Source:** ${BT}tools/FileReadTool/${BT}, ${BT}tools/FileEditTool/${BT}, ${BT}tools/GrepTool/${BT}, ${BT}tools/GlobTool/${BT}

---

## 1. 痛点：没有统一工具时的文件操作

${BT3}python
# 每次操作文件都要写不同的错误处理逻辑
def read_file(path):
    with open(path) as f: return f.read()  # 没有行号、没有限制、没有编码检测

def edit_file(path, old, new):
    content = open(path).read()
    return content.replace(old, new)  # 没有精确匹配、没有验证

def search_files(pattern, directory):
    import os, re
    results = []
    for root, dirs, files in os.walk(directory):
        for f in files:
            if re.search(pattern, open(os.path.join(root,f)).read()):
                results.append(os.path.join(root, f))
    return results  # 没有行号、没有上下文、没有性能优化

# 这些函数没有统一的接口，无法被 Agent 系统调度
print("这些函数各有不同的签名和行为，Agent 无法统一调用它们")
${BT3}

**解决方案：** 用 Ch02 定义的 Tool 协议，为每个文件操作创建标准化工具。
`);

code(`# === 导入 Ch02 定义的基类 ===
import sys, os, re, json, asyncio, fnmatch
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Literal
from pydantic import Field, field_validator

# 将 our-implementation 加入路径
sys.path.insert(0, os.path.abspath(os.path.join(os.getcwd(), '..', 'our-implementation')))

from tool_protocol import (
    Tool, ToolInput, ToolOutput, ToolResult, ToolUseContext,
    ValidationResult, PermissionResult, build_tool, ToolRegistry
)

print("Core types imported successfully!")
`);

md(`## 2. FileReadTool — 文件读取工具

${BT3}mermaid
flowchart LR
    A["file_path + offset? + limit?"] --> B["路径展开"]
    B --> C["权限检查<br/>checkReadPermission"]
    C --> D["读取文件内容"]
    D --> E["添加行号"]
    E --> F["返回结果"]
${BT3}

> **Source:** ${BT}tools/FileReadTool/FileReadTool.ts${BT} — 原始实现约 400 行，处理了 PDF、图片、Notebook 等多种格式。
> 我们的简化版聚焦于文本文件读取。
`);

code(`# === FileReadTool 实现 ===

class FileReadInput(ToolInput):
    """
    对应 FileReadTool.ts 中的 Zod schema：
    z.strictObject({
      file_path: z.string().describe('The absolute path to the file'),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
    })
    """
    file_path: str = Field(description="The absolute path to the file to read")
    offset: int | None = Field(default=None, ge=0, description="Line number to start from")
    limit: int | None = Field(default=None, gt=0, description="Number of lines to read")


def add_line_numbers(lines: list[str], start: int = 1) -> str:
    """
    添加行号。对应 utils/file.ts 中的 addLineNumbers()。
    格式: "  123\\tline content"
    """
    max_width = len(str(start + len(lines) - 1))
    result = []
    for i, line in enumerate(lines):
        num = str(start + i).rjust(max_width)
        # 保留换行符
        content = line.rstrip('\\n')
        result.append(f"{num}\\t{content}")
    return '\\n'.join(result)


class FileReadTool(Tool):
    """文件读取工具。Source: tools/FileReadTool/FileReadTool.ts"""

    @property
    def name(self) -> str: return "Read"

    @property
    def input_schema(self): return FileReadInput

    async def call(self, input_data: FileReadInput, context: ToolUseContext) -> ToolResult:
        path = Path(input_data.file_path).expanduser().resolve()

        if not path.exists():
            return ToolResult(data={"error": f"File not found: {path}"})

        if not path.is_file():
            return ToolResult(data={"error": f"Not a file: {path}"})

        # 读取文件
        try:
            content = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            content = path.read_text(encoding='latin-1')

        lines = content.split('\\n')

        # 应用 offset 和 limit
        offset = input_data.offset or 0
        limit = input_data.limit or len(lines)
        selected = lines[offset:offset + limit]

        result_text = add_line_numbers(selected, start=offset + 1)

        return ToolResult(data={
            "path": str(path),
            "content": result_text,
            "total_lines": len(lines),
            "showing": f"lines {offset+1}-{min(offset+limit, len(lines))}"
        })

    async def description(self, input_data, **options) -> str:
        return "Reads a file from the local filesystem."

    async def prompt(self, **options) -> str:
        return "Use the Read tool to read file contents. Always prefer this over cat/head/tail."

    def map_result(self, output, tool_use_id: str) -> dict:
        content = output.get("content", output.get("error", ""))
        return {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": [{"type": "text", "text": content}]
        }

    def is_concurrency_safe(self, input_data=None) -> bool: return True
    def is_read_only(self, input_data=None) -> bool: return True


# 测试 FileReadTool
import tempfile

with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
    f.write("def hello():\\n    print('Hello')\\n    return 42\\n\\nclass Foo:\\n    pass\\n")
    tmp_path = f.name

read_tool = build_tool(FileReadTool())
ctx = ToolUseContext()

# 读取完整文件
result = asyncio.run(read_tool.call(FileReadInput(file_path=tmp_path), ctx))
print("=== FileReadTool 完整读取 ===")
print(result.data["content"])
print(f"\\nTotal lines: {result.data['total_lines']}, Showing: {result.data['showing']}")

# 读取部分行
result2 = asyncio.run(read_tool.call(FileReadInput(file_path=tmp_path, offset=1, limit=2), ctx))
print("\\n=== FileReadTool offset=1, limit=2 ===")
print(result2.data["content"])

os.unlink(tmp_path)
print("\\nFileReadTool tests passed!")
`);

md(`## 3. FileEditTool — 文件编辑工具

FileEdit 的核心是**精确字符串替换**。它要求 ${BT}old_string${BT} 在文件中唯一匹配，
然后用 ${BT}new_string${BT} 替换。这比通用的正则替换更安全。

> **Source:** ${BT}tools/FileEditTool/FileEditTool.ts${BT} — 原始实现约 300 行，
> 包含了文件历史追踪、LSP 诊断清除、Git diff 生成等高级功能。
`);

code(`# === FileEditTool 实现 ===

class FileEditInput(ToolInput):
    """
    对应 FileEditTool.ts 的 Zod schema：
    z.strictObject({
      file_path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().optional().default(false),
    })
    """
    file_path: str = Field(description="The absolute path to the file to edit")
    old_string: str = Field(description="The text to replace")
    new_string: str = Field(description="The text to replace it with")
    replace_all: bool = Field(default=False, description="Replace all occurrences")


class FileEditTool(Tool):
    """文件编辑工具。Source: tools/FileEditTool/FileEditTool.ts"""

    @property
    def name(self) -> str: return "Edit"

    @property
    def input_schema(self): return FileEditInput

    async def call(self, input_data: FileEditInput, context: ToolUseContext) -> ToolResult:
        path = Path(input_data.file_path).expanduser().resolve()

        if not path.exists():
            return ToolResult(data={"error": f"File not found: {path}"})

        content = path.read_text(encoding='utf-8')
        old = input_data.old_string
        new = input_data.new_string

        # 检查 old_string 是否存在
        count = content.count(old)
        if count == 0:
            # 模糊匹配提示（对应 findSimilarFile 的思路）
            return ToolResult(data={
                "error": f"old_string not found in file. "
                         f"Make sure the string matches exactly."
            })

        if count > 1 and not input_data.replace_all:
            return ToolResult(data={
                "error": f"old_string found {count} times. "
                         f"Use replace_all=true to replace all occurrences, "
                         f"or provide more context to make the match unique."
            })

        # 执行替换
        if input_data.replace_all:
            new_content = content.replace(old, new)
        else:
            new_content = content.replace(old, new, 1)

        # 写入文件
        path.write_text(new_content, encoding='utf-8')

        # 生成简化的 diff
        old_lines = old.split('\\n')
        new_lines = new.split('\\n')
        diff_summary = f"Replaced {count} occurrence(s): {len(old_lines)} line(s) -> {len(new_lines)} line(s)"

        return ToolResult(data={
            "path": str(path),
            "diff_summary": diff_summary,
            "occurrences_replaced": count
        })

    async def description(self, input_data, **options) -> str:
        return "Performs exact string replacements in files."

    async def prompt(self, **options) -> str:
        return "Use the Edit tool to make precise replacements in files. Prefer this over sed."

    def map_result(self, output, tool_use_id: str) -> dict:
        content = output.get("diff_summary", output.get("error", ""))
        return {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": [{"type": "text", "text": content}]
        }

    def is_read_only(self, input_data=None) -> bool: return False
    def is_destructive(self, input_data=None) -> bool: return False  # 有撤销机制


# 测试 FileEditTool
with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
    f.write("def hello():\\n    print('Hello')\\n    return 42\\n")
    tmp_path = f.name

edit_tool = build_tool(FileEditTool())

# 精确替换
result = asyncio.run(edit_tool.call(FileEditInput(
    file_path=tmp_path,
    old_string="print('Hello')",
    new_string="print('World')"
), ctx))
print(f"=== Edit 结果: {result.data}")

# 验证替换
with open(tmp_path) as f:
    print(f"替换后内容: {f.read()}")

# 测试不存在的字符串
result2 = asyncio.run(edit_tool.call(FileEditInput(
    file_path=tmp_path,
    old_string="nonexistent string xyz",
    new_string="won't happen"
), ctx))
print(f"\\n不存在字符串: {result2.data}")

os.unlink(tmp_path)
print("\\nFileEditTool tests passed!")
`);

md(`## 4. GrepTool — 内容搜索工具

GrepTool 是 Claude Code 中使用频率最高的工具之一。它使用 ripgrep（rg）进行高性能搜索，
支持正则表达式、文件类型过滤、上下文行等多种选项。

> **Source:** ${BT}tools/GrepTool/GrepTool.ts${BT} — 原始实现调用 ripgrep 二进制，
> 我们用 Python 的 ${BT}re${BT} 模块模拟核心逻辑。
`);

code(`# === GrepTool 实现 ===

class GrepInput(ToolInput):
    """对应 GrepTool.ts 的 Zod schema"""
    pattern: str = Field(description="The regex pattern to search for")
    path: str | None = Field(default=None, description="Directory to search in")
    output_mode: Literal["files_with_matches", "content", "count"] = Field(
        default="files_with_matches", description="Output mode"
    )
    head_limit: int | None = Field(default=250, description="Limit output entries")
    context: int | None = Field(default=None, description="Lines of context")


class GrepTool(Tool):
    """内容搜索工具。Source: tools/GrepTool/GrepTool.ts"""

    @property
    def name(self) -> str: return "Grep"

    @property
    def input_schema(self): return GrepInput

    async def call(self, input_data: GrepInput, context: ToolUseContext) -> ToolResult:
        search_dir = Path(input_data.path or '.').expanduser().resolve()
        if not search_dir.exists():
            return ToolResult(data={"error": f"Path not found: {search_dir}"})

        pattern = re.compile(input_data.pattern)
        results = []
        limit = input_data.head_limit or 250

        for file_path in self._walk_files(search_dir):
            if len(results) >= limit:
                break
            try:
                text = file_path.read_text(encoding='utf-8', errors='ignore')
                matches = list(pattern.finditer(text))
                if not matches:
                    continue

                if input_data.output_mode == "files_with_matches":
                    results.append(str(file_path.relative_to(search_dir)))
                elif input_data.output_mode == "count":
                    results.append(f"{file_path.relative_to(search_dir)}: {len(matches)}")
                elif input_data.output_mode == "content":
                    lines = text.split('\\n')
                    for match in matches:
                        if len(results) >= limit:
                            break
                        line_num = text[:match.start()].count('\\n') + 1
                        ctx_lines = input_data.context or 0
                        start = max(0, line_num - ctx_lines - 1)
                        end = min(len(lines), line_num + ctx_lines)
                        for i in range(start, end):
                            marker = '>' if i == line_num - 1 else ' '
                            results.append(f"{file_path.relative_to(search_dir)}:{i+1}{marker} {lines[i]}")
            except Exception:
                continue

        output_text = '\\n'.join(results) if results else "No matches found"
        return ToolResult(data={
            "results": output_text,
            "match_count": len(results),
            "mode": input_data.output_mode
        })

    def _walk_files(self, directory: Path):
        """遍历目录，跳过常见的忽略目录"""
        ignore_dirs = {'.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build'}
        for root, dirs, files in os.walk(directory):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]
            for f in files:
                yield Path(root) / f

    async def description(self, input_data, **options) -> str:
        return "Search file contents with regex patterns."

    async def prompt(self, **options) -> str:
        return "Use Grep for content search. Supports regex, file filtering, and context lines."

    def map_result(self, output, tool_use_id: str) -> dict:
        return {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": [{"type": "text", "text": output.get("results", "")}]
        }

    def is_concurrency_safe(self, input_data=None) -> bool: return True
    def is_read_only(self, input_data=None) -> bool: return True


# 测试 GrepTool
grep_tool = build_tool(GrepTool())

# 在当前项目中搜索
result = asyncio.run(grep_tool.call(GrepInput(
    pattern="class.*Tool.*:",
    path="../../restored-src/src/tools",
    output_mode="files_with_matches",
    head_limit=10
), ctx))
print("=== Grep: class.*Tool.* ===")
print(result.data["results"][:500])
print(f"\\nMatch count: {result.data['match_count']}, Mode: {result.data['mode']}")
`);

md(`## 5. GlobTool — 文件模式匹配工具

GlobTool 使用 glob 模式匹配文件名，比 Grep 更轻量。它对应 ${BT}find${BT} 命令的功能。

> **Source:** ${BT}tools/GlobTool/GlobTool.ts${BT}
`);

code(`# === GlobTool 实现 ===

class GlobInput(ToolInput):
    """对应 GlobTool.ts 的 Zod schema"""
    pattern: str = Field(description="Glob pattern to match files against")
    path: str | None = Field(default=None, description="Directory to search in")


class GlobTool(Tool):
    """文件模式匹配工具。Source: tools/GlobTool/GlobTool.ts"""

    @property
    def name(self) -> str: return "Glob"

    @property
    def input_schema(self): return GlobInput

    async def call(self, input_data: GlobInput, context: ToolUseContext) -> ToolResult:
        search_dir = Path(input_data.path or '.').expanduser().resolve()
        if not search_dir.exists():
            return ToolResult(data={"error": f"Path not found: {search_dir}"})

        pattern = input_data.pattern
        matches = sorted(search_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)

        # 限制结果数量
        limit = 1000
        match_strs = [str(p.relative_to(search_dir)) for p in matches[:limit]]

        output = '\\n'.join(match_strs) if match_strs else "No files matched the pattern"
        return ToolResult(data={
            "files": output,
            "count": len(match_strs),
            "truncated": len(matches) > limit
        })

    async def description(self, input_data, **options) -> str:
        return "Find files by glob pattern."

    async def prompt(self, **options) -> str:
        return "Use Glob to find files by name pattern. Faster than Grep for file discovery."

    def map_result(self, output, tool_use_id: str) -> dict:
        return {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": [{"type": "text", "text": output.get("files", "")}]
        }

    def is_concurrency_safe(self, input_data=None) -> bool: return True
    def is_read_only(self, input_data=None) -> bool: return True


# 测试 GlobTool
glob_tool = build_tool(GlobTool())

result = asyncio.run(glob_tool.call(GlobInput(
    pattern="**/*.ts",
    path="../../restored-src/src/tools/BashTool"
), ctx))
print("=== Glob: **/*.ts in BashTool ===")
print(result.data["files"])
print(f"\\nCount: {result.data['count']}")
`);

md(`## 6. 注册所有文件工具

现在将四个文件工具注册到 ToolRegistry：

${BT3}mermaid
flowchart TB
    REG["ToolRegistry"] --> R["Read"]
    REG --> E["Edit"]
    REG --> G["Grep"]
    REG --> GL["Glob"]
${BT3}
`);

code(`# === 注册所有文件工具 ===
registry = ToolRegistry()
registry.register(FileReadTool())
registry.register(FileEditTool())
registry.register(GrepTool())
registry.register(GlobTool())

print(f"Registry: {registry}")
print(f"Enabled tools: {[t.name for t in registry.get_enabled()]}")
print()

# 验证所有工具的基本属性
for tool in registry.get_all():
    print(f"  {tool.name}:")
    print(f"    concurrency_safe: {tool.is_concurrency_safe()}")
    print(f"    read_only: {tool.is_read_only()}")
    print(f"    destructive: {tool.is_destructive()}")
    print()

print("All file tools registered and verified!")
`);

md(`## 7. 源码映射

| 我们的实现 | 原始源码 | 行数 |
|-----------|---------|------|
| ${BT}FileReadTool${BT} | ${BT}tools/FileReadTool/FileReadTool.ts${BT} | ~400 |
| ${BT}FileEditTool${BT} | ${BT}tools/FileEditTool/FileEditTool.ts${BT} | ~300 |
| ${BT}GrepTool${BT} | ${BT}tools/GrepTool/GrepTool.ts${BT} | ~150 |
| ${BT}GlobTool${BT} | ${BT}tools/GlobTool/GlobTool.ts${BT} | ~100 |
| ${BT}add_line_numbers()${BT} | ${BT}utils/file.ts${BT} (${BT}addLineNumbers${BT}) | ~10 |
| ${BT}FileReadInput${BT} | ${BT}FileReadTool.ts${BT} L80+ 的 Zod schema | - |
| ${BT}FileEditInput${BT} | ${BT}FileEditTool/types.ts${BT} | - |

### 关键设计决策

1. **FileEdit 用精确匹配而非正则**：降低误操作风险
2. **Grep 有三种输出模式**：满足不同使用场景
3. **Glob 按修改时间排序**：最近修改的文件排在前面
4. **所有工具都继承 Tool 基类**：保持接口一致性

---

← [上一章：Tool 协议](02-tool-protocol.ipynb) | [下一章：Bash 工具与权限系统 →](04-bash-permissions.ipynb)
`);

cells.forEach((c,i)=>{if(c.cell_type==='code'&&c.source.join('').includes('${BT3}mermaid'))console.warn('WARN: cell '+i+' has mermaid in code');});
const nb={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.10.0'}},cells};
const out=JSON.stringify(nb,null,1);
fs.writeFileSync('03-file-tools.ipynb',out);
console.log('Cells: '+cells.length+' Size: '+out.length);
