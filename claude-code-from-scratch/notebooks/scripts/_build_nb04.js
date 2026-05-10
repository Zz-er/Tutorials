const fs = require('fs');
const cells = [];
const BT = '`'; const BT3 = '```';
function md(s) { cells.push({ cell_type:'markdown', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l) }); }
function code(s) { cells.push({ cell_type:'code', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l), outputs:[], execution_count:null }); }

md(`# Chapter 4: Bash 工具与权限系统

**本章你将学到：**
- Bash 工具的设计：命令执行、超时、输出捕获
- 命令分类：search/read/write/destructive
- 权限系统的三层架构：模式、规则、决策
- 安全沙箱的概念设计

> **Source:** ${BT}tools/BashTool/${BT}, ${BT}utils/permissions/${BT}

---

## 1. 痛点：无约束的命令执行是危险的

${BT3}python
import subprocess
# 没有权限检查的命令执行
result = subprocess.run("rm -rf /", shell=True)  # 灾难性后果！
${BT3}

AI Agent 执行用户命令时必须有安全边界：
- **分类**：这个命令是只读的还是破坏性的？
- **权限**：用户是否授权了这类操作？
- **沙箱**：能否在隔离环境中执行？

---

## 2. Bash 工具架构

${BT3}mermaid
flowchart TB
    INPUT["command + timeout"] --> PARSE["命令解析<br/>splitCommandWithOperators"]
    PARSE --> CLASSIFY["命令分类<br/>isSearchOrRead"]
    CLASSIFY --> PERM["权限检查<br/>bashPermissions"]
    PERM -->{"allow?"}
    PERM -- yes --> SANDBOX{"需要沙箱?"}
    SANDBOX -- yes --> EXEC_S["沙箱执行"]
    SANDBOX -- no --> EXEC["直接执行"]
    PERM -- no --> DENY["拒绝"]
    EXEC --> RESULT["stdout + stderr + exit_code"]
    EXEC_S --> RESULT
${BT3}
`);

code(`# === Bash 工具实现 ===
import subprocess
import time
from enum import Enum

class PermissionMode(str, Enum):
    """权限模式。Source: types/permissions.ts"""
    DEFAULT = "default"     # 每次询问
    PLAN = "plan"           # 规划模式（只读）
    BYPASS = "bypass"       # 跳过所有权限检查


# 命令分类 —— 对应 BashTool.tsx L60-82 的命令集合
SEARCH_COMMANDS = {'find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis'}
READ_COMMANDS = {'cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'strings',
                 'jq', 'awk', 'cut', 'sort', 'uniq', 'tr'}
LIST_COMMANDS = {'ls', 'tree', 'du'}
DESTRUCTIVE_COMMANDS = {'rm', 'rmdir', 'dd', 'mkfs', 'format'}
SILENT_COMMANDS = {'mv', 'cp', 'rm', 'mkdir', 'rmdir', 'chmod', 'chown', 'touch', 'ln'}


def classify_command(command: str) -> dict:
    """
    分类 bash 命令。对应 BashTool.tsx L95 isSearchOrReadBashCommand()。

    分析命令的第一个词（命令名），判断操作类型：
    - is_search: 搜索操作（grep, find 等）
    - is_read: 读取操作（cat, head 等）
    - is_list: 列表操作（ls, tree 等）
    - is_destructive: 破坏性操作（rm, dd 等）
    """
    # 简化版：取第一个词
    parts = command.strip().split()
    if not parts:
        return {"is_search": False, "is_read": False, "is_list": False, "is_destructive": False}

    cmd = parts[0]
    # 去掉路径前缀
    if '/' in cmd:
        cmd = cmd.rsplit('/', 1)[-1]

    return {
        "is_search": cmd in SEARCH_COMMANDS,
        "is_read": cmd in READ_COMMANDS,
        "is_list": cmd in LIST_COMMANDS,
        "is_destructive": cmd in DESTRUCTIVE_COMMANDS,
    }


# 测试命令分类
test_commands = [
    "ls -la",
    "grep -r pattern src/",
    "cat README.md",
    "rm -rf /tmp/test",
    "find . -name '*.ts'",
    "git status",
    "npm install",
    "dd if=/dev/zero of=test.img bs=1M count=100",
]

print("=== 命令分类测试 ===")
for cmd in test_commands:
    cls = classify_command(cmd)
    flags = []
    if cls["is_search"]: flags.append("SEARCH")
    if cls["is_read"]: flags.append("READ")
    if cls["is_list"]: flags.append("LIST")
    if cls["is_destructive"]: flags.append("DESTRUCTIVE")
    label = " | ".join(flags) if flags else "OTHER"
    print(f"  {cmd:50s} -> {label}")
`);

code(`# === 权限规则系统 ===

@dataclass
class PermissionRule:
    """
    一条权限规则。Source: utils/permissions/

    规则格式：
    - "Bash(git *)"     -> 允许/拒绝所有 git 开头的命令
    - "Read(*)"         -> 允许/拒绝所有文件读取
    - "Edit(src/**)"    -> 允许/拒绝编辑 src 目录下的文件
    """
    tool_name: str           # 工具名（如 "Bash", "Read"）
    pattern: str             # 匹配模式（如 "git *", "*"）
    source: str              # 规则来源（如 "user", "project", "session"）


class PermissionChecker:
    """
    权限检查器。Source: utils/permissions/filesystem.ts

    三层规则：
    1. alwaysDenyRules  — 优先级最高，直接拒绝
    2. alwaysAllowRules — 始终允许（跳过询问）
    3. alwaysAskRules   — 始终询问

    如果没有匹配任何规则，则根据 PermissionMode 决定。
    """

    def __init__(self, mode: PermissionMode = PermissionMode.DEFAULT):
        self.mode = mode
        self.always_allow: list[PermissionRule] = []
        self.always_deny: list[PermissionRule] = []
        self.always_ask: list[PermissionRule] = []

    def add_allow_rule(self, tool_name: str, pattern: str, source: str = "user"):
        self.always_allow.append(PermissionRule(tool_name, pattern, source))

    def add_deny_rule(self, tool_name: str, pattern: str, source: str = "user"):
        self.always_deny.append(PermissionRule(tool_name, pattern, source))

    def check(self, tool_name: str, input_str: str) -> PermissionResult:
        """
        检查权限。对应 bashPermissions.ts 中的 bashToolHasPermission()。

        检查顺序：
        1. alwaysDeny 匹配？ -> deny
        2. alwaysAllow 匹配？ -> allow
        3. alwaysAsk 匹配？ -> ask
        4. PermissionMode 决定
        """
        # 1. 检查 deny 规则
        for rule in self.always_deny:
            if self._matches(rule, tool_name, input_str):
                return PermissionResult.deny(f"Denied by rule: {rule.tool_name}({rule.pattern})")

        # 2. 检查 allow 规则
        for rule in self.always_allow:
            if self._matches(rule, tool_name, input_str):
                return PermissionResult.allow()

        # 3. 检查 ask 规则
        for rule in self.always_ask:
            if self._matches(rule, tool_name, input_str):
                return PermissionResult.ask(f"Rule requires confirmation: {rule.pattern}")

        # 4. 默认行为
        if self.mode == PermissionMode.BYPASS:
            return PermissionResult.allow()
        elif self.mode == PermissionMode.PLAN:
            if tool_name in ("Read", "Grep", "Glob"):
                return PermissionResult.allow()
            return PermissionResult.deny("Plan mode: only read operations allowed")
        else:
            return PermissionResult.ask("No matching rule — user confirmation needed")

    def _matches(self, rule: PermissionRule, tool_name: str, input_str: str) -> bool:
        """匹配规则。对应 shellRuleMatching.ts 的 matchWildcardPattern()"""
        if rule.tool_name != tool_name:
            return False
        # 简化版通配符匹配
        import fnmatch
        return fnmatch.fnmatch(input_str, rule.pattern)


# 测试权限系统
checker = PermissionChecker(PermissionMode.DEFAULT)

# 添加规则
checker.add_allow_rule("Bash", "git *", "user")
checker.add_allow_rule("Bash", "ls *", "user")
checker.add_allow_rule("Read", "*", "project")
checker.add_deny_rule("Bash", "rm -rf /*", "system")

print("=== 权限检查测试 ===")
tests = [
    ("Bash", "git status"),
    ("Bash", "ls -la"),
    ("Bash", "npm install"),
    ("Bash", "rm -rf /tmp/test"),
    ("Read", "/etc/passwd"),
    ("Edit", "src/main.py"),
]

for tool, inp in tests:
    result = checker.check(tool, inp)
    emoji = {"allow": "PASS", "deny": "DENY", "ask": "ASK"}[result.behavior]
    print(f"  {emoji:4s} | {tool:5s} | {inp}")
`);

code(`# === 完整 BashTool 实现 ===

class BashInput(ToolInput):
    """Source: BashTool.tsx 的 Zod schema"""
    command: str = Field(description="The bash command to run")
    timeout: int | None = Field(default=120000, description="Timeout in milliseconds")


class BashTool(Tool):
    """Bash 工具。Source: tools/BashTool/BashTool.tsx"""

    def __init__(self, permission_checker: PermissionChecker | None = None):
        self._checker = permission_checker or PermissionChecker()

    @property
    def name(self) -> str: return "Bash"

    @property
    def input_schema(self): return BashInput

    async def call(self, input_data: BashInput, context: ToolUseContext) -> ToolResult:
        command = input_data.command
        timeout_sec = (input_data.timeout or 120000) / 1000

        # 权限检查
        perm = self._checker.check("Bash", command)
        if perm.behavior == 'deny':
            return ToolResult(data={
                "stdout": "",
                "stderr": f"Permission denied: {perm.message}",
                "exit_code": 1,
                "error": "Permission denied"
            })

        try:
            start = time.time()
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                cwd=str(Path.cwd())
            )
            elapsed = time.time() - start

            # 命令分类
            cls = classify_command(command)

            return ToolResult(data={
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.returncode,
                "elapsed_ms": int(elapsed * 1000),
                "classification": cls
            })

        except subprocess.TimeoutExpired:
            return ToolResult(data={
                "stdout": "",
                "stderr": f"Command timed out after {timeout_sec}s",
                "exit_code": -1,
                "error": "Timeout"
            })
        except Exception as e:
            return ToolResult(data={
                "stdout": "",
                "stderr": str(e),
                "exit_code": 1,
                "error": str(e)
            })

    async def description(self, input_data, **options) -> str:
        return "Execute bash commands."

    async def prompt(self, **options) -> str:
        return "Use Bash to execute shell commands. Prefer dedicated tools (Read, Grep) over bash equivalents."

    def map_result(self, output, tool_use_id: str) -> dict:
        parts = []
        if output.get("stdout"):
            parts.append(output["stdout"])
        if output.get("stderr"):
            parts.append(f"STDERR: {output['stderr']}")
        if output.get("exit_code", 0) != 0:
            parts.append(f"Exit code: {output['exit_code']}")
        return {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": [{"type": "text", "text": '\\n'.join(parts) or "Command completed (no output)"}]
        }

    def isSearchOrReadCommand(self, input_data) -> dict:
        """Source: BashTool.tsx L95 isSearchOrReadBashCommand"""
        return classify_command(input_data.command)


# 测试 BashTool
checker = PermissionChecker(PermissionMode.BYPASS)
bash = build_tool(BashTool(checker))

# 安全命令
result = asyncio.run(bash.call(BashInput(command="echo Hello Claude Code"), ctx))
print(f"=== echo 测试 ===")
print(f"stdout: {result.data['stdout'].strip()}")
print(f"exit_code: {result.data['exit_code']}")
print(f"classification: {result.data['classification']}")
print()

# 只读命令
result2 = asyncio.run(bash.call(BashInput(command="ls"), ctx))
print(f"=== ls 测试 ===")
print(f"exit_code: {result2.data['exit_code']}")
print(f"classification: {result2.data['classification']}")
`);

md(`## 3. 安全沙箱（概念设计）

原始 Claude Code 支持沙箱执行（${BT}shouldUseSandbox.ts${BT}），在隔离环境中运行不受信任的命令。

${BT3}mermaid
flowchart LR
    CMD["命令"] --> CHECK{"危险命令?"}
    CHECK -- 是 --> WARN["警告用户"]
    WARN --> USER{"用户确认?"}
    USER -- 是 --> SANDBOX["沙箱执行"]
    USER -- 否 --> DENY["拒绝"]
    CHECK -- 否 --> NORMAL["正常执行"]
${BT3}

沙箱的几种实现方式：
1. **Docker 容器**：完全隔离，最安全但最慢
2. **操作系统沙箱**：macOS Seatbelt, Linux namespaces
3. **进程级限制**：禁止网络、限制文件系统访问

> **Source:** ${BT}utils/sandbox/${BT} — 沙箱适配器模式

---

## 4. 源码映射

| 我们的实现 | 原始源码 |
|-----------|---------|
| ${BT}BashTool${BT} | ${BT}tools/BashTool/BashTool.tsx${BT} |
| ${BT}classify_command()${BT} | ${BT}BashTool.tsx${BT} L95 ${BT}isSearchOrReadBashCommand${BT} |
| ${BT}PermissionChecker${BT} | ${BT}utils/permissions/${BT} 多个文件 |
| ${BT}PermissionMode${BT} | ${BT}types/permissions.ts${BT} |
| ${BT}PermissionRule${BT} | ${BT}utils/permissions/shellRuleMatching.ts${BT} |

---

← [上一章：文件操作工具](03-file-tools.ipynb) | [下一章：查询引擎 →](05-query-engine.ipynb)
`);

cells.forEach((c,i)=>{if(c.cell_type==='code'&&c.source.join('').includes('${BT3}mermaid'))console.warn('WARN: cell '+i);});
const nb={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.10.0'}},cells};
const out=JSON.stringify(nb,null,1);
fs.writeFileSync('04-bash-permissions.ipynb',out);
console.log('Cells: '+cells.length+' Size: '+out.length);
