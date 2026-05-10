
"""our-implementation/core.py — 最小进化代码优化器。

在第一章中构建，后续章节会扩展。
"""
import random
import time
from dataclasses import dataclass, field
from typing import Optional, Callable


@dataclass
class Program:
    """一个已进化的程序及其评估结果。"""
    code: str
    metrics: dict = field(default_factory=dict)
    generation: int = 0
    parent_id: Optional[int] = None


class ProgramStore:
    """最小程序存储——带最优跟踪的列表。"""
    def __init__(self):
        self.programs: list[Program] = []
        self.best: Optional[Program] = None

    def add(self, program: Program):
        self.programs.append(program)
        score = program.metrics.get("score", 0.0)
        if self.best is None or score > self.best.metrics.get("score", 0.0):
            self.best = program

    def sample_parent(self) -> Program:
        return random.choice(self.programs)

    def __len__(self):
        return len(self.programs)


def run_evolution(
    initial_code: str,
    evaluator_fn: Callable[[str], dict],
    mutator_fn: Callable[[str], str],
    iterations: int = 200,
) -> tuple[Program, list[dict]]:
    """核心 (1+1)-ES 进化循环。"""
    store = ProgramStore()
    history = []
    initial_metrics = evaluator_fn(initial_code)
    store.add(Program(code=initial_code, metrics=initial_metrics, generation=0))

    for i in range(iterations):
        parent = store.sample_parent()
        child_code = mutator_fn(parent.code)
        child_metrics = evaluator_fn(child_code)

        if child_metrics.get("correct", False):
            child = Program(
                code=child_code,
                metrics=child_metrics,
                generation=parent.generation + 1,
                parent_id=id(parent),
            )
            store.add(child)

        history.append({
            "iteration": i,
            "best_score": store.best.metrics["score"],
            "population_size": len(store),
        })

    return store.best, history
