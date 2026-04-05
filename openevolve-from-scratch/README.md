# OpenEvolve — 从零到专家·手撕全流程

> 通过从零重新实现 [OpenEvolve](https://github.com/codelion/openevolve) 来深度理解它——用 Jupyter Notebook 一步一步构建。

## 这是什么？

这是一套教程系列，通过**从零重新实现**的方式深度解析 OpenEvolve（Google DeepMind AlphaEvolve 的开源实现）。每个 Notebook 引入一个新特性，解释它的理论基础，从头编写代码，并通过运行验证正确性。

## 面向谁？

- 想深度理解进化算法 + LLM 系统的开发者
- 想学习 MAP-Elites、岛屿进化等算法的研究者
- 想入门 AI 代码优化的零基础读者

## 教程结构

| 章节 | 主题 | 关键概念 |
|------|------|---------|
| [00 — 为什么要做这个项目](notebooks/00-why-this-project.ipynb) | 问题定义与设计思路 | AlphaEvolve、进化+LLM |
| [01 — 最小可行进化器](notebooks/01-minimal-viable.ipynb) | 核心进化循环 | (1+1)-ES、评估器、变异 |
| [02 — MAP-Elites](notebooks/02-map-elites.ipynb) | 质量-多样性优化 | MAP-Elites 网格、特征缩放 |
| [03 — 岛屿进化](notebooks/03-island-evolution.ipynb) | 多种群隔离进化 | 岛屿模型、迁移策略 |
| [04 — LLM 作为变异算子](notebooks/04-llm-mutator.ipynb) | 智能代码变异 | Prompt 工程、LLM 集成 |
| [05 — 级联评估](notebooks/05-cascade-evaluation.ipynb) | 多阶段过滤 | 级联评估、资源优化 |
| [06 — 基于 Diff 的进化](notebooks/06-diff-based-evolution.ipynb) | 精准代码修改 | SEARCH/REPLACE、差异演化 |
| [07 — 进程并行](notebooks/07-process-parallel.ipynb) | 并行加速 | ProcessPoolExecutor |
| [08 — 检查点机制](notebooks/08-checkpoint.ipynb) | 断点续跑 | 序列化、状态恢复 |
| [09 — 完整集成](notebooks/09-full-integration.ipynb) | 系统集成与测试 | 端到端流程 |

## 快速开始

```bash
# 克隆仓库
git clone <this-repo>
cd openevolve-from-scratch

# 安装依赖
pip install jupyter matplotlib numpy

# 启动 Jupyter
jupyter notebook notebooks/00-why-this-project.ipynb
```

## 目录结构

```
openevolve-from-scratch/
├── notebooks/          # Jupyter Notebook 教程（按章节编号）
├── our-implementation/ # 我们从零构建的代码（每章逐步添加）
├── original-tests/     # 从 OpenEvolve 提取的原始测试
└── references/         # 参考文献和论文链接
```

## 设计理念

1. **认知顺序** — 按理解难度排列，而非代码目录结构
2. **痛点驱动** — 每章让你感受到限制，下一章解决它
3. **贯穿例子** — 排序算法从第一章演化到最后一章
4. **代码即证明** — 每个理论推导都有对应的可运行代码
5. **对照原文** — 每个实现都标注对应的 OpenEvolve 源码位置

## 特性列表

完整的特性分析和认知学习顺序见 [feature-list.md](feature-list.md)。

## 致谢

- [OpenEvolve](https://github.com/codelion/openevolve) — 原始项目
- [AlphaEvolve](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/) — Google DeepMind 论文
- Mouret & Clune (2015) — MAP-Elites 算法
