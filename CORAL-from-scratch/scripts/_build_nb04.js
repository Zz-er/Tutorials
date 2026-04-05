const fs = require('fs');
const cells = [];
function md(source) { cells.push({ cell_type: 'markdown', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l) }); }
function code(source) { cells.push({ cell_type: 'code', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l), outputs: [], execution_count: null }); }

md(`# 第四章：共享状态中心（Hub）

> 多代理协作的关键在于**共享知识**。本章实现 Attempts CRUD、Notes 笔记和 Skills 技能三大共享状态模块。

## 本章内容

- Attempts：JSON 文件的增删查 + 排行榜
- Notes：Markdown + YAML frontmatter 笔记系统
- Skills：目录级别的可复用工具包
- 全文搜索、排序、格式化

> Source: \`coral/hub/attempts.py\`, \`coral/hub/notes.py\`, \`coral/hub/skills.py\``);

md(`## 1. 痛点：代理之间的知识孤岛

没有共享状态时：
- 代理 1 发现「快速排序对已排序数组很慢」—— 只有它自己知道
- 代理 2 又踩了同一个坑
- 代理 3 写了一个很好的数据预处理工具 —— 其他代理用不了

CORAL 的 Hub 让代理通过 .coral/public/ 目录共享：
- **attempts/**：所有人的评估记录（排行榜）
- **notes/**：文字笔记（发现、经验、教训）
- **skills/**：可复用工具（代码 + 文档）`);

md(`## 2. Attempts 模块：评估记录 CRUD

Attempts 使用**文件系统作为数据库** —— 每次评估生成一个 \`{commit_hash}.json\` 文件。

### 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 存储格式 | JSON 文件 | 代理可直接读写，无需数据库驱动 |
| 文件名 | commit_hash | 天然去重，与 git 历史关联 |
| 查询方式 | 全量加载 + 内存过滤 | 数据量小（每个 JSON < 1KB），简单可靠 |`);

code(`import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# 导入我们的类型
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation"))
from types_ import Attempt, Score, ScoreBundle


# === Attempts CRUD ===

def _attempts_dir(coral_dir: str) -> Path:
    """确保 attempts 目录存在并返回路径。"""
    d = Path(coral_dir) / "public" / "attempts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_attempt(coral_dir: str, attempt: Attempt) -> None:
    """写入一次尝试记录。"""
    path = _attempts_dir(coral_dir) / f"{attempt.commit_hash}.json"
    path.write_text(json.dumps(attempt.to_dict(), indent=2))


def read_attempts(coral_dir: str) -> list[Attempt]:
    """读取所有尝试记录。"""
    attempts_dir = _attempts_dir(coral_dir)
    attempts = []
    for f in attempts_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            attempts.append(Attempt.from_dict(data))
        except (json.JSONDecodeError, KeyError) as e:
            continue  # 跳过损坏的文件
    return attempts


def get_leaderboard(coral_dir: str, top_n: int = 20, direction: str = "maximize") -> list[Attempt]:
    """获取排行榜（按分数排序）。"""
    attempts = read_attempts(coral_dir)
    scored = [a for a in attempts if a.score is not None]
    reverse = direction != "minimize"
    scored.sort(key=lambda a: a.score, reverse=reverse)
    return scored[:top_n]


def get_agent_attempts(coral_dir: str, agent_id: str) -> list[Attempt]:
    """获取指定代理的所有尝试。"""
    return [a for a in read_attempts(coral_dir) if a.agent_id == agent_id]


def get_recent(coral_dir: str, n: int = 10) -> list[Attempt]:
    """获取最近 N 次尝试。"""
    attempts = read_attempts(coral_dir)
    attempts.sort(key=lambda a: a.timestamp, reverse=True)
    return attempts[:n]


def search_attempts(coral_dir: str, query: str) -> list[Attempt]:
    """全文搜索尝试记录。"""
    query_lower = query.lower()
    results = []
    for a in read_attempts(coral_dir):
        text = f"{a.title} {a.feedback} {a.status}".lower()
        if query_lower in text:
            results.append(a)
    return results


# === 演示 ===
with tempfile.TemporaryDirectory() as tmpdir:
    coral_dir = tmpdir

    # 写入测试数据
    now = datetime.now(timezone.utc).isoformat()
    attempts_data = [
        Attempt("aaa111", "agent-1", "冒泡排序", 0.6, "baseline", None, now, "慢"),
        Attempt("bbb222", "agent-1", "快速排序", 0.95, "improved", "aaa111", now, "快多了"),
        Attempt("ccc333", "agent-2", "归并排序", 0.90, "improved", None, now, "稳定排序"),
        Attempt("ddd444", "agent-2", "混合排序", 0.98, "improved", "ccc333", now, "最优！"),
        Attempt("eee555", "agent-3", "堆排序", 0.85, "baseline", None, now, "不错"),
    ]
    for a in attempts_data:
        write_attempt(coral_dir, a)

    # 读取排行榜
    board = get_leaderboard(coral_dir, top_n=3)
    print("排行榜 Top 3:")
    for i, a in enumerate(board, 1):
        print(f"  {i}. [{a.agent_id}] {a.title} -> {a.score}")

    # 搜索
    results = search_attempts(coral_dir, "排序")
    print(f"\\n搜索「排序」: {len(results)} 条结果")

    # 按代理查询
    a1 = get_agent_attempts(coral_dir, "agent-1")
    print(f"agent-1 的尝试: {len(a1)} 条")`);

md(`## 3. 排行榜格式化

CORAL 的排行榜使用 Markdown 表格格式，便于在终端和 Web 界面展示。`);

code(`def _format_time(timestamp: str) -> str:
    """ISO 时间戳 -> 短格式 mm-dd HH:MM:SS"""
    try:
        dt = datetime.fromisoformat(timestamp)
        return dt.strftime("%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return timestamp[:19] if timestamp else "?"


def format_leaderboard(attempts: list[Attempt]) -> str:
    """格式化排行榜为 Markdown 表格。"""
    if not attempts:
        return "No attempts yet."
    lines = ["| Rank | Score | Agent | Title | Time | Commit |",
             "|------|-------|-------|-------|------|--------|"]
    for i, a in enumerate(attempts, 1):
        score_str = f"{a.score:.4f}" if a.score is not None else "N/A"
        time_str = _format_time(a.timestamp)
        lines.append(f"| {i} | {score_str} | {a.agent_id} | {a.title} | {time_str} | {a.commit_hash[:7]} |")
    return "\\n".join(lines)


# 使用之前的数据演示
with tempfile.TemporaryDirectory() as tmpdir:
    for a in attempts_data:
        write_attempt(tmpdir, a)
    board = get_leaderboard(tmpdir)
    print(format_leaderboard(board))`);

md(`## 4. Notes 模块：Markdown 笔记

代理可以在 .coral/public/notes/ 中写 Markdown 笔记分享发现。笔记使用 YAML frontmatter 记录元数据：

\`\`\`markdown
---
creator: agent-1
created: 2026-03-14T17:35:00
---
# 快速排序对已排序数组的退化

发现当输入已排序时，快速排序退化到 O(n^2)...
\`\`\``);

code(`import re
import yaml

def _notes_dir(coral_dir: str) -> Path:
    d = Path(coral_dir) / "public" / "notes"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 YAML frontmatter。返回 (metadata, body)。"""
    match = re.match(r'^---\\s*\\n(.*?)\\n---\\s*\\n(.*)', text, re.DOTALL)
    if match:
        try:
            metadata = yaml.safe_load(match.group(1)) or {}
            return metadata, match.group(2)
        except yaml.YAMLError:
            pass
    return {}, text


def _parse_note_file(path: Path) -> dict:
    """解析单个笔记文件。"""
    text = path.read_text(encoding="utf-8")
    metadata, body = _parse_frontmatter(text)
    # 从第一个 # 标题提取 title
    title = path.stem
    for line in body.splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            break
    return {
        "title": title,
        "body": body,
        "metadata": metadata,
        "path": str(path),
        "creator": metadata.get("creator", "unknown"),
        "created": metadata.get("created", ""),
    }


def list_notes(coral_dir: str) -> list[dict]:
    """列出所有笔记，按时间排序。"""
    notes_dir = _notes_dir(coral_dir)
    entries = []
    for f in notes_dir.glob("*.md"):
        entries.append(_parse_note_file(f))
    entries.sort(key=lambda e: str(e.get("created", "")), reverse=True)
    return entries


def search_notes(coral_dir: str, query: str) -> list[dict]:
    """全文搜索笔记。"""
    query_lower = query.lower()
    return [n for n in list_notes(coral_dir)
            if query_lower in f"{n['title']} {n['body']}".lower()]


def get_recent_notes(coral_dir: str, n: int = 5) -> list[dict]:
    """获取最近 N 条笔记。"""
    return list_notes(coral_dir)[:n]


def read_all_notes(coral_dir: str) -> str:
    """读取所有笔记，用分隔线连接。"""
    notes = list_notes(coral_dir)
    return "\\n---\\n".join(n["body"] for n in notes)


# === 演示 ===
with tempfile.TemporaryDirectory() as tmpdir:
    notes_dir = _notes_dir(tmpdir)

    # 写入测试笔记
    note1 = """---
creator: agent-1
created: 2026-04-01T10:00:00
---
# 快速排序退化问题

当输入已排序时，快速排序退化到 O(n^2)。
解决方案：使用随机化 pivot 或三数取中法。
"""
    (notes_dir / "quicksort-issue.md").write_text(note1, encoding="utf-8")

    note2 = """---
creator: agent-2
created: 2026-04-01T11:00:00
---
# TimSort 的优势

Python 内置 sorted() 使用 TimSort，对部分有序数据表现优异。
可以考虑作为基准实现。
"""
    (notes_dir / "timsort-advantage.md").write_text(note2, encoding="utf-8")

    # 列出笔记
    notes = list_notes(tmpdir)
    print(f"共 {len(notes)} 条笔记:")
    for n in notes:
        print(f"  [{n['creator']}] {n['title']}")

    # 搜索
    results = search_notes(tmpdir, "排序")
    print(f"\\n搜索「排序」: {len(results)} 条结果")`);

md(`## 5. Skills 模块：可复用工具包

Skills 使用**目录结构**组织 —— 每个 Skill 是一个目录，包含 SKILL.md 和相关文件：

\`\`\`
.coral/public/skills/
  data-augmentation/
    SKILL.md          # 说明文档（含 YAML frontmatter）
    augment.py        # 工具代码
    README.md         # 详细文档
\`\`\``);

code(`def _skills_dir(coral_dir: str) -> Path:
    d = Path(coral_dir) / "public" / "skills"
    d.mkdir(parents=True, exist_ok=True)
    return d


def list_skills(coral_dir: str) -> list[dict]:
    """列出所有技能。"""
    skills_dir = _skills_dir(coral_dir)
    skills = []
    for d in sorted(skills_dir.iterdir()):
        if not d.is_dir():
            continue
        skill_md = d / "SKILL.md"
        if not skill_md.exists():
            continue
        text = skill_md.read_text(encoding="utf-8")
        metadata, body = _parse_frontmatter(text)
        skills.append({
            "name": metadata.get("name", d.name),
            "description": metadata.get("description", ""),
            "creator": metadata.get("creator", "unknown"),
            "created": metadata.get("created", ""),
            "path": str(d),
        })
    return skills


def read_skill(skill_dir: str) -> dict:
    """读取技能详情。"""
    skill_path = Path(skill_dir)
    skill_md = skill_path / "SKILL.md"
    text = skill_md.read_text(encoding="utf-8") if skill_md.exists() else ""
    metadata, body = _parse_frontmatter(text)
    # 递归列出所有文件
    files = []
    for root, dirs, fnames in os.walk(skill_path):
        for f in fnames:
            files.append(os.path.relpath(os.path.join(root, f), skill_path))
    return {"content": text, "metadata": metadata, "body": body, "files": files}


def get_skill_tree(skill_dir: str) -> str:
    """生成技能目录的 ASCII 树。"""
    skill_path = Path(skill_dir)
    lines = [skill_path.name + "/"]
    for root, dirs, files in os.walk(skill_path):
        level = len(Path(root).relative_to(skill_path).parts)
        indent = "  " * level
        for f in sorted(files):
            lines.append(f"{indent}  {f}")
    return "\\n".join(lines)


def format_skills_list(skills: list[dict]) -> str:
    """格式化技能列表。"""
    if not skills:
        return "No skills available."
    lines = []
    for s in skills:
        lines.append(f"  {s['name']}: {s['description']} (by {s['creator']})")
    return "\\n".join(lines)


# === 演示 ===
with tempfile.TemporaryDirectory() as tmpdir:
    skills_dir = _skills_dir(tmpdir)

    # 创建测试技能
    skill1_dir = skills_dir / "data-preprocessor"
    skill1_dir.mkdir()
    (skill1_dir / "SKILL.md").write_text("""---
name: data-preprocessor
description: 通用数据预处理工具
creator: agent-1
created: 2026-04-01T10:00:00
---
# Data Preprocessor

提供数据清洗和标准化功能。
""", encoding="utf-8")
    (skill1_dir / "preprocess.py").write_text("def clean(data): return data", encoding="utf-8")

    skill2_dir = skills_dir / "benchmark-runner"
    skill2_dir.mkdir()
    (skill2_dir / "SKILL.md").write_text("""---
name: benchmark-runner
description: 性能基准测试运行器
creator: agent-2
---
# Benchmark Runner

运行排序算法基准测试。
""", encoding="utf-8")

    # 列出技能
    skills = list_skills(tmpdir)
    print("可用技能:")
    print(format_skills_list(skills))

    # 读取技能详情
    detail = read_skill(str(skill1_dir))
    print(f"\\n技能文件: {detail['files']}")
    print(f"目录树:\\n{get_skill_tree(str(skill1_dir))}")`);

md(`## 6. 保存到 our-implementation/`);

code(`impl_dir = os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation")

hub_code = '''"""共享状态中心 - 从零重新实现 coral/hub/"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from types_ import Attempt


# ========== Attempts ==========

def _attempts_dir(coral_dir: str) -> Path:
    d = Path(coral_dir) / "public" / "attempts"
    d.mkdir(parents=True, exist_ok=True)
    return d

def write_attempt(coral_dir: str, attempt: Attempt) -> None:
    path = _attempts_dir(coral_dir) / f"{attempt.commit_hash}.json"
    path.write_text(json.dumps(attempt.to_dict(), indent=2))

def read_attempts(coral_dir: str) -> list[Attempt]:
    attempts = []
    for f in _attempts_dir(coral_dir).glob("*.json"):
        try:
            attempts.append(Attempt.from_dict(json.loads(f.read_text())))
        except (json.JSONDecodeError, KeyError):
            continue
    return attempts

def get_leaderboard(coral_dir: str, top_n: int = 20, direction: str = "maximize") -> list[Attempt]:
    scored = [a for a in read_attempts(coral_dir) if a.score is not None]
    scored.sort(key=lambda a: a.score, reverse=(direction != "minimize"))
    return scored[:top_n]

def get_agent_attempts(coral_dir: str, agent_id: str) -> list[Attempt]:
    return [a for a in read_attempts(coral_dir) if a.agent_id == agent_id]

def get_recent(coral_dir: str, n: int = 10) -> list[Attempt]:
    attempts = read_attempts(coral_dir)
    attempts.sort(key=lambda a: a.timestamp, reverse=True)
    return attempts[:n]

def search_attempts(coral_dir: str, query: str) -> list[Attempt]:
    q = query.lower()
    return [a for a in read_attempts(coral_dir) if q in f"{a.title} {a.feedback} {a.status}".lower()]

def format_leaderboard(attempts: list[Attempt]) -> str:
    if not attempts:
        return "No attempts yet."
    lines = ["| Rank | Score | Agent | Title | Commit |", "|------|-------|-------|-------|--------|"]
    for i, a in enumerate(attempts, 1):
        s = f"{a.score:.4f}" if a.score is not None else "N/A"
        lines.append(f"| {i} | {s} | {a.agent_id} | {a.title} | {a.commit_hash[:7]} |")
    return "\\n".join(lines)


# ========== Notes ==========

def _notes_dir(coral_dir: str) -> Path:
    d = Path(coral_dir) / "public" / "notes"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _parse_frontmatter(text: str) -> tuple[dict, str]:
    match = re.match(r"^---\\s*\\n(.*?)\\n---\\s*\\n(.*)", text, re.DOTALL)
    if match:
        try:
            return yaml.safe_load(match.group(1)) or {}, match.group(2)
        except yaml.YAMLError:
            pass
    return {}, text

def list_notes(coral_dir: str) -> list[dict]:
    entries = []
    for f in _notes_dir(coral_dir).glob("*.md"):
        text = f.read_text(encoding="utf-8")
        meta, body = _parse_frontmatter(text)
        title = f.stem
        for line in body.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        entries.append({"title": title, "body": body, "metadata": meta, "path": str(f),
                       "creator": meta.get("creator", "unknown"), "created": meta.get("created", "")})
    entries.sort(key=lambda e: str(e.get("created", "")), reverse=True)
    return entries

def search_notes(coral_dir: str, query: str) -> list[dict]:
    q = query.lower()
    return [n for n in list_notes(coral_dir) if q in f"{n['title']} {n['body']}".lower()]


# ========== Skills ==========

def _skills_dir(coral_dir: str) -> Path:
    d = Path(coral_dir) / "public" / "skills"
    d.mkdir(parents=True, exist_ok=True)
    return d

def list_skills(coral_dir: str) -> list[dict]:
    skills = []
    for d in sorted(_skills_dir(coral_dir).iterdir()):
        if not d.is_dir():
            continue
        skill_md = d / "SKILL.md"
        if not skill_md.exists():
            continue
        meta, body = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
        skills.append({"name": meta.get("name", d.name), "description": meta.get("description", ""),
                       "creator": meta.get("creator", "unknown"), "path": str(d)})
    return skills

def read_skill(skill_dir: str) -> dict:
    skill_md = Path(skill_dir) / "SKILL.md"
    text = skill_md.read_text(encoding="utf-8") if skill_md.exists() else ""
    meta, body = _parse_frontmatter(text)
    files = []
    for root, dirs, fnames in os.walk(skill_dir):
        for f in fnames:
            files.append(os.path.relpath(os.path.join(root, f), skill_dir))
    return {"content": text, "metadata": meta, "body": body, "files": files}
'''

with open(os.path.join(impl_dir, "hub.py"), "w", encoding="utf-8") as f:
    f.write(hub_code)
print(f"已保存到 {os.path.join(impl_dir, 'hub.py')}")`);

md(`## 源码映射表

| 我们的实现 | 原始源码 | 说明 |
|-----------|---------|------|
| Attempts CRUD | \`coral/hub/attempts.py\` | 核心逻辑一致，简化了 format_status_summary |
| Notes | \`coral/hub/notes.py\` | 核心逻辑一致，省略了 legacy 格式兼容 |
| Skills | \`coral/hub/skills.py\` | 完全一致 |

### 关键发现

1. **文件系统即数据库**：JSON 文件作为持久化存储，简单且无依赖。
2. **YAML frontmatter**：Notes 和 Skills 都用 frontmatter 存储元数据，正文用 Markdown。
3. **全量加载 + 内存过滤**：数据量小时最简单的查询方案。
4. **双向排序**：排行榜支持 maximize/minimize，通过 direction 参数控制。

---

**上一章**: [03-grader-system.ipynb](03-grader-system.ipynb)
**下一章**: [05-workspace-isolation.ipynb](05-workspace-isolation.ipynb) —— 构建工作空间隔离。`);

const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.11.0' } }, cells: cells };
const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/04-hub-shared-state.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
