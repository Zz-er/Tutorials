# vLLM Triton 算子开发教程：从零到一

> 手撕 vLLM 中的 Triton 算子系统——从编写自定义算子、融合算子到替换模型算子实现

## 环境要求

- Python >= 3.10
- PyTorch >= 2.1
- Triton >= 2.1
- NVIDIA GPU (Compute Capability >= 7.0)

```bash
pip install -r requirements.txt
```

## 阅读顺序

请按照编号顺序阅读 `notebooks/` 目录下的 Jupyter Notebook：

| 编号 | 主题 | 前置知识 |
|------|------|---------|
| 00 | 项目概览与动机 | 无 |
| 01 | Triton Kernel 基础 | 基本 PyTorch |
| 02 | CustomOp 注册系统 | Notebook 01 |
| 03 | 融合算子 | Notebook 01-02 |
| 04 | 模型级算子替换 | Notebook 01-03 |
| 05 | 完整集成与最佳实践 | Notebook 01-04 |
| 06 | 矩阵乘法算子全景 | Notebook 00-05 |
| 07 | Fused MoE Triton GEMM | Notebook 06 + Ch.12-18 |
| 08 | Triton 注意力 GEMM | Notebook 06-07 |
| 09 | 性能对比与差距分析 | Notebook 06-08 |
| 10 | TP 通信与 GEMM 协同 | Notebook 06-09 |
| 11 | 在 Qwen3.5 上部署自定义 Triton GEMM | Notebook 01-10 |
| 12 | CUDA Graph 机制与 GEMM 影响 | Notebook 06-11 |

## 三个核心场景

### 场景 1: 添加自定义算子
编写 Triton kernel → 注册为 CustomOp → 在模型中使用

### 场景 2: 添加融合算子
分析 memory-bound 瓶颈 → 合并多个操作到单个 kernel → 自动调优

### 场景 3: 替换模型算子
使用 OOT 注册机制 → 继承原始类 → 覆盖 forward_cuda → 零侵入替换

### 场景 4: 理解 vLLM 的矩阵乘法算子
GQA/MLA/GDN/MoE 的 GEMM 实现 → Triton vs cuBLAS 的选择 → 性能对比

### 场景 5: 在真实模型上部署自定义 GEMM
编写 Triton GEMM → 通过 PluggableLayer 替换线性层 → 在 Qwen3.5 上验证 → 打包为 vLLM 插件

### 场景 6: 理解 CUDA Graph 对算子的影响
CUDA Graph capture/replay 机制 → vLLM 的 5 种模式 → capture sizes 与 padding → M/N/K 维度约束 → 自定义 Triton GEMM 适配

## 项目结构

```
vllm-triton-ops-from-scratch/
├── README.md                 # 本文件
├── SUMMARY.md                # 所有 Notebook 概要
├── requirements.txt          # 依赖
├── notebooks/
│   ├── 00-why-this-project.ipynb
│   ├── 01-triton-kernel-basics.ipynb
│   ├── 02-custom-op-registration.ipynb
│   ├── 03-fused-operators.ipynb
│   ├── 04-replace-model-ops.ipynb
│   ├── 05-full-integration.ipynb
│   ├── 06-vllm-matmul-landscape.ipynb
│   ├── 07-fused-moe-triton-gemm.ipynb
│   ├── 08-triton-attention-gemm.ipynb
│   ├── 09-performance-comparison.ipynb
│   ├── 10-tp-communication-gemm.ipynb
│   ├── 11-custom-triton-gemm-on-qwen.ipynb
│   └── 12-cuda-graph-and-gemm.ipynb
└── references/
    └── papers.md
```

## 对应的 vLLM 源码

本教程基于 vLLM 主分支，核心文件：

- `vllm/model_executor/custom_op.py` — CustomOp 基类与注册机制
- `vllm/model_executor/layers/activation.py` — 激活函数（含 Triton kernel）
- `vllm/model_executor/layers/layernorm.py` — RMSNorm（含融合实现）
- `vllm/model_executor/models/llama.py` — Llama 模型
- `vllm/triton_utils/` — Triton 导入与兼容性
