"""
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
