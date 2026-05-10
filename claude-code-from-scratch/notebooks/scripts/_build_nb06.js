const fs = require('fs');
const cells = [];
const BT = '`'; const BT3 = '```';
function md(s) { cells.push({ cell_type:'markdown', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l) }); }
function code(s) { cells.push({ cell_type:'code', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l), outputs:[], execution_count:null }); }

md(`# Chapter 6: 命令系统与技能架构

**本章你将学到：**
- 斜杠命令的定义、注册和调度
- 三种命令类型：prompt / local / local-jsx
- 技能系统的 Frontmatter 解析
- 动态技能发现机制

> **Source:** ${BT}commands/${BT}, ${BT}skills/${BT}, ${BT}types/command.ts${BT}

---

## 1. 痛点：用户需要快捷方式

${BT3}python
# 没有命令系统时，用户只能打自然语言
user_input = "Please create a git commit with all staged changes"
# 模型需要理解意图、决定工具调用、执行多步操作

# 有了命令系统后：
user_input = "/commit"
# 直接触发预定义的 commit 工作流
${BT3}

**命令系统的价值：**
- **快捷**：常用操作一键触发
- **一致**：每次执行相同的流程
- **可扩展**：用户可以自定义命令和技能

---

## 2. 命令类型体系

${BT3}mermaid
classDiagram
    class Command {
        +name: str
        +description: str
        +type: CommandType
        +aliases: list
        +load: callable
        +availability: str
        +isEnabled: callable
    }

    class CommandType {
        <<enumeration>>
        PROMPT
        LOCAL
        LOCAL_JSX
    }

    Command --> CommandType
${BT3}

> **Source:** ${BT}types/command.ts${BT}
`);

code(`# === 命令系统实现 ===
from enum import Enum
from typing import Callable, Any


class CommandType(str, Enum):
    """命令类型。Source: types/command.ts"""
    PROMPT = "prompt"          # 扩展为文本提示
    LOCAL = "local"            # 本地执行返回文本
    LOCAL_JSX = "local-jsx"    # 渲染 UI 组件（Python 中简化为 local）


@dataclass
class Command:
    """
    斜杠命令定义。Source: types/command.ts

    原始 TypeScript 定义：
    {
      type: 'prompt' | 'local' | 'local-jsx',
      name: string,
      description: string,
      aliases?: string[],
      load: () => Promise<...>,
      availability?: AuthRequirement,
      isEnabled?: () => boolean,
      supportsNonInteractive?: boolean,
    }
    """
    name: str
    description: str
    type: CommandType
    handler: Callable[..., Any]
    aliases: list[str] = field(default_factory=list)
    is_enabled: Callable[[], bool] = lambda: True
    supports_non_interactive: bool = False


class CommandRegistry:
    """命令注册表。管理所有斜杠命令。"""

    def __init__(self):
        self._commands: dict[str, Command] = {}

    def register(self, command: Command):
        self._commands[command.name] = command
        for alias in command.aliases:
            self._commands[alias] = command

    def get(self, name: str) -> Command | None:
        return self._commands.get(name)

    def get_all(self) -> list[Command]:
        # 去重（别名和原名指向同一命令）
        seen = set()
        result = []
        for cmd in self._commands.values():
            if cmd.name not in seen:
                seen.add(cmd.name)
                result.append(cmd)
        return result

    def dispatch(self, name: str, args: str = "") -> str:
        """
        调度命令。根据命令类型执行不同的处理。

        Source: commands/ 的调度逻辑
        """
        cmd = self.get(name)
        if not cmd:
            return f"Unknown command: /{name}"

        if not cmd.is_enabled():
            return f"Command /{name} is not available"

        if cmd.type == CommandType.PROMPT:
            # prompt 类型：返回扩展后的文本
            return cmd.handler(args)
        elif cmd.type in (CommandType.LOCAL, CommandType.LOCAL_JSX):
            # local 类型：执行处理器
            return cmd.handler(args)

    def __len__(self):
        return len(self.get_all())


# 注册一些示例命令
cmd_registry = CommandRegistry()

cmd_registry.register(Command(
    name="help",
    description="Show available commands",
    type=CommandType.LOCAL,
    handler=lambda args: "\\n".join(
        f"  /{c.name:15s} {c.description}" for c in cmd_registry.get_all()
    ),
))

cmd_registry.register(Command(
    name="clear",
    description="Clear conversation history",
    type=CommandType.LOCAL,
    handler=lambda args: "Conversation cleared.",
    aliases=["cls"],
))

cmd_registry.register(Command(
    name="commit",
    description="Create a git commit with AI-generated message",
    type=CommandType.PROMPT,
    handler=lambda args: "Create a git commit with the staged changes. "
                        "Write a clear commit message that explains the changes.",
))

cmd_registry.register(Command(
    name="review",
    description="Review code changes in current branch",
    type=CommandType.PROMPT,
    handler=lambda args: "Review the code changes in the current git branch. "
                        "Look for bugs, style issues, and improvement suggestions.",
    aliases=["code-review"],
))

print(f"Command registry: {len(cmd_registry)} commands")
print()
print(cmd_registry.dispatch("help"))
print()
print(f"Dispatch /commit: {cmd_registry.dispatch('commit')}")
print(f"Dispatch /cls (alias): {cmd_registry.dispatch('cls')}")
`);

md(`## 3. 技能系统（Skill System）

技能是更高级的命令 —— 它们可以包含文件引用、限制可用工具、有条件触发。

### Frontmatter 格式

技能文件使用 YAML frontmatter 定义元数据：

${BT3}yaml
---
description: "Review code for security issues"
whenToUse: "When reviewing code for OWASP top 10 vulnerabilities"
allowedTools: ["Read", "Grep", "Glob"]
---

Review the following code for security vulnerabilities.
Focus on: injection, XSS, auth issues, secrets in code.
${BT3}

> **Source:** ${BT}skills/${BT} — 技能加载器使用 frontmatter 解析
`);

code(`# === 技能系统实现 ===
import re


@dataclass
class SkillMetadata:
    """技能元数据。从 Frontmatter 解析。"""
    description: str = ""
    when_to_use: str = ""
    allowed_tools: list[str] = field(default_factory=list)


@dataclass
class Skill:
    """
    技能定义。Source: skills/

    技能可以理解为带有元数据的 prompt 命令：
    - description: 技能描述
    - whenToUse: 何时使用（帮助模型决定）
    - allowedTools: 限制可用工具列表
    - content: 技能的 prompt 内容
    """
    name: str
    metadata: SkillMetadata
    content: str
    source_path: str = ""

    def get_expanded_content(self, args: str = "") -> str:
        """获取展开后的内容（替换参数占位符）"""
        result = self.content
        if args:
            result = result.replace("{{args}}", args)
            result = result.replace("{args}", args)
        return result


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """
    解析 YAML frontmatter。
    Source: skills/loadSkillsDir.ts 中的 frontmatter 解析逻辑

    格式：
    ---
    key: value
    ---
    body content
    """
    match = re.match(r'^---\\s*\\n(.*?)\\n---\\s*\\n(.*)', text, re.DOTALL)
    if not match:
        return {}, text

    metadata = {}
    for line in match.group(1).strip().split('\\n'):
        if ':' in line:
            key, _, value = line.partition(':')
            key = key.strip()
            value = value.strip().strip('"').strip("'")

            # 解析列表格式 ["a", "b"]
            if value.startswith('[') and value.endswith(']'):
                items = re.findall(r'"([^"]*)"', value)
                metadata[key] = items
            else:
                metadata[key] = value

    body = match.group(2).strip()
    return metadata, body


def load_skill(name: str, content: str, source_path: str = "") -> Skill:
    """从文件内容加载技能"""
    metadata_raw, body = parse_frontmatter(content)

    meta = SkillMetadata(
        description=metadata_raw.get("description", ""),
        when_to_use=metadata_raw.get("whenToUse", metadata_raw.get("when_to_use", "")),
        allowed_tools=metadata_raw.get("allowedTools", metadata_raw.get("allowed_tools", [])),
    )

    return Skill(name=name, metadata=meta, content=body, source_path=source_path)


# 测试 Frontmatter 解析
skill_content = '''---
description: "Security code review"
whenToUse: "When auditing code for security vulnerabilities"
allowedTools: ["Read", "Grep", "Glob"]
---

Review the code for security vulnerabilities.
Focus on OWASP top 10 issues:
- Injection attacks
- XSS vulnerabilities
- Authentication flaws

Use {{args}} as additional context.
'''

skill = load_skill("security-review", skill_content, ".claude/skills/security-review.md")

print("=== Skill 解析测试 ===")
print(f"Name: {skill.name}")
print(f"Description: {skill.metadata.description}")
print(f"When to use: {skill.metadata.when_to_use}")
print(f"Allowed tools: {skill.metadata.allowed_tools}")
print(f"Content preview: {skill.content[:100]}...")
print()
print(f"Expanded (with args='auth module'):")
print(skill.get_expanded_content(args="auth module"))
`);

md(`## 4. 技能发现机制

Claude Code 会从多个位置自动发现技能：

${BT3}mermaid
flowchart TB
    DISC["技能发现"] --> BUILTIN["内置技能<br/>编译时打包"]
    DISC --> USER["用户技能<br/>~/.claude/skills/"]
    DISC --> PROJECT["项目技能<br/>.claude/skills/"]
    DISC --> PLUGIN["插件技能<br/>plugins/*/skills/"]
    DISC --> DYNAMIC["动态技能<br/>文件操作触发"]
${BT3}

> **Source:** ${BT}skills/loadSkillsDir.ts${BT}
`);

code(`# === 技能发现实现 ===
from pathlib import Path


class SkillLoader:
    """
    技能加载器。Source: skills/loadSkillsDir.ts

    从多个目录发现和加载技能：
    1. .claude/skills/ — 项目级技能
    2. .claude/commands/ — 项目级命令（也是技能）
    3. ~/.claude/skills/ — 用户级技能
    """

    def __init__(self):
        self.skills: dict[str, Skill] = {}

    def load_from_directory(self, directory: Path):
        """从目录加载所有技能"""
        if not directory.exists():
            return

        for skill_file in directory.glob("**/*.md"):
            try:
                content = skill_file.read_text(encoding='utf-8')
                name = skill_file.stem  # 文件名作为技能名
                skill = load_skill(name, content, str(skill_file))

                # 检查是否有子目录（额外资源）
                skill_dir = skill_file.parent / skill_file.stem
                if skill_dir.is_dir():
                    # 技能有额外的资源文件
                    pass

                self.skills[name] = skill
            except Exception as e:
                print(f"Warning: Failed to load skill {skill_file}: {e}")

    def get_skill(self, name: str) -> Skill | None:
        return self.skills.get(name)

    def get_all_skills(self) -> list[Skill]:
        return list(self.skills.values())

    def discover_skills_for_path(self, file_path: str) -> list[Skill]:
        """
        根据文件路径发现相关技能。
        对应 activateConditionalSkillsForPaths()。

        例如：编辑 .claude/skills/ 下的文件时，
        重新加载该技能。
        """
        relevant = []
        for skill in self.skills.values():
            if file_path in skill.source_path:
                relevant.append(skill)
        return relevant


# 测试技能发现
import tempfile

# 创建临时技能目录
with tempfile.TemporaryDirectory() as tmpdir:
    skill_dir = Path(tmpdir) / "skills"
    skill_dir.mkdir()

    # 创建几个技能文件
    (skill_dir / "commit.md").write_text("""---
description: "Create a git commit"
whenToUse: "When user wants to commit changes"
---

Create a git commit with the staged changes.
Generate a clear commit message following conventional commits format.
""")

    (skill_dir / "test.md").write_text("""---
description: "Run tests"
whenToUse: "When user wants to run the test suite"
allowedTools: ["Bash"]
---

Run the project's test suite and report results.
Use {{args}} to specify which tests to run.
""")

    loader = SkillLoader()
    loader.load_from_directory(skill_dir)

    print("=== 技能发现测试 ===")
    for skill in loader.get_all_skills():
        print(f"  {skill.name}: {skill.metadata.description}")
        print(f"    whenToUse: {skill.metadata.when_to_use}")
        print(f"    allowedTools: {skill.metadata.allowed_tools}")
        print()

    print(f"Total skills discovered: {len(loader.get_all_skills())}")
`);

md(`## 5. 源码映射

| 我们的实现 | 原始源码 |
|-----------|---------|
| ${BT}Command${BT} | ${BT}types/command.ts${BT} |
| ${BT}CommandRegistry${BT} | ${BT}commands/${BT} 的注册逻辑 |
| ${BT}CommandType${BT} | ${BT}types/command.ts${BT} 的 type 字段 |
| ${BT}Skill${BT}, ${BT}SkillMetadata${BT} | ${BT}skills/${BT} 各文件 |
| ${BT}parse_frontmatter()${BT} | ${BT}skills/loadSkillsDir.ts${BT} |
| ${BT}SkillLoader${BT} | ${BT}skills/loadSkillsDir.ts${BT} (${BT}loadSkillsDir${BT}) |

---

← [上一章：查询引擎](05-query-engine.ipynb) | [下一章：MCP 与插件 →](07-mcp-plugins.ipynb)
`);

cells.forEach((c,i)=>{if(c.cell_type==='code'&&c.source.join('').includes('${BT3}mermaid'))console.warn('WARN: cell '+i);});
const nb={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.10.0'}},cells};
const out=JSON.stringify(nb,null,1);
fs.writeFileSync('06-command-skills.ipynb',out);
console.log('Cells: '+cells.length+' Size: '+out.length);
