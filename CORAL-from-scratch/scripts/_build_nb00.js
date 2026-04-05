const fs = require('fs');
const cells = [];

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
// Chapter 00: 为什么需要 CORAL
// ============================================================

md(`# 第零章：为什么需要 CORAL？

> 从「一个人写代码」到「一群 AI 代理并行优化」—— 理解 CORAL 要解决的核心问题。

## 本章内容

- 自主编码代理的兴起与瓶颈
- 手动编排多个代理的痛点
- CORAL 的核心设计理念
- 系统架构全景图
- 一个贯穿全教程的运行示例`);

md(`## 1. 问题：AI 编码代理的瓶颈

想象这样一个场景：你有一个机器学习竞赛任务，需要不断迭代模型以提升分数。

**单代理方案**：让一个 Claude Code 实例不断尝试 —— 但它会陷入局部最优，且没有「记忆」之前的尝试结果。

**手动多代理方案**：开多个终端，每个运行一个 Claude Code —— 但你需要：
1. 手动创建隔离的工作目录（避免代码冲突）
2. 手动评估每次提交的质量
3. 手动让代理之间共享发现
4. 手动监控哪些代理还活着
5. 手动重启崩溃的代理

这就像管理一个没有项目管理工具的远程团队 —— 混乱且低效。`);

md(`## 2. CORAL 的解决方案

CORAL（Collaborative Optimization with Recursive Agent Loops）的核心理念：

> **让代理成为优化器** —— 自动生成、评估、共享、循环。

### 核心循环

\`\`\`
coral start --config task.yaml
  → 创建 .coral/ 共享状态目录
  → 为每个代理创建独立的 git worktree
  → 生成 CORAL.md 指令文件
  → 启动 Claude Code 代理

每个代理：
  → 读取 CORAL.md 获取任务指令
  → 编辑代码，提交更改
  → 运行 coral eval -m "描述"
  → 评分器自动评分，结果写入 .coral/attempts/
  → 代理看到分数，决定下一步
  → 在 .coral/notes/ 中分享发现
  → 在 .coral/skills/ 中封装可复用工具
  → 循环...
\`\`\``);

md(`## 3. 架构全景图

\`\`\`mermaid
flowchart TB
    subgraph 用户层
        CLI[coral CLI<br/>start/stop/status/log]
        WebUI[Web 仪表盘<br/>实时监控]
    end

    subgraph 编排层
        Config[CoralConfig<br/>YAML 配置]
        Manager[AgentManager<br/>生命周期管理]
        Template[CORAL.md 生成器<br/>代理指令]
    end

    subgraph 代理层
        A1[Agent 1<br/>git worktree]
        A2[Agent 2<br/>git worktree]
        A3[Agent N<br/>git worktree]
    end

    subgraph 评估层
        Eval[Eval Pipeline<br/>commit→grade→record]
        Grader[评分器<br/>Protocol/TaskGrader]
    end

    subgraph 共享状态 [".coral/public/"]
        Attempts[attempts/<br/>JSON 评估记录]
        Notes[notes/<br/>Markdown 笔记]
        Skills[skills/<br/>可复用工具]
    end

    CLI --> Config --> Manager
    Manager --> Template
    Manager --> A1 & A2 & A3
    A1 & A2 & A3 --> Eval --> Grader
    Eval --> Attempts
    A1 & A2 & A3 -.->|读写| Notes & Skills
    A1 & A2 & A3 -.->|读取| Attempts
    WebUI -.->|SSE 实时更新| Attempts
\`\`\``);

md(`## 4. 关键设计决策

| 设计选择 | 原因 | 替代方案 |
|----------|------|----------|
| Git Worktree 隔离 | 每个代理有独立代码副本，避免冲突 | Docker 容器（太重）、目录复制（不支持 diff） |
| 文件系统作为数据库 | 简单、无依赖、代理可直接读写 | SQLite（需要驱动）、Redis（需要服务） |
| 符号链接共享状态 | 零拷贝跨 worktree 共享 | Git submodule（太复杂）、网络共享（不可靠） |
| Protocol 鸭子类型 | 评分器无需继承即可兼容 | ABC 抽象类（耦合太强） |
| 多进程评分 | 可硬杀超时的同步评分代码 | asyncio.timeout（无法中断 NumPy 等 C 扩展） |`);

md(`## 5. 运行示例：贯穿全教程

我们将用一个简单的例子贯穿整个教程：

> **任务**：编写一个函数，对列表进行排序。评分器会用多个测试用例检验正确性和性能。

这个例子足够简单，但能展示 CORAL 的所有核心功能：
- **Task**：定义排序任务的名称和描述
- **Score**：正确性得分（0-1）
- **Attempt**：每次提交的排序实现
- **Config**：任务配置 YAML
- **Grader**：验证排序正确性的评分器
- **Hub**：代理之间共享排序算法发现
- **Workspace**：隔离的排序实现工作目录
- **Eval**：提交排序代码 → 评分 → 记录`);

code(`# 我们的运行示例：一个简单的排序任务
# 后续每章都会围绕这个任务扩展

SORT_TASK = {
    "name": "sort-optimizer",
    "description": "实现一个高效的排序函数，处理各种边界情况",
}

# 一个简单的排序实现（代理的初始尝试）
def naive_sort(arr):
    """冒泡排序 - 简单但慢"""
    arr = list(arr)
    for i in range(len(arr)):
        for j in range(len(arr) - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr

# 测试
test_cases = [
    ([3, 1, 4, 1, 5], [1, 1, 3, 4, 5]),
    ([], []),
    ([1], [1]),
    ([5, 4, 3, 2, 1], [1, 2, 3, 4, 5]),
]

for input_arr, expected in test_cases:
    result = naive_sort(input_arr)
    assert result == expected, f"Failed: {input_arr} -> {result}"

print("所有测试通过！但冒泡排序的时间复杂度是 O(n^2)...")
print("CORAL 的代理会自动迭代优化这个实现。")`);

md(`## 6. 教程路线图

接下来的 9 章，我们将从零开始重新实现 CORAL 的每个核心模块：

| 章节 | 构建内容 | 解决的问题 |
|------|----------|------------|
| 01 | 核心类型 | 如何表示任务、评分和尝试记录？ |
| 02 | 配置系统 | 如何灵活地定义和覆盖任务配置？ |
| 03 | 评分器 | 如何自动评估代码质量？ |
| 04 | 共享状态 | 多个代理如何交换知识？ |
| 05 | 工作空间 | 如何安全地隔离多个代理？ |
| 06 | 评估流水线 | 如何串联「提交→评分→记录」？ |
| 07 | 代理管理 | 如何启动、监控和重启代理？ |
| 08 | 模板与 CLI | 如何生成代理指令并提供用户界面？ |
| 09 | 完整集成 | 如何把所有模块组装成可运行的系统？ |

每章都遵循同一个模式：
1. **展示痛点** —— 没有这个功能会怎样？
2. **推导方案** —— 从第一性原理出发设计
3. **动手实现** —— 编写可运行的代码
4. **对照原版** —— 与 CORAL 源码对比
5. **验证测试** —— 确保实现正确`);

md(`## 源码映射表

| 本教程模块 | 原始源码 | 章节 |
|-----------|---------|------|
| 运行示例定义 | \`coral/types.py\` | Ch.00 |
| Task, Score, Attempt | \`coral/types.py\` | Ch.01 |
| CoralConfig | \`coral/config.py\` | Ch.02 |
| GraderInterface, BaseGrader, TaskGrader | \`coral/grader/\` | Ch.03 |
| attempts, notes, skills | \`coral/hub/\` | Ch.04 |
| Worktree setup, symlinks | \`coral/workspace/\` | Ch.05 |
| run_eval, post_commit | \`coral/hooks/post_commit.py\` | Ch.06 |
| AgentRuntime, AgentManager | \`coral/agent/\` | Ch.07 |
| generate_coral_md, CLI | \`coral/template/\`, \`coral/cli/\` | Ch.08 |

---

**下一章**：[01-core-types.ipynb](01-core-types.ipynb) —— 从最基础的类型系统开始构建。`);

const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
              language_info: { name: 'python', version: '3.11.0' } },
  cells: cells
};

const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/00-why-coral.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
