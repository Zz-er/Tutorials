const fs = require('fs');
const cells = [];
const BT = '`'; const BT3 = '```';
function md(s) { cells.push({ cell_type:'markdown', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l) }); }
function code(s) { cells.push({ cell_type:'code', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l), outputs:[], execution_count:null }); }

md(`# Chapter 5: 查询引擎 — 对话循环

**本章你将学到：**
- Agentic Loop（智能体循环）的核心工作原理 —— Claude Code 的心脏
- 消息类型及其在 API 协议中的角色
- 工具编排：tool_use → 执行 → tool_result → 继续
- 流式响应模拟与内容增量事件
- 上下文窗口填满时的自动压缩策略
- 用 Python 实现完整的 ${BT}QueryEngine${BT} 类

> **Source:** ${BT}query.ts${BT} (L219-L1729), ${BT}QueryEngine.ts${BT} (L184-L1178)

---

## 1. 为什么简单的请求-响应模式行不通

想象用户要求 Claude"读取一个文件并总结它"。单次 API 调用是不够的 ——
模型首先需要调用 ${BT}Read${BT} 工具，看到结果后，才能生成总结。
`);

md(`### 痛点展示

${BT3}python
# 朴素方案：一次 API 调用
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    messages=[{"role": "user", "content": "Read main.py and summarize it"}],
)
# 问题：模型返回的是 tool_use 块，而不是答案！
# 我们需要一个循环：
#   1. 发送消息给 API
#   2. 检查响应是否包含 tool_use 块
#   3. 执行这些工具
#   4. 将 tool_result 加回消息列表
#   5. 再次调用 API
#   6. 重复直到模型返回纯文本响应
${BT3}

这就是 **Agentic Loop（智能体循环）模式** —— 每个 AI Agent 框架的核心。

${BT3}mermaid
sequenceDiagram
    participant U as 用户
    participant Q as 查询循环
    participant A as Anthropic API
    participant T as 工具执行器

    U->>Q: "读取 main.py 并总结"
    Q->>A: messages=[user_msg] + tools=[Read, Bash, ...]
    A-->>Q: assistant_msg 包含 tool_use: {name: "Read", input: {file_path: "main.py"}}
    Q->>T: 执行 Read 工具
    T-->>Q: tool_result: "文件内容..."
    Q->>A: messages=[user_msg, assistant_msg, tool_result_msg]
    A-->>Q: assistant_msg 包含文本: "以下是总结..."
    Q->>U: 展示总结
${BT3}
`);

md(`## 2. 消息类型体系

Anthropic Messages API 使用一组消息和内容块类型。Claude Code 定义了自己的内部类型来包装它们。

> **Source:** ${BT}utils/messages.ts${BT}, SDK 类型来自 ${BT}@anthropic-ai/sdk${BT}

### 消息角色

| 类型 | 角色 | 用途 |
|------|------|------|
| ${BT}UserMessage${BT} | ${BT}"user"${BT} | 用户输入、工具结果、附件 |
| ${BT}AssistantMessage${BT} | ${BT}"assistant"${BT} | 模型响应（文本 + tool_use 块） |
| ${BT}SystemMessage${BT} | 内部使用 | 压缩边界、API 错误、元数据 |

### 消息中的内容块

| 块类型 | 出现在 | 用途 |
|--------|--------|------|
| ${BT}text${BT} | User, Assistant | 纯文本内容 |
| ${BT}tool_use${BT} | Assistant | 模型请求调用工具 |
| ${BT}tool_result${BT} | User | 工具执行的结果 |
| ${BT}thinking${BT} | Assistant | 扩展思考内容 |
| ${BT}image${BT} | User | 图片内容 |

### 关键配对：tool_use 和 tool_result

${BT3}python
# tool_use 块（来自 assistant 消息）
tool_use_block = {
    "type": "tool_use",
    "id": "toolu_01A09q90qw90lq917835lq9",
    "name": "Read",              # 要调用哪个工具
    "input": {                    # 工具参数
        "file_path": "/src/main.py"
    }
}

# tool_result 块（作为 user 消息内容发回）
tool_result_block = {
    "type": "tool_result",
    "tool_use_id": "toolu_01A09q90qw90lq917835lq9",  # 必须匹配！
    "content": "import os\\nprint('hello')",            # 工具输出
    "is_error": false                                   # 错误标志
}
${BT3}

**生活类比：** tool_use 就像你请一个助手"去拿那个文件"，
tool_result 就是助手把文件内容带回来给你。你拿到内容后才能继续工作。
`);

code(`# === Python 版消息类型定义 ===
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal, Union
import json
import uuid
import time


@dataclass
class TextBlock:
    """纯文本内容块"""
    type: str = "text"
    text: str = ""


@dataclass
class ToolUseBlock:
    """模型请求工具执行。Source: SDK ToolUseBlock"""
    type: str = "tool_use"
    id: str = ""
    name: str = ""
    input: dict = field(default_factory=dict)


@dataclass
class ToolResultBlock:
    """工具执行结果发回给模型。Source: SDK ToolResultBlockParam"""
    type: str = "tool_result"
    tool_use_id: str = ""
    content: str | list[dict] = ""
    is_error: bool = False


ContentBlock = Union[TextBlock, ToolUseBlock, ToolResultBlock]


@dataclass
class Message:
    """消息基类。Source: types/message.ts"""
    role: Literal["user", "assistant"]
    content: list[ContentBlock] = field(default_factory=list)


def make_user_message(*blocks: ContentBlock) -> Message:
    """创建用户消息"""
    return Message(role="user", content=list(blocks))

def make_assistant_message(*blocks: ContentBlock) -> Message:
    """创建助手消息"""
    return Message(role="assistant", content=list(blocks))

def make_text_user_message(text: str) -> Message:
    """便捷方法：创建包含单个文本块的用户消息"""
    return make_user_message(TextBlock(text=text))


# 演示消息类型
print("=== 消息类型演示 ===")
print()

user_msg = make_text_user_message("读取 main.py 并总结")
print(f"用户消息: role={user_msg.role}, blocks={len(user_msg.content)}")
print(f"  首个块: type={user_msg.content[0].type}, text='{user_msg.content[0].text[:30]}...'")
print()

# 助手回复 tool_use
assistant_msg = make_assistant_message(
    TextBlock(text="我来读取那个文件。"),
    ToolUseBlock(id="toolu_abc123", name="Read", input={"file_path": "/src/main.py"})
)
print(f"助手消息: role={assistant_msg.role}, blocks={len(assistant_msg.content)}")
for block in assistant_msg.content:
    if block.type == "tool_use":
        print(f"  ToolUse: name={block.name}, input={block.input}")
    else:
        print(f"  Text: '{block.text[:30]}...'")
print()

# 用户发回 tool_result
tool_result_msg = make_user_message(
    ToolResultBlock(tool_use_id="toolu_abc123", content="import os\\nprint('hello')")
)
print(f"工具结果消息: role={tool_result_msg.role}")
print(f"  ToolResult: tool_use_id={tool_result_msg.content[0].tool_use_id}")
print(f"  Content: '{tool_result_msg.content[0].content}'")
`);

md(`## 3. 查询循环

查询循环是 Claude Code 的核心算法。它在 ${BT}query.ts${BT} 中实现为异步生成器（L219-L1729，约 1500 行）。

### 简化算法流程

${BT3}mermaid
flowchart TD
    START(["用户发送消息"]) --> BUILD["构建消息数组<br/>+ 系统提示"]
    BUILD --> CALL["调用 Anthropic API<br/>（流式）"]
    CALL --> CHECK{"响应包含<br/>tool_use 块？"}
    CHECK -- 是 --> EXEC["执行工具<br/>（权限检查等）"]
    EXEC --> RESULT["添加 tool_result<br/>到消息列表"]
    RESULT --> COMPACT{"上下文窗口<br/>满了？"}
    COMPACT -- 是 --> SUMMARIZE["压缩：总结<br/>旧消息"]
    SUMMARIZE --> CALL
    COMPACT -- 否 --> CALL
    CHECK -- 否 --> DONE["返回文本响应<br/>给用户"]
    DONE(["本轮结束"])
${BT3}

### 源码中的关键细节

真实的 ${BT}query()${BT} 函数处理了许多边界情况：
- **流式响应**：响应以 SSE 事件到达，而非一次性返回
- **模型降级**：主模型失败时使用备用模型重试
- **输出截断恢复**：输出被截断时发送恢复消息继续
- **停止钩子**：可以阻止或修改响应的后处理钩子
- **中断处理**：用户可以在流式传输中按 Ctrl+C 中断
`);

code(`# === 简化版查询循环实现 ===
import asyncio
from typing import AsyncGenerator


# --- 模拟 API 客户端 ---
# 真实的 Claude Code 中，这里调用 Anthropic Messages API。
# 我们模拟它，以演示循环而无需 API Key。

class SimulatedAPIClient:
    """
    模拟 Anthropic Messages API。
    真实实现在 services/api/claude.ts
    """

    def __init__(self):
        self.call_count = 0
        # 模拟文件系统供 Read 工具使用
        self.fake_files = {
            "/src/main.py": "import os\\nimport sys\\n\\ndef main():\\n    print('Hello from Claude Code!')\\n    print(f'Python {sys.version}')\\n\\nif __name__ == '__main__':\\n    main()",
            "/src/utils.py": "def helper(x):\\n    return x * 2",
        }

    async def create_message(
        self,
        messages: list[Message],
        system_prompt: str = "",
        tools: list[dict] | None = None,
    ) -> AsyncGenerator[dict, None]:
        """
        模拟流式 API 响应。
        逐个产出内容块。

        真实 API 返回 SSE 事件：
          message_start, content_block_start, content_block_delta,
          content_block_stop, message_delta, message_stop
        """
        self.call_count += 1

        # 找到最后一条用户文本消息
        last_user_msg = None
        for msg in reversed(messages):
            if msg.role == "user":
                for block in msg.content:
                    if isinstance(block, TextBlock) and block.text:
                        last_user_msg = block.text
                        break
                if last_user_msg:
                    break

        # 检查是否有待处理的工具结果
        last_tool_result = None
        for msg in reversed(messages):
            if msg.role == "user":
                for block in msg.content:
                    if isinstance(block, ToolResultBlock):
                        last_tool_result = block.content
                        break

        if last_tool_result and self.call_count <= 3:
            # 有工具结果，现在提供文本总结
            yield {
                "type": "content_block",
                "block": TextBlock(
                    text=f"根据文件内容，以下是总结：\\n\\n"
                         f"代码包含一个 main 函数，打印问候语和 Python 版本信息。"
                         f"使用了标准库模块（os, sys）。代码结构清晰，"
                         f"有规范的 ${BT}if __name__ == '__main__'${BT} 入口守卫。"
                )
            }
        elif last_user_msg and "read" in last_user_msg.lower():
            # 第一次调用：模型决定使用工具
            yield {
                "type": "content_block",
                "block": TextBlock(text="我来读取那个文件。")
            }
            yield {
                "type": "content_block",
                "block": ToolUseBlock(
                    id=f"toolu_{uuid.uuid4().hex[:12]}",
                    name="Read",
                    input={"file_path": "/src/main.py"}
                )
            }
        else:
            # 默认文本回复
            yield {
                "type": "content_block",
                "block": TextBlock(text="有什么我可以帮你的？")
            }


# --- 工具执行器 ---
class SimpleToolExecutor:
    """
    执行工具并返回结果。
    真实实现在 services/tools/toolOrchestration.ts
    """

    def __init__(self, api_client: SimulatedAPIClient):
        self.api_client = api_client

    async def execute(self, tool_use: ToolUseBlock) -> ToolResultBlock:
        """执行工具并返回结果"""
        if tool_use.name == "Read":
            file_path = tool_use.input.get("file_path", "")
            content = self.api_client.fake_files.get(
                file_path,
                f"Error: 文件未找到: {file_path}"
            )
            return ToolResultBlock(
                tool_use_id=tool_use.id,
                content=content,
                is_error=file_path not in self.api_client.fake_files
            )
        else:
            return ToolResultBlock(
                tool_use_id=tool_use.id,
                content=f"未知工具: {tool_use.name}",
                is_error=True
            )


print("SimulatedAPIClient 和 SimpleToolExecutor 已定义！")
print("它们模拟了真实的 API 和工具执行，无需网络调用。")
`);

md(`## 4. 用 Python 实现核心循环

现在让我们实现查询引擎的心脏 —— 迭代处理 tool_use 块的智能体循环。

> **Source:** ${BT}query.ts${BT} L307-L1728 (${BT}while (true)${BT} 循环 + 状态管理)
`);

code(`# === 智能体循环（Agentic Loop）===

class QueryLoop:
    """
    Python 版查询循环实现。
    Source: query.ts L219-L1729

    真实实现约 1500 行，处理：
    - 流式 SSE 解析
    - 模型降级
    - 输出截断恢复
    - 自动压缩
    - 停止钩子
    - 中断处理
    - Token 预算追踪

    我们的简化版本演示核心模式。
    """

    def __init__(
        self,
        api_client: SimulatedAPIClient,
        tool_executor: SimpleToolExecutor,
        system_prompt: str = "你是一个有帮助的编程助手。",
        max_turns: int = 10,
    ):
        self.api_client = api_client
        self.tool_executor = tool_executor
        self.system_prompt = system_prompt
        self.max_turns = max_turns
        self.conversation: list[Message] = []

    async def run(self, user_text: str) -> str:
        """
        运行一次完整的查询回合。

        对应 query.ts L307 的 while(true) 循环。
        每次迭代要么：
          1. 获得文本响应（完成）
          2. 获得 tool_use 块 → 执行 → 继续
        """
        # 添加用户消息
        self.conversation.append(make_text_user_message(user_text))

        turn_count = 0
        final_text = ""

        while turn_count < self.max_turns:
            turn_count += 1
            print(f"  [回合 {turn_count}] 调用 API，消息数={len(self.conversation)}...")

            # 步骤 1：调用 API（模拟流式）
            assistant_blocks: list[ContentBlock] = []
            tool_use_blocks: list[ToolUseBlock] = []

            async for event in self.api_client.create_message(
                messages=self.conversation,
                system_prompt=self.system_prompt,
            ):
                block = event["block"]
                assistant_blocks.append(block)
                if isinstance(block, ToolUseBlock):
                    tool_use_blocks.append(block)

            # 将助手消息加入对话
            assistant_msg = make_assistant_message(*assistant_blocks)
            self.conversation.append(assistant_msg)

            # 步骤 2：检查是否需要执行工具
            if not tool_use_blocks:
                # 没有工具调用 —— 提取文本并返回
                for block in assistant_blocks:
                    if isinstance(block, TextBlock):
                        final_text += block.text
                print(f"  [回合 {turn_count}] 获得文本响应（无工具调用）")
                break

            # 步骤 3：执行工具并收集结果
            print(f"  [回合 {turn_count}] 模型请求了 {len(tool_use_blocks)} 个工具调用")
            result_blocks: list[ToolResultBlock] = []
            for tool_use in tool_use_blocks:
                print(f"    执行: {tool_use.name}({json.dumps(tool_use.input, ensure_ascii=False)})")
                result = await self.tool_executor.execute(tool_use)
                result_blocks.append(result)
                status = "错误" if result.is_error else "成功"
                content_preview = str(result.content)[:60]
                print(f"    结果 [{status}]: {content_preview}...")

            # 步骤 4：将工具结果作为 user 消息添加
            tool_result_msg = make_user_message(*result_blocks)
            self.conversation.append(tool_result_msg)

            # 步骤 5：检查上下文大小（简化版）
            total_chars = sum(
                len(str(block)) for msg in self.conversation
                for block in msg.content
            )
            print(f"  [回合 {turn_count}] 上下文大小: ~{total_chars} 字符")

        return final_text


# 运行查询循环
api = SimulatedAPIClient()
executor = SimpleToolExecutor(api)
loop = QueryLoop(api, executor)

print("=== 运行查询循环 ===")
print()
result = asyncio.run(loop.run("Read main.py and summarize it"))
print()
print("=== 最终结果 ===")
print(result)
print()
print(f"API 调用次数: {api.call_count}")
print(f"对话消息数: {len(loop.conversation)}")
`);

md(`## 5. 流式响应模拟

真实的 Claude Code 使用 Server-Sent Events (SSE) 进行流式传输。以下是概念说明：

### SSE 事件类型

| 事件 | 用途 |
|------|------|
| ${BT}message_start${BT} | 开始新消息，包含角色和使用量 |
| ${BT}content_block_start${BT} | 开始新内容块（text/tool_use/thinking） |
| ${BT}content_block_delta${BT} | 增量内容（文本增量、输入 JSON 增量） |
| ${BT}content_block_stop${BT} | 结束当前内容块 |
| ${BT}message_delta${BT} | 最终使用量 + stop_reason |
| ${BT}message_stop${BT} | 消息结束 |

### 流式传输中的工具输入累积

工具使用的输入以 JSON 增量方式逐块到达，客户端将它们累积为完整的 JSON 对象：

${BT3}python
# 流式累积 tool_use 输入
# 增量逐字符到达：
#   delta 1: '{"file'
#   delta 2: '_path'
#   delta 3: '":"/sr'
#   delta 4: 'c/mai'
#   delta 5: 'n.py"}'
# 累积结果: '{"file_path":"/src/main.py"}'
${BT3}

**生活类比：** 就像看直播字幕 —— 文字不是一整段出现的，而是一个字一个字蹦出来的。
你不需要等全部播完才开始理解，每一小段就可以开始处理。

> **Source:** ${BT}services/api/claude.ts${BT} 处理 SSE 解析和 tool_use 累积。
`);

code(`# === 流式传输模拟 ===
import time


class StreamingSimulator:
    """
    模拟真实 API 的流式响应。

    真实实现（services/api/claude.ts）中，响应以 SSE 事件到达。
    客户端解析并累积：
    - 文本内容：拼接文本增量
    - 工具使用：累积 JSON 输入增量
    - 思考：累积思考文本
    """

    def __init__(self, response_blocks: list[ContentBlock]):
        self.blocks = response_blocks

    async def stream(self) -> AsyncGenerator[dict, None]:
        """
        模拟流式传输，逐步产出事件。

        真实 SSE 事件序列：
          message_start -> content_block_start -> content_block_delta(s)
          -> content_block_stop -> message_delta -> message_stop
        """
        # message_start
        yield {
            "type": "message_start",
            "message": {"role": "assistant", "usage": {"input_tokens": 100}}
        }

        for i, block in enumerate(self.blocks):
            # content_block_start
            yield {"type": "content_block_start", "index": i, "block": block}

            if isinstance(block, TextBlock):
                # 按词流式传输文本
                words = block.text.split(" ")
                for j, word in enumerate(words):
                    chunk = word if j == 0 else " " + word
                    yield {
                        "type": "content_block_delta",
                        "index": i,
                        "delta": {"type": "text_delta", "text": chunk}
                    }
                    await asyncio.sleep(0.01)  # 模拟网络延迟

            elif isinstance(block, ToolUseBlock):
                # 逐步流式传输工具输入 JSON
                input_json = json.dumps(block.input)
                chunk_size = max(1, len(input_json) // 5)
                for start in range(0, len(input_json), chunk_size):
                    chunk = input_json[start:start + chunk_size]
                    yield {
                        "type": "content_block_delta",
                        "index": i,
                        "delta": {
                            "type": "input_json_delta",
                            "partial_json": chunk
                        }
                    }
                    await asyncio.sleep(0.01)

            # content_block_stop
            yield {"type": "content_block_stop", "index": i}

        # message_delta + message_stop
        has_tool = any(isinstance(b, ToolUseBlock) for b in self.blocks)
        yield {
            "type": "message_delta",
            "delta": {"stop_reason": "tool_use" if has_tool else "end_turn"},
            "usage": {"output_tokens": 50}
        }
        yield {"type": "message_stop"}


# 演示流式传输
async def demo_streaming():
    blocks = [
        TextBlock(text="我来读取那个文件。"),
        ToolUseBlock(id="toolu_stream_001", name="Read", input={"file_path": "/src/main.py"}),
    ]

    simulator = StreamingSimulator(blocks)

    accumulated_text = ""
    accumulated_json = ""
    tool_name = ""
    stop_reason = None

    print("=== 流式事件 ===")
    async for event in simulator.stream():
        if event["type"] == "content_block_start":
            block = event["block"]
            if isinstance(block, TextBlock):
                print(f"  [content_block_start] 文本块")
            elif isinstance(block, ToolUseBlock):
                tool_name = block.name
                print(f"  [content_block_start] tool_use 块: {block.name}")

        elif event["type"] == "content_block_delta":
            delta = event["delta"]
            if delta["type"] == "text_delta":
                accumulated_text += delta["text"]
            elif delta["type"] == "input_json_delta":
                accumulated_json += delta["partial_json"]

        elif event["type"] == "content_block_stop":
            if accumulated_text:
                print(f"  [文本累积完成] '{accumulated_text[:50]}...'")
                accumulated_text = ""
            if accumulated_json:
                print(f"  [工具 JSON 累积完成] {accumulated_json}")
                accumulated_json = ""

        elif event["type"] == "message_delta":
            stop_reason = event["delta"]["stop_reason"]
            print(f"  [message_delta] stop_reason={stop_reason}")

        elif event["type"] == "message_stop":
            print(f"  [message_stop] 流式传输完成")

    print(f"\\n最终 stop_reason: {stop_reason}")

asyncio.run(demo_streaming())
`);

md(`## 6. 上下文压缩

当对话历史过长时，会超出模型的上下文窗口。Claude Code 通过**自动压缩**处理这个问题 ——
总结旧消息以释放空间。

> **Source:** ${BT}services/compact/autoCompact.ts${BT}, ${BT}services/compact/compact.ts${BT}

### 压缩工作原理

${BT3}mermaid
flowchart LR
    A["消息不断增长<br/>（50k+ tokens）"] --> B{"Token 数 ><br/>阈值？"}
    B -- 否 --> C["正常继续"]
    B -- 是 --> D["调用 API 总结<br/>旧消息"]
    D --> E["用摘要替换<br/>旧消息"]
    E --> F["插入压缩边界<br/>消息"]
    F --> G["使用压缩后的<br/>上下文继续"]
${BT3}

### 源码中的压缩细节

在 ${BT}query.ts${BT} (L454-L543) 中，压缩流程：
1. ${BT}calculateTokenWarningState()${BT} 检查上下文是否超过阈值
2. ${BT}deps.autocompact()${BT} 将旧消息发送给较小的模型进行总结
3. ${BT}buildPostCompactMessages()${BT} 用摘要 + 边界标记替换旧消息
4. 产出 ${BT}compact_boundary${BT} 系统消息，供 UI/转录追踪
5. 循环使用压缩后的消息列表继续

**生活类比：** 就像你在看书时做笔记 —— 一章读完后你不会记住每个字，
而是记下要点。下次需要回忆时，看笔记就够了。上下文压缩就是 AI 的"做笔记"过程。
`);

code(`# === 上下文压缩模拟 ===

class ContextCompactor:
    """
    模拟上下文压缩过程。
    Source: services/compact/autoCompact.ts, services/compact/compact.ts

    真实实现：
    1. 使用 tiktoken 风格的估算计算 token 数
    2. 超过阈值时，将旧消息发送给较小的模型
    3. 模型生成保留关键上下文的摘要
    4. 旧消息被替换为摘要 + compact_boundary
    """

    def __init__(self, max_chars: int = 500):
        """
        Args:
            max_chars: 最大上下文大小（字符数，简化版）。
                       真实阈值约为 ~180k tokens。
        """
        self.max_chars = max_chars

    def estimate_size(self, messages: list[Message]) -> int:
        """估算消息总大小（简化版 token 计数）"""
        total = 0
        for msg in messages:
            for block in msg.content:
                if isinstance(block, TextBlock):
                    total += len(block.text)
                elif isinstance(block, ToolUseBlock):
                    total += len(json.dumps(block.input))
                elif isinstance(block, ToolResultBlock):
                    total += len(str(block.content))
        return total

    def compact(self, messages: list[Message]) -> tuple[list[Message], str]:
        """
        通过总结旧消息来压缩。

        返回 (压缩后消息, 摘要文本)。
        真实实现会调用 API 生成摘要。
        """
        total = self.estimate_size(messages)
        if total <= self.max_chars:
            return messages, ""  # 不需要压缩

        print(f"  压缩中: {total} 字符 -> 阈值 {self.max_chars}")

        # 找到合适的分割点：保留最近的消息，总结旧的
        # 真实实现在保留 tool_use/result 配对方面更智能
        keep_recent = 2  # 保留最近 2 次消息交换
        if len(messages) <= keep_recent:
            return messages, ""

        old_messages = messages[:-keep_recent]
        recent_messages = messages[-keep_recent:]

        # 生成摘要（真实实现调用 API）
        summary_parts = []
        for msg in old_messages:
            for block in msg.content:
                if isinstance(block, TextBlock):
                    summary_parts.append(block.text[:100])
                elif isinstance(block, ToolUseBlock):
                    summary_parts.append(f"[调用了 {block.name} 工具]")

        summary = (
            "## 对话摘要\\n\\n"
            "用户询问了代码分析相关的问题。"
            + " ".join(summary_parts[:3])
            + "\\n\\n---\\n"
        )

        # 构建压缩后的消息：摘要 + 边界 + 最近的
        compacted = [
            make_user_message(TextBlock(text=summary)),
        ]

        # 真实实现中，会插入 compact_boundary 系统消息
        print(f"  将 {len(old_messages)} 条旧消息总结为 {len(summary)} 字符的摘要")
        print(f"  保留了 {len(recent_messages)} 条近期消息")

        return compacted + recent_messages, summary


# 演示压缩
print("=== 上下文压缩演示 ===")
print()

# 构建一个"过长"的对话
long_conversation: list[Message] = []
for i in range(10):
    long_conversation.append(make_text_user_message(
        f"这是第 {i} 条消息，包含关于主题 {i} 的内容。" * 5
    ))
    long_conversation.append(make_assistant_message(TextBlock(
        text=f"对第 {i} 条消息的回复。" * 5
    )))

compactor = ContextCompactor(max_chars=500)
print(f"压缩前: {len(long_conversation)} 条消息, "
      f"{compactor.estimate_size(long_conversation)} 字符")
print()

compacted, summary = compactor.compact(long_conversation)
print()
print(f"压缩后: {len(compacted)} 条消息, "
      f"{compactor.estimate_size(compacted)} 字符")
`);

md(`## 7. 完整 QueryEngine 类

现在我们把所有内容组合成一个完整的 ${BT}QueryEngine${BT} 类，
对应真实的 ${BT}QueryEngine.ts${BT} (L184-L1178)。

真实的 ${BT}QueryEngine${BT} 类：
- 管理对话状态（${BT}mutableMessages${BT}）
- 处理系统提示构建
- 追踪使用量和成本
- 通过 ${BT}AbortController${BT} 支持中断
- 在进入查询循环前处理斜杠命令
- 为消费者产出类型化的 SDK 消息

> **Source:** ${BT}QueryEngine.ts${BT} L184-L1178
`);

code(`# === 完整 QueryEngine 实现 ===

@dataclass
class QueryConfig:
    """查询引擎配置。Source: QueryEngine.ts L130-173"""
    system_prompt: str = "你是 Claude，一个有帮助的编程助手。"
    max_turns: int = 10
    max_context_chars: int = 5000
    verbose: bool = True


class QueryEngine:
    """
    完整查询引擎。Source: QueryEngine.ts L184-L1178

    这是主要的编排器：
    1. 接收用户消息
    2. 管理对话历史
    3. 运行智能体循环（API 调用 + 工具执行）
    4. 处理上下文压缩
    5. 追踪使用统计
    """

    def __init__(
        self,
        config: QueryConfig | None = None,
        api_client: SimulatedAPIClient | None = None,
        tool_executor: SimpleToolExecutor | None = None,
    ):
        self.config = config or QueryConfig()
        self.api_client = api_client or SimulatedAPIClient()
        self.tool_executor = tool_executor or SimpleToolExecutor(self.api_client)
        self.compactor = ContextCompactor(max_chars=self.config.max_context_chars)

        # 状态：对应 QueryEngine.ts 的 mutableMessages
        self.messages: list[Message] = []
        self.turn_count = 0
        self.total_api_calls = 0

    def submit(self, user_text: str) -> str:
        """
        提交用户消息并运行智能体循环。
        Source: QueryEngine.ts submitMessage() L209

        真实实现是产出 SDKMessage 对象的异步生成器，
        调用者可以增量处理。我们简化为返回最终文本的同步函数。
        """
        # 将用户消息加入历史
        self.messages.append(make_text_user_message(user_text))

        final_text = ""

        for turn in range(self.config.max_turns):
            self.turn_count += 1

            if self.config.verbose:
                print(f"  [回合 {self.turn_count}] "
                      f"消息数: {len(self.messages)}, "
                      f"上下文: {self.compactor.estimate_size(self.messages)} 字符")

            # --- 自动压缩检查 ---
            # Source: query.ts L454-L543
            compacted_msgs, summary = self.compactor.compact(self.messages)
            if summary:
                self.messages = compacted_msgs
                if self.config.verbose:
                    print(f"  [压缩] 上下文已压缩")

            # --- 调用 API（模拟）---
            self.total_api_calls += 1
            assistant_blocks: list[ContentBlock] = []
            tool_use_blocks: list[ToolUseBlock] = []

            loop = asyncio.get_event_loop()
            async def call_api():
                nonlocal assistant_blocks, tool_use_blocks
                async for event in self.api_client.create_message(
                    messages=self.messages,
                    system_prompt=self.config.system_prompt,
                ):
                    block = event["block"]
                    assistant_blocks.append(block)
                    if isinstance(block, ToolUseBlock):
                        tool_use_blocks.append(block)

            loop.run_until_complete(call_api())

            # 将助手响应加入历史
            self.messages.append(make_assistant_message(*assistant_blocks))

            # --- 检查工具调用 ---
            if not tool_use_blocks:
                # 无工具调用 —— 提取文本并返回
                for block in assistant_blocks:
                    if isinstance(block, TextBlock):
                        final_text += block.text
                break

            # --- 执行工具 ---
            result_blocks: list[ToolResultBlock] = []
            for tool_use in tool_use_blocks:
                if self.config.verbose:
                    print(f"    工具: {tool_use.name}({json.dumps(tool_use.input, ensure_ascii=False)})")
                result = loop.run_until_complete(self.tool_executor.execute(tool_use))
                result_blocks.append(result)

            # 将工具结果作为 user 消息添加
            self.messages.append(make_user_message(*result_blocks))

        return final_text

    def get_stats(self) -> dict:
        """获取查询引擎统计"""
        return {
            "总回合数": self.turn_count,
            "API 调用次数": self.total_api_calls,
            "消息数": len(self.messages),
            "上下文大小": self.compactor.estimate_size(self.messages),
        }


# --- 运行完整引擎 ---
print("=" * 60)
print("完整 QueryEngine 演示")
print("=" * 60)
print()

engine = QueryEngine(
    config=QueryConfig(verbose=True, max_context_chars=2000),
)

result = engine.submit("Read main.py and summarize it")

print()
print("--- 结果 ---")
print(result)
print()
print("--- 统计 ---")
stats = engine.get_stats()
for k, v in stats.items():
    print(f"  {k}: {v}")
`);

md(`## 8. 源码映射表

| 我们的 Python 实现 | 原始 TypeScript 源码 |
|---------------------|----------------------|
| ${BT}Message${BT}, ${BT}TextBlock${BT}, ${BT}ToolUseBlock${BT}, ${BT}ToolResultBlock${BT} | SDK 类型 + ${BT}utils/messages.ts${BT} |
| ${BT}QueryLoop${BT} | ${BT}query.ts${BT} L219-L1729 (${BT}query()${BT} 生成器) |
| ${BT}StreamingSimulator${BT} | ${BT}services/api/claude.ts${BT} (SSE 解析) |
| ${BT}ContextCompactor${BT} | ${BT}services/compact/autoCompact.ts${BT} + ${BT}compact.ts${BT} |
| ${BT}SimpleToolExecutor${BT} | ${BT}services/tools/toolOrchestration.ts${BT} (${BT}runTools${BT}) |
| ${BT}QueryEngine${BT} | ${BT}QueryEngine.ts${BT} L184-L1178 |
| ${BT}QueryConfig${BT} | ${BT}QueryEngine.ts${BT} L130-173 (${BT}QueryEngineConfig${BT}) |
| ${BT}SimulatedAPIClient${BT} | ${BT}services/api/claude.ts${BT} (${BT}queryModelWithStreaming${BT}) |

### 本章核心概念

1. **智能体循环**：核心的 ${BT}while(true)${BT} 模式，循环直到获得文本响应
2. **消息协议**：用户/助手/工具消息如何在系统中流转
3. **工具编排**：tool_use → 执行 → tool_result → 继续
4. **流式传输**：SSE 事件，文本和 JSON 的增量累积
5. **上下文压缩**：上下文填满时总结旧消息
6. **QueryEngine**：将所有内容串联在一起的编排器类

---

## 9. 架构总览

${BT3}mermaid
classDiagram
    class QueryEngine {
        -messages: List~Message~
        -config: QueryConfig
        -compactor: ContextCompactor
        +submit(text) str
        +get_stats() dict
    }

    class QueryLoop {
        +run(text) str
        -call_api()
        -execute_tools()
    }

    class SimulatedAPIClient {
        +create_message() AsyncGenerator
    }

    class SimpleToolExecutor {
        +execute(tool_use) ToolResultBlock
    }

    class ContextCompactor {
        +estimate_size() int
        +compact(messages) tuple
    }

    class Message {
        +role: str
        +content: List~Block~
    }

    class ToolUseBlock {
        +id: str
        +name: str
        +input: dict
    }

    class ToolResultBlock {
        +tool_use_id: str
        +content: str
        +is_error: bool
    }

    QueryEngine --> QueryLoop
    QueryEngine --> ContextCompactor
    QueryLoop --> SimulatedAPIClient
    QueryLoop --> SimpleToolExecutor
    QueryLoop --> Message
    Message o-- ToolUseBlock
    Message o-- ToolResultBlock
${BT3}

---

← [上一章：Bash 工具与权限系统](04-bash-permissions.ipynb) | [下一章：命令系统与技能架构 →](06-command-skills.ipynb)
`);

cells.forEach((c,i)=>{if(c.cell_type==='code'&&c.source.join('').includes('${BT3}mermaid'))console.warn('WARN: cell '+i);});
const nb={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.10.0'}},cells};
const output=JSON.stringify(nb,null,1);
fs.writeFileSync('../05-query-engine.ipynb',output);
console.log('Cells: '+cells.length+' Size: '+output.length);
