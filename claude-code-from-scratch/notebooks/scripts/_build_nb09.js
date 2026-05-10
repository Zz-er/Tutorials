const fs = require('fs');
const cells = [];
const BT = '`'; const BT3 = '```';
function md(s) { cells.push({ cell_type:'markdown', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l) }); }
function code(s) { cells.push({ cell_type:'code', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l), outputs:[], execution_count:null }); }

md(`# Chapter 9: 完整集成 — 从零到一的 Claude Code

**本章你将学到：**
- 如何将前面 8 章的所有模块组装成一个完整系统
- 端到端的消息处理流程
- 完整架构的回顾与总结
- 扩展方向与深入学习路径

---

## 1. 完整架构回顾

经过 8 章的学习，我们构建了 Claude Code 的所有核心模块：

${BT3}mermaid
graph TB
    subgraph "Ch02: Tool Protocol"
        TOOL["Tool 基类"]
        BUILD["buildTool()"]
        REG["ToolRegistry"]
    end

    subgraph "Ch03-04: Core Tools"
        READ["Read"]
        EDIT["Edit"]
        GREP["Grep"]
        GLOB["Glob"]
        BASH["Bash"]
        PERM["PermissionChecker"]
    end

    subgraph "Ch05: Query Engine"
        MSG["Message Types"]
        QUERY["QueryEngine"]
        LOOP["Agentic Loop"]
    end

    subgraph "Ch06: Commands & Skills"
        CMD["CommandRegistry"]
        SKILL["SkillLoader"]
        FM["Frontmatter Parser"]
    end

    subgraph "Ch07: Extensions"
        MCP["MCPClient"]
        PLUGIN["PluginManager"]
    end

    subgraph "Ch08: State & UI"
        STATE["AppState"]
        UI["REPL UI"]
    end

    REG --> READ & EDIT & GREP & GLOB & BASH
    BASH --> PERM
    QUERY --> REG & MSG
    QUERY --> CMD & SKILL
    REG --> MCP
    MCP --> PLUGIN
    UI --> STATE & QUERY
${BT3}
`);

code(`# === 完整系统集成 ===
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.getcwd(), '..', 'our-implementation')))

import asyncio
import json
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any

# 导入所有模块
from tool_protocol import (
    Tool, ToolInput, ToolOutput, ToolResult, ToolUseContext,
    ValidationResult, PermissionResult, build_tool, ToolRegistry
)

print("All modules imported successfully!")
print()
print("Integration test: assembling the complete Claude Code system...")
`);

code(`# === 重新定义所有核心组件（自包含模式）===

# --- 消息系统 (Ch05) ---
@dataclass
class ContentBlock:
    type: str

@dataclass
class TextBlock(ContentBlock):
    type: str = "text"
    text: str = ""

@dataclass
class ToolUseBlock(ContentBlock):
    type: str = "tool_use"
    id: str = ""
    name: str = ""
    input: dict = field(default_factory=dict)

@dataclass
class ToolResultBlock(ContentBlock):
    type: str = "tool_result"
    tool_use_id: str = ""
    content: Any = ""

@dataclass
class Message:
    role: str
    content: list = field(default_factory=list)
    def add_text(self, t): self.content.append(TextBlock(text=t)); return self
    def add_tool_use(self, id, name, inp): self.content.append(ToolUseBlock(id=id, name=name, input=inp)); return self
    def add_tool_result(self, tid, r): self.content.append(ToolResultBlock(tool_use_id=tid, content=r)); return self
    def get_text(self): return "\\n".join(b.text for b in self.content if isinstance(b, TextBlock))
    def get_tool_uses(self): return [b for b in self.content if isinstance(b, ToolUseBlock)]

def user_msg(t): return Message(role="user").add_text(t)
def assistant_msg(t): return Message(role="assistant").add_text(t)

# --- 工具实现 (Ch03-04) ---
class ReadInput(ToolInput):
    file_path: str
    offset: int | None = None
    limit: int | None = None

class ReadTool(Tool):
    @property
    def name(self): return "Read"
    @property
    def input_schema(self): return ReadInput
    async def call(self, inp, ctx):
        p = Path(inp.file_path).expanduser().resolve()
        if not p.exists(): return ToolResult(data={"error": f"Not found: {p}"})
        lines = p.read_text(encoding='utf-8', errors='ignore').split('\\n')
        off = inp.offset or 0; lim = inp.limit or len(lines)
        sel = lines[off:off+lim]
        num = '\\n'.join(f"{i+off+1:4d}\\t{l}" for i, l in enumerate(sel))
        return ToolResult(data={"content": num, "total": len(lines)})
    async def description(self, inp, **kw): return "Read files"
    async def prompt(self, **kw): return "Read tool"
    def map_result(self, out, tid):
        return {"type":"tool_result","tool_use_id":tid,"content":[{"type":"text","text":out.get("content",out.get("error",""))}]}
    def is_concurrency_safe(self, _=None): return True
    def is_read_only(self, _=None): return True

class GrepInput(ToolInput):
    pattern: str
    path: str | None = None
    output_mode: str = "files_with_matches"

class GrepTool(Tool):
    @property
    def name(self): return "Grep"
    @property
    def input_schema(self): return GrepInput
    async def call(self, inp, ctx):
        import re
        d = Path(inp.path or '.').expanduser().resolve()
        pat = re.compile(inp.pattern)
        results = []
        for f in d.rglob('*'):
            if f.is_file() and '.git' not in str(f):
                try:
                    if pat.search(f.read_text(encoding='utf-8', errors='ignore')[:10000]):
                        results.append(str(f.relative_to(d)))
                        if len(results) >= 20: break
                except: continue
        return ToolResult(data={"content": '\\n'.join(results) or "No matches", "count": len(results)})
    async def description(self, inp, **kw): return "Search files"
    async def prompt(self, **kw): return "Grep tool"
    def map_result(self, out, tid):
        return {"type":"tool_result","tool_use_id":tid,"content":[{"type":"text","text":out.get("content","")}]}
    def is_concurrency_safe(self, _=None): return True
    def is_read_only(self, _=None): return True

class BashInput(ToolInput):
    command: str
    timeout: int | None = 120000

class BashTool(Tool):
    import subprocess
    @property
    def name(self): return "Bash"
    @property
    def input_schema(self): return BashInput
    async def call(self, inp, ctx):
        import subprocess
        try:
            r = subprocess.run(inp.command, shell=True, capture_output=True, text=True, timeout=30)
            return ToolResult(data={"stdout": r.stdout, "stderr": r.stderr, "exit_code": r.returncode})
        except Exception as e:
            return ToolResult(data={"stdout": "", "stderr": str(e), "exit_code": 1})
    async def description(self, inp, **kw): return "Execute commands"
    async def prompt(self, **kw): return "Bash tool"
    def map_result(self, out, tid):
        t = out.get("stdout","") + (f"\\nSTDERR: {out['stderr']}" if out.get("stderr") else "")
        return {"type":"tool_result","tool_use_id":tid,"content":[{"type":"text","text":t or "OK"}]}

print("All tools defined: Read, Grep, Bash")
`);

code(`# === 完整的端到端集成测试 ===

# 1. 创建 Tool Registry
registry = ToolRegistry()
registry.register(ReadTool())
registry.register(GrepTool())
registry.register(BashTool())

print(f"[1] Tool Registry: {registry}")
print(f"    Tools: {[t.name for t in registry.get_enabled()]}")
print()

# 2. 直接测试每个工具
ctx = ToolUseContext()

print("[2] Testing Read tool...")
import tempfile
with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
    f.write("line 1: hello\\nline 2: world\\nline 3: test\\n")
    tmp = f.name

r = asyncio.run(registry.get("Read").call(ReadInput(file_path=tmp), ctx))
print(f"    Read result: {r.data.get('content', '')[:80]}...")
print(f"    Total lines: {r.data.get('total', 0)}")
os.unlink(tmp)
print()

print("[3] Testing Grep tool...")
r = asyncio.run(registry.get("Grep").call(GrepInput(
    pattern="Tool",
    path="../../restored-src/src",
    output_mode="files_with_matches"
), ctx))
matches = r.data.get("content", "")
count = r.data.get("count", 0)
print(f"    Found {count} matches")
print(f"    Sample: {matches[:150]}...")
print()

print("[4] Testing Bash tool...")
r = asyncio.run(registry.get("Bash").call(BashInput(command="echo 'Integration test OK'"), ctx))
print(f"    stdout: {r.data['stdout'].strip()}")
print(f"    exit_code: {r.data['exit_code']}")
print()

# 3. 模拟完整的 Agentic Loop
print("[5] Simulating Agentic Loop...")

class SimpleQueryEngine:
    """简化版查询引擎 - 演示 agentic loop"""
    def __init__(self, registry: ToolRegistry):
        self.registry = registry
        self.history: list[Message] = []

    async def run(self, user_text: str, mock_responses: list[Message]) -> str:
        """
        用模拟的 LLM 响应演示完整的 agentic loop。

        mock_responses: 预定义的 LLM 响应序列
        """
        self.history.append(user_msg(user_text))
        output_lines = [f"User: {user_text}"]

        for i, mock_resp in enumerate(mock_responses):
            tool_uses = mock_resp.get_tool_uses()

            if not tool_uses:
                # 纯文本回复 - 完成
                self.history.append(mock_resp)
                output_lines.append(f"Assistant: {mock_resp.get_text()}")
                return "\\n".join(output_lines)

            # 有工具调用
            self.history.append(mock_resp)
            result_msg = Message(role="user")

            for tu in tool_uses:
                output_lines.append(f"  [Tool Call] {tu.name}({json.dumps(tu.input, ensure_ascii=False)[:60]})")

                tool = self.registry.get(tu.name)
                if not tool:
                    result_msg.add_tool_result(tu.id, f"Error: unknown tool {tu.name}")
                    output_lines.append(f"  [Error] Unknown tool: {tu.name}")
                    continue

                input_model = tool.input_schema(**tu.input)
                result = await tool.call(input_model, ctx)
                mapped = tool.map_result(result.data, tu.id)
                result_text = mapped["content"][0]["text"][:80]
                result_msg.add_tool_result(tu.id, mapped["content"][0]["text"])
                output_lines.append(f"  [Result] {result_text}...")

            self.history.append(result_msg)

        return "\\n".join(output_lines)


engine = SimpleQueryEngine(registry)

# 模拟场景：用户搜索 TODO
mock_responses = [
    # 第一轮：LLM 决定使用 Grep
    Message(role="assistant").add_tool_use(
        "toolu_001", "Grep", {"pattern": "TODO|FIXME", "path": "../../restored-src/src/tools", "output_mode": "files_with_matches"}
    ),
    # 第二轮：LLM 读取一个文件
    Message(role="assistant").add_tool_use(
        "toolu_002", "Read", {"file_path": "../../restored-src/src/Tool.ts", "offset": 0, "limit": 5}
    ),
    # 第三轮：LLM 总结
    assistant_msg("I found several TODO/FIXME comments in the codebase. The Tool.ts file defines the core tool protocol with 30+ methods. This is the foundation of Claude Code's extensibility."),
]

result = asyncio.run(engine.run(
    "Search for TODO comments in the tools directory and tell me about the Tool protocol",
    mock_responses
))

print(result)
`);

md(`## 2. 学到了什么：关键设计模式回顾

### 2.1 Agentic Loop（智能体循环）

这是整个系统的核心模式：

${BT3}
while not done:
    response = llm(messages, tools)
    if response.has_tool_calls:
        results = execute_tools(response.tool_calls)
        messages.append(results)
    else:
        return response.text
${BT3}

**为什么重要：** 这是 AI Agent 区别于普通聊天机器人的关键 —— 它可以"动手做事"。

### 2.2 Tool Protocol（工具协议）

统一的接口让系统具有无限扩展性：

- 新增工具：只需实现 Tool 接口
- 权限控制：checkPermissions 在执行前拦截
- 并发安全：isConcurrencySafe 决定调度策略

### 2.3 Permission System（权限系统）

三层安全架构：

1. **Deny** → 绝对禁止（优先级最高）
2. **Allow** → 始终允许（跳过询问）
3. **Ask** → 需要用户确认

### 2.4 Source Map Extraction（源码还原）

npm 包中的 Source Map 包含了完整的原始源码。这个技术教训告诉我们：
**发布到生产环境的代码应该剥离 Source Map，除非你有意公开源码。**

---

## 3. 扩展方向

基于你学到的知识，可以深入探索以下方向：

| 方向 | 建议阅读 |
|------|----------|
| 多 Agent 协调 | ${BT}coordinator/${BT} — Worker 管理 |
| Vim 模式 | ${BT}vim/${BT} — 状态机实现 |
| 语音交互 | ${BT}voice/${BT} — WebRTC |
| 远程会话 | ${BT}remote/${BT}, ${BT}bridge/${BT} — WebSocket |
| LSP 集成 | ${BT}tools/LSPTool/${BT} — 语言服务协议 |
| 条目搜索 | ${BT}tools/ToolSearchTool/${BT} — 延迟工具加载 |
| 任务系统 | ${BT}tasks/${BT} — 后台任务管理 |

---

## 4. 架构之美

Claude Code 是一个精心设计的系统，它的美在于：

1. **统一的工具协议** — 40+ 工具共享同一接口
2. **Agentic Loop** — 简单但强大的核心循环
3. **分层权限** — 安全与灵活的平衡
4. **MCP 开放协议** — 任何服务都可以接入
5. **React + Ink** — 用现代前端框架构建终端 UI

> 从 3698 个文件的代码库中，我们提炼出了 5 个核心设计模式。
> 这就是软件架构的本质 —— 复杂的系统中隐藏着简单的模式。

---

## 源码映射总结

| 章节 | 我们实现的模块 | 原始源码 |
|------|---------------|---------|
| Ch01 | Source Map 提取器 | ${BT}extract-sources.js${BT} |
| Ch02 | Tool 协议 + Registry | ${BT}Tool.ts${BT}, ${BT}tools.ts${BT} |
| Ch03 | Read/Edit/Grep/Glob | ${BT}tools/*${BT} |
| Ch04 | Bash + 权限系统 | ${BT}tools/BashTool/${BT}, ${BT}utils/permissions/${BT} |
| Ch05 | Query Engine + Messages | ${BT}query.ts${BT}, ${BT}types/message.ts${BT} |
| Ch06 | Commands + Skills | ${BT}commands/${BT}, ${BT}skills/${BT} |
| Ch07 | MCP + Plugins | ${BT}services/mcp/${BT}, ${BT}plugins/${BT} |
| Ch08 | AppState + UI | ${BT}state/${BT}, ${BT}components/${BT} |

---

← [上一章：状态管理](08-state-management-ui.ipynb)

**恭喜你完成了整个教程！** 从 Source Map 提取到完整的 Agent 系统，你已经深入理解了 Claude Code 的核心架构。
`);

cells.forEach((c,i)=>{if(c.cell_type==='code'&&c.source.join('').includes('${BT3}mermaid'))console.warn('WARN: cell '+i);});
const nb={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.10.0'}},cells};
const out=JSON.stringify(nb,null,1);
fs.writeFileSync('09-full-integration.ipynb',out);
console.log('Cells: '+cells.length+' Size: '+out.length);
