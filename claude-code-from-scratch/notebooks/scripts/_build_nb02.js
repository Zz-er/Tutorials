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
// Notebook 02: Core Types & Tool Protocol
// ============================================================

md(`# Chapter 2: 核心类型与 Tool 协议

**本章你将学到：**
- Tool 接口的完整设计（Claude Code 架构的基石）
- 如何用 Python 实现类型安全的工具系统
- Zod Schema 验证在 Python 中的等价实现（Pydantic）
- ${BT}buildTool()${BT} 的设计模式 —— 默认值填充

> **Source:** 原始 ${BT}Tool.ts${BT} (L362-L792)

---

## 1. 为什么需要统一的 Tool 协议？

### 痛点：没有统一协议时

${BT3}python
# 每个工具自己定义接口，调用方无法统一处理
class BashToolBad:
    def run_command(self, cmd): ...     # 方法名不一致

class FileReadToolBad:
    def read_file(self, path): ...      # 方法名不一致

class GrepToolBad:
    def execute(self, pattern, path): ...  # 参数结构不一致

# 调用方需要知道每个工具的细节 —— 无法写通用代码
def call_tool(tool, **kwargs):
    # 怎么知道该调用哪个方法？参数是什么？
    pass  # 完全无法实现！
${BT3}

**解决方案：** 定义统一的 Tool 协议，所有工具实现相同的接口。
`);

md(`## 2. 原始 Tool 接口分析

Claude Code 的 ${BT}Tool${BT} 类型（${BT}Tool.ts${BT} L362-L695）是一个庞大的接口，
包含 30+ 个方法。但核心方法只有 6 个：

| 方法 | 职责 | 必须？ |
|------|------|--------|
| ${BT}name${BT} | 工具标识 | 必须 |
| ${BT}call()${BT} | 执行工具逻辑 | 必须 |
| ${BT}description()${BT} | 返回工具描述（给模型看的） | 必须 |
| ${BT}inputSchema${BT} | Zod schema 定义输入格式 | 必须 |
| ${BT}prompt()${BT} | 返回系统提示中的工具说明 | 必须 |
| ${BT}mapToolResultToToolResultBlockParam()${BT} | 转换结果为 API 格式 | 必须 |
| ${BT}checkPermissions()${BT} | 权限检查 | 可选（有默认） |
| ${BT}isConcurrencySafe()${BT} | 是否可并行执行 | 可选（默认 false） |
| ${BT}isReadOnly()${BT} | 是否只读 | 可选（默认 false） |
| ${BT}isDestructive()${BT} | 是否破坏性 | 可选（默认 false） |
| ${BT}validateInput()${BT} | 输入验证 | 可选 |
| ${BT}isEnabled()${BT} | 是否启用 | 可选（默认 true） |

### 设计决策：为什么这么多方法？

每个方法服务于不同的关注点：
- **API 层**：${BT}inputSchema${BT} + ${BT}mapToolResultToToolResultBlockParam()${BT}
- **安全层**：${BT}checkPermissions()${BT} + ${BT}isDestructive()${BT}
- **调度层**：${BT}isConcurrencySafe()${BT} + ${BT}interruptBehavior()${BT}
- **UI 层**：${BT}renderToolUseMessage()${BT} + ${BT}renderToolResultMessage()${BT}

这种设计遵循了**接口隔离原则** —— 每个关注点只看它需要的方法。
`);

code(`# === 实现 Python 版 Tool 协议 ===
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Generic, Optional, TypeVar
from pydantic import BaseModel


# --- 核心类型定义 ---

class ToolInput(BaseModel):
    """所有工具输入的基类。等价于 Zod schema。"""
    class Config:
        extra = "forbid"  # 等价于 z.strictObject()

class ToolOutput(BaseModel):
    """所有工具输出的基类。"""
    pass


@dataclass
class ValidationResult:
    """输入验证结果。对应 Tool.ts L95-101"""
    result: bool
    message: str = ""
    error_code: int = 0

    @staticmethod
    def ok() -> ValidationResult:
        return ValidationResult(result=True)

    @staticmethod
    def fail(msg: str, code: int = 400) -> ValidationResult:
        return ValidationResult(result=False, message=msg, error_code=code)


@dataclass
class PermissionResult:
    """权限检查结果。对应 Tool.ts 中的 PermissionResult"""
    behavior: str  # 'allow' | 'deny' | 'ask'
    updated_input: dict | None = None
    message: str = ""

    @staticmethod
    def allow(input_data: dict | None = None) -> PermissionResult:
        return PermissionResult(behavior='allow', updated_input=input_data)

    @staticmethod
    def deny(msg: str = "") -> PermissionResult:
        return PermissionResult(behavior='deny', message=msg)

    @staticmethod
    def ask(msg: str = "") -> PermissionResult:
        return PermissionResult(behavior='ask', message=msg)


@dataclass
class ToolResult(Generic[TypeVar('T')]):
    """
    工具执行结果。对应 Tool.ts L321-336

    原始设计：
    export type ToolResult<T> = {
      data: T
      newMessages?: Message[]
      contextModifier?: (context: ToolUseContext) => ToolUseContext
      mcpMeta?: { _meta?: Record<string, unknown>; structuredContent?: Record<string, unknown> }
    }
    """
    data: Any
    new_messages: list | None = None
    mcp_meta: dict | None = None


# 简化的上下文（完整版本在 Ch05）
@dataclass
class ToolUseContext:
    """工具使用上下文。简化版，对应 Tool.ts L158-300"""
    abort_controller: Any = None
    messages: list = field(default_factory=list)
    debug: bool = False
    verbose: bool = False


print("Core types defined successfully!")
print(f"  ValidationResult.ok() -> {ValidationResult.ok()}")
print(f"  PermissionResult.allow() -> {PermissionResult.allow()}")
print(f"  PermissionResult.deny('test') -> {PermissionResult.deny('test')}")
`);

code(`# === 实现 Tool 基类和 buildTool ===

# 默认行为 —— 对应 Tool.ts L757-769 的 TOOL_DEFAULTS
TOOL_DEFAULTS = {
    'is_enabled': lambda: True,
    'is_concurrency_safe': lambda input=None: False,
    'is_read_only': lambda input=None: False,
    'is_destructive': lambda input=None: False,
    'check_permissions': lambda input, ctx: PermissionResult.allow(input if isinstance(input, dict) else None),
    'user_facing_name': lambda input=None: '',
    'to_auto_classifier_input': lambda input: '',
}


class Tool(ABC, Generic[TypeVar('I', bound=ToolInput), TypeVar('O')]):
    """
    Python 版 Tool 协议。对应 Tool.ts L362-L695。

    原始 TypeScript 接口有 30+ 个方法，但核心是：
    1. name — 工具标识
    2. call() — 执行逻辑
    3. description() — 给模型看的描述
    4. input_schema — 输入参数定义（Zod -> Pydantic）
    5. prompt() — 系统提示中的工具说明
    6. map_result() — 结果转 API 格式
    """

    # --- 必须实现的方法 ---

    @property
    @abstractmethod
    def name(self) -> str:
        """工具名称，如 'Bash', 'Read', 'Edit'"""
        ...

    @abstractmethod
    async def call(self, input_data: ToolInput, context: ToolUseContext) -> ToolResult:
        """执行工具逻辑。对应 Tool.call()"""
        ...

    @abstractmethod
    async def description(self, input_data: ToolInput, **options) -> str:
        """返回工具描述文本。对应 Tool.description()"""
        ...

    @property
    @abstractmethod
    def input_schema(self) -> type[ToolInput]:
        """Pydantic 模型类，定义输入参数。对应 Tool.inputSchema"""
        ...

    @abstractmethod
    async def prompt(self, **options) -> str:
        """返回系统提示文本。对应 Tool.prompt()"""
        ...

    @abstractmethod
    def map_result(self, output: Any, tool_use_id: str) -> dict:
        """将输出转换为 API 格式。对应 mapToolResultToToolResultBlockParam()"""
        ...

    # --- 有默认值的方法（对应 TOOL_DEFAULTS）---

    def is_enabled(self) -> bool:
        """工具是否启用。默认 True。"""
        return True

    def is_concurrency_safe(self, input_data=None) -> bool:
        """是否可并行执行。默认 False（保守估计）。"""
        return False

    def is_read_only(self, input_data=None) -> bool:
        """是否只读操作。默认 False。"""
        return False

    def is_destructive(self, input_data=None) -> bool:
        """是否破坏性操作。默认 False。"""
        return False

    async def check_permissions(self, input_data, context) -> PermissionResult:
        """
        权限检查。默认允许。
        对应 TOOL_DEFAULTS.checkPermissions -> { behavior: 'allow', updatedInput }
        """
        return PermissionResult.allow()

    def user_facing_name(self, input_data=None) -> str:
        """用户可见的工具名称。默认返回 name。"""
        return self.name

    def to_auto_classifier_input(self, input_data) -> str:
        """用于自动分类器的输入摘要。默认空字符串（跳过分类）。"""
        return ''

    def interrupt_behavior(self) -> str:
        """被中断时的行为：'cancel' 或 'block'。默认 'block'。"""
        return 'block'


def build_tool(tool_instance: Tool) -> Tool:
    """
    Python 版 buildTool。对应 Tool.ts L783-792。

    原始设计用 TypeScript 的 spread operator 合并默认值：
    return { ...TOOL_DEFAULTS, userFacingName: () => def.name, ...def }

    在 Python 中，我们通过继承和默认方法实现相同效果。
    子类覆盖的方法自动替代默认值，无需显式合并。
    """
    return tool_instance


print("Tool base class and build_tool() defined!")
print()
print("设计模式：buildTool 的 Python 实现")
print("  TypeScript: spread operator 合并默认值")
print("  Python:     继承 + 默认方法（等效但更 Pythonic）")
`);

md(`## 3. 实现第一个真实工具：EchoTool

让我们用 Tool 协议实现一个最简单的工具 —— Echo，它原样返回输入。
这让我们能验证整个协议的正确性。

> **Source:** 这个工具是简化版，用来理解协议。真实工具的复杂度会在后续章节逐步展开。
`);

code(`# === 实现 EchoTool ===
import json


class EchoInput(ToolInput):
    """Echo 工具的输入参数"""
    message: str


class EchoOutput(ToolOutput):
    """Echo 工具的输出"""
    echoed: str
    length: int


class EchoTool(Tool):
    """
    最简单的工具实现 —— 原样返回输入。
    用于验证 Tool 协议的完整性。
    """

    @property
    def name(self) -> str:
        return "Echo"

    @property
    def input_schema(self) -> type[ToolInput]:
        return EchoInput

    async def call(self, input_data: EchoInput, context: ToolUseContext) -> ToolResult:
        """执行 echo 操作"""
        return ToolResult(
            data=EchoOutput(
                echoed=input_data.message,
                length=len(input_data.message)
            )
        )

    async def description(self, input_data, **options) -> str:
        return f"Echo back the input message"

    async def prompt(self, **options) -> str:
        return (
            "Use the Echo tool to echo back any message. "
            "This is useful for testing the tool system."
        )

    def map_result(self, output: EchoOutput, tool_use_id: str) -> dict:
        """
        转换为 Anthropic API 的 tool_result 格式。

        对应 Tool.ts 中的 mapToolResultToToolResultBlockParam：
        返回 { type: 'tool_result', tool_use_id, content: [...] }
        """
        return {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": [{
                "type": "text",
                "text": json.dumps({"echoed": output.echoed, "length": output.length})
            }]
        }

    # 覆盖默认值 —— echo 是只读且安全的
    def is_concurrency_safe(self, input_data=None) -> bool:
        return True

    def is_read_only(self, input_data=None) -> bool:
        return True

    def user_facing_name(self, input_data=None) -> str:
        if input_data and hasattr(input_data, 'message'):
            return f"Echo: {input_data.message[:30]}"
        return "Echo"


# 测试 EchoTool
import asyncio

echo = build_tool(EchoTool())
ctx = ToolUseContext()

print("=== EchoTool 测试 ===")
print(f"Name: {echo.name}")
print(f"Is enabled: {echo.is_enabled()}")
print(f"Is concurrency safe: {echo.is_concurrency_safe()}")
print(f"Is read only: {echo.is_read_only()}")
print(f"User facing name: {echo.user_facing_name()}")
print()

# 执行工具
test_input = EchoInput(message="Hello, Claude Code!")
result = asyncio.run(echo.call(test_input, ctx))

print(f"Result data: {result.data}")
print(f"Mapped result: {json.dumps(echo.map_result(result.data, 'test-id-123'), indent=2)}")
`);

md(`## 4. 工具注册表（Tool Registry）

有了 Tool 协议，我们需要一个地方来注册和查找工具。
这对应原始项目中的 ${BT}tools.ts${BT} 的 ${BT}getAllBaseTools()${BT}。

${BT3}mermaid
flowchart TB
    subgraph "Tool Registry"
        REG["getAllBaseTools()"]
        BUILTIN["Built-in Tools<br/>Bash, Read, Edit, ..."]
        PLUGIN["Plugin Tools"]
        MCP["MCP Tools"]
    end

    REG --> BUILTIN
    REG --> PLUGIN
    REG --> MCP
    REG --> FINAL["Tools[]<br/>合并后的工具列表"]
${BT3}
`);

code(`# === 实现 ToolRegistry ===
from typing import Optional


class ToolRegistry:
    """
    工具注册表。管理所有可用的工具。

    对应 tools.ts 中的 getAllBaseTools()：
    export function getAllBaseTools(): Tools {
      return [
        AgentTool, BashTool, GlobTool, GrepTool,
        FileReadTool, FileEditTool, FileWriteTool, ...
      ]
    }
    """

    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        """注册一个工具"""
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        """按名称查找工具"""
        return self._tools.get(name)

    def find_by_name_or_alias(self, name: str) -> Optional[Tool]:
        """
        按名称或别名查找工具。
        对应 Tool.ts 中的 findToolByName()。
        """
        # 先精确匹配
        if name in self._tools:
            return self._tools[name]
        # 再匹配别名
        for tool in self._tools.values():
            if hasattr(tool, 'aliases') and name in (tool.aliases or []):
                return tool
        return None

    def get_all(self) -> list[Tool]:
        """获取所有已注册的工具"""
        return list(self._tools.values())

    def get_enabled(self) -> list[Tool]:
        """获取所有启用的工具"""
        return [t for t in self._tools.values() if t.is_enabled()]

    def get_tools_for_api(self) -> list[dict]:
        """
        生成 Anthropic API 需要的工具定义列表。
        对应 query.ts 中发送给 API 的 tools 参数。
        """
        tools = []
        for tool in self.get_enabled():
            schema = tool.input_schema.model_json_schema()
            tools.append({
                "name": tool.name,
                "description": asyncio.run(tool.description(None)),
                "input_schema": {
                    "type": "object",
                    **schema
                }
            })
        return tools

    def __len__(self) -> int:
        return len(self._tools)

    def __repr__(self) -> str:
        names = list(self._tools.keys())
        return f"ToolRegistry({len(self._tools)} tools: {', '.join(names)})"


# 测试注册表
registry = ToolRegistry()
registry.register(EchoTool())

print("=== ToolRegistry 测试 ===")
print(f"Registry: {registry}")
print(f"Get 'Echo': {registry.get('Echo').name}")
print(f"Get 'Unknown': {registry.get('Unknown')}")
print(f"Enabled tools: {[t.name for t in registry.get_enabled()]}")
print()

# API 格式
api_tools = registry.get_tools_for_api()
print("API tool definitions:")
for t in api_tools:
    print(f"  {json.dumps(t, indent=2, ensure_ascii=False)}")
`);

md(`## 5. Zod -> Pydantic：Schema 验证的跨语言映射

原始项目使用 Zod v4 做输入验证。我们的 Python 实现使用 Pydantic v2。
以下是关键概念的映射：

| Zod (TypeScript) | Pydantic (Python) | 用途 |
|-------------------|-------------------|------|
| ${BT}z.string()${BT} | ${BT}str${BT} | 字符串 |
| ${BT}z.number()${BT} | ${BT}int${BT} / ${BT}float${BT} | 数字 |
| ${BT}z.boolean()${BT} | ${BT}bool${BT} | 布尔值 |
| ${BT}z.optional()${BT} | ${BT}Optional[T]${BT} | 可选 |
| ${BT}z.enum()${BT} | ${BT}Literal[...]${BT} | 枚举 |
| ${BT}z.strictObject()${BT} | ${BT}model_config = ConfigDict(extra='forbid')${BT} | 严格对象 |
| ${BT}z.describe()${BT} | ${BT}Field(description=...)${BT} | 描述 |
| ${BT}z.lazy()${BT} | ${BT}model_rebuild()${BT} | 懒加载 |

### 关键差异

1. **Zod 的 ${BT}lazySchema()${BT}**：原始项目用它来延迟 schema 构建，避免循环依赖和启动性能问题。Pydantic 不需要这个 —— Python 的类在运行时已经可用。

2. **JSON Schema 生成**：Zod 和 Pydantic 都可以生成 JSON Schema，但格式略有不同。Pydantic 的 ${BT}model_json_schema()${BT} 直接兼容 OpenAPI/JSON Schema 标准。

3. **错误消息**：Zod 的错误消息更友好（${BT}semanticNumber()${BT} 包装器），Pydantic 的错误消息也可以自定义但需要额外配置。
`);

code(`# === Schema 验证的完整示例 ===
from pydantic import Field, field_validator
from typing import Literal


class BashToolInput(ToolInput):
    """
    Bash 工具的输入参数。

    对应原始 BashTool.ts 中的 Zod schema：
    z.strictObject({
      command: z.string().describe('The bash command to run'),
      timeout: z.number().optional().describe('Optional timeout in ms'),
    })
    """
    command: str = Field(description="The bash command to run")
    timeout: int | None = Field(default=None, description="Optional timeout in ms")

    @field_validator('command')
    @classmethod
    def command_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Command cannot be empty")
        return v


class FileReadInput(ToolInput):
    """
    文件读取工具的输入参数。

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


class GrepToolInput(ToolInput):
    """
    Grep 工具的输入参数。

    对应 GrepTool.ts 中的 Zod schema。
    """
    pattern: str = Field(description="The regex pattern to search for")
    path: str | None = Field(default=None, description="Directory to search in")
    output_mode: Literal["files_with_matches", "content", "count"] = Field(
        default="files_with_matches",
        description="Output mode"
    )
    head_limit: int | None = Field(default=250, description="Limit output entries")


# 测试 schema 验证
print("=== Schema 验证测试 ===")
print()

# 有效输入
bash_valid = BashToolInput(command="ls -la")
print(f"BashInput valid: command='{bash_valid.command}', timeout={bash_valid.timeout}")

# 带可选参数
bash_with_timeout = BashToolInput(command="sleep 5", timeout=5000)
print(f"BashInput with timeout: timeout={bash_with_timeout.timeout}")

# 无效输入
print()
print("无效输入测试：")
try:
    BashToolInput(command="")
except Exception as e:
    print(f"  空命令: {e}")

try:
    BashToolInput(command="ls", extra_field="oops")
except Exception as e:
    print(f"  多余字段: {type(e).__name__}")

print()

# JSON Schema 生成（等价于 Zod 的 toJsonSchema）
print("=== JSON Schema 生成 ===")
schema = BashToolInput.model_json_schema()
print(json.dumps(schema, indent=2, ensure_ascii=False))
`);

md(`## 6. 架构总结

我们在本章建立的类型系统是整个项目的基石：

${BT3}mermaid
classDiagram
    class Tool {
        <<abstract>>
        +name: str
        +call(input, context) ToolResult
        +description(input) str
        +input_schema: Type
        +prompt() str
        +map_result(output, id) dict
        +is_enabled() bool
        +is_concurrency_safe() bool
        +is_read_only() bool
        +check_permissions(input, ctx) PermissionResult
    }

    class ToolResult {
        +data: Any
        +new_messages: List
        +mcp_meta: Dict
    }

    class PermissionResult {
        +behavior: str
        +updated_input: Dict
    }

    class ValidationResult {
        +result: bool
        +message: str
    }

    class ToolRegistry {
        -_tools: Dict
        +register(tool)
        +get(name) Tool
        +get_all() List~Tool~
        +get_tools_for_api() List~Dict~
    }

    Tool --> ToolResult
    Tool --> PermissionResult
    Tool --> ValidationResult
    ToolRegistry o-- Tool
${BT3}

### 关键设计原则

1. **统一接口**：所有工具实现相同的协议，调度器不需要知道具体工具的细节
2. **安全默认**：${BT}buildTool()${BT} 的默认值都是"保守"的 —— 不是只读、不并发安全
3. **类型安全**：Pydantic schema 同时提供验证和 JSON Schema 生成
4. **关注点分离**：权限检查、输入验证、执行逻辑各自独立

---

## 源码映射

| 我们的实现 | 原始源码 |
|-----------|---------|
| ${BT}Tool${BT} 基类 | ${BT}Tool.ts${BT} L362-L695 |
| ${BT}build_tool()${BT} | ${BT}Tool.ts${BT} L783-792 (${BT}buildTool${BT}) |
| ${BT}TOOL_DEFAULTS${BT} | ${BT}Tool.ts${BT} L757-769 |
| ${BT}ToolResult${BT} | ${BT}Tool.ts${BT} L321-336 |
| ${BT}ValidationResult${BT} | ${BT}Tool.ts${BT} L95-101 |
| ${BT}PermissionResult${BT} | ${BT}types/permissions.ts${BT} |
| ${BT}ToolRegistry${BT} | ${BT}tools.ts${BT} (${BT}getAllBaseTools${BT}) |
| Pydantic ${BT}ToolInput${BT} | 各工具的 Zod schema |

---

← [上一章：Source Map 还原](01-sourcemap-extraction.ipynb) | [下一章：文件操作工具 →](03-file-tools.ipynb)
`);

// Lint
cells.forEach((cell, i) => {
  if (cell.cell_type === 'code' && cell.source.join('').includes('```mermaid')) {
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
fs.writeFileSync('02-tool-protocol.ipynb', output);
console.log('Cells: ' + cells.length + '  Size: ' + output.length + ' bytes');

// Also write the our-implementation module
const moduleCode = `"""
Core Tool Protocol - Python reimplementation of Claude Code's Tool system.

Source: Tool.ts (L362-L792)
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel, Field, field_validator
from typing import Literal


# --- Core Types ---

class ToolInput(BaseModel):
    """Base class for all tool inputs (equivalent to Zod schema)."""
    class Config:
        extra = "forbid"


class ToolOutput(BaseModel):
    """Base class for all tool outputs."""
    pass


@dataclass
class ValidationResult:
    """Input validation result. Source: Tool.ts L95-101"""
    result: bool
    message: str = ""
    error_code: int = 0

    @staticmethod
    def ok() -> ValidationResult:
        return ValidationResult(result=True)

    @staticmethod
    def fail(msg: str, code: int = 400) -> ValidationResult:
        return ValidationResult(result=False, message=msg, error_code=code)


@dataclass
class PermissionResult:
    """Permission check result."""
    behavior: str  # 'allow' | 'deny' | 'ask'
    updated_input: dict | None = None
    message: str = ""

    @staticmethod
    def allow(input_data: dict | None = None) -> PermissionResult:
        return PermissionResult(behavior='allow', updated_input=input_data)

    @staticmethod
    def deny(msg: str = "") -> PermissionResult:
        return PermissionResult(behavior='deny', message=msg)

    @staticmethod
    def ask(msg: str = "") -> PermissionResult:
        return PermissionResult(behavior='ask', message=msg)


@dataclass
class ToolResult:
    """Tool execution result. Source: Tool.ts L321-336"""
    data: Any
    new_messages: list | None = None
    mcp_meta: dict | None = None


@dataclass
class ToolUseContext:
    """Simplified tool use context."""
    abort_controller: Any = None
    messages: list = field(default_factory=list)
    debug: bool = False
    verbose: bool = False


# --- Tool Base Class ---

class Tool(ABC):
    """Python Tool protocol. Source: Tool.ts L362-L695"""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def call(self, input_data: ToolInput, context: ToolUseContext) -> ToolResult: ...

    @abstractmethod
    async def description(self, input_data, **options) -> str: ...

    @property
    @abstractmethod
    def input_schema(self) -> type[ToolInput]: ...

    @abstractmethod
    async def prompt(self, **options) -> str: ...

    @abstractmethod
    def map_result(self, output: Any, tool_use_id: str) -> dict: ...

    def is_enabled(self) -> bool: return True
    def is_concurrency_safe(self, input_data=None) -> bool: return False
    def is_read_only(self, input_data=None) -> bool: return False
    def is_destructive(self, input_data=None) -> bool: return False

    async def check_permissions(self, input_data, context) -> PermissionResult:
        return PermissionResult.allow()

    def user_facing_name(self, input_data=None) -> str: return self.name
    def to_auto_classifier_input(self, input_data) -> str: return ''
    def interrupt_behavior(self) -> str: return 'block'


def build_tool(tool_instance: Tool) -> Tool:
    """Source: Tool.ts L783-792 buildTool()"""
    return tool_instance


# --- Tool Registry ---

class ToolRegistry:
    """Tool registration and lookup. Source: tools.ts getAllBaseTools()"""

    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def find_by_name_or_alias(self, name: str) -> Optional[Tool]:
        if name in self._tools:
            return self._tools[name]
        for tool in self._tools.values():
            if hasattr(tool, 'aliases') and name in (tool.aliases or []):
                return tool
        return None

    def get_all(self) -> list[Tool]:
        return list(self._tools.values())

    def get_enabled(self) -> list[Tool]:
        return [t for t in self._tools.values() if t.is_enabled()]

    def __len__(self) -> int:
        return len(self._tools)

    def __repr__(self) -> str:
        names = list(self._tools.keys())
        return f"ToolRegistry({len(self._tools)} tools: {', '.join(names)})"
`;

fs.writeFileSync('../our-implementation/tool_protocol.py', moduleCode);
console.log('Module written: tool_protocol.py');
