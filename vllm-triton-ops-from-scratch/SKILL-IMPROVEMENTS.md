# Skill Improvement Notes — vLLM Triton Ops Tutorial

> Auto-maintained during tutorial generation. Each entry is a concrete,
> actionable suggestion for improving the `reimpl-tutorial` skill.

## Process

### No original tests for non-library projects
- **Phase encountered:** 1
- **Current behavior:** Skill requires copying tests to `original-tests/` and running them
- **Problem:** This tutorial is about *how to use* a library's extension mechanism, not reimplementing the library itself. There are no "original tests" to copy — the tutorial creates its own verification code.
- **Suggested fix:** Add a project-type classification step. For "how-to-use" tutorials (vs "reimplement" tutorials), skip the original-tests requirement and instead require inline verification cells.
- **Evidence:** No test files were copied because the tutorial teaches a workflow, not reimplements a codebase.

### Tutorial vs Reimplementation distinction
- **Phase encountered:** 2
- **Current behavior:** Skill assumes the goal is always to reimplement the target project from scratch
- **Problem:** The user's request was to teach "how to use Triton to add custom ops in vLLM" — this is a *usage tutorial*, not a *reimplementation*. The cognitive ordering should follow the user's workflow, not the library's internal structure.
- **Suggested fix:** Add an explicit step in Phase 1 to classify: (a) Reimplementation tutorial — rebuild the project, (b) Usage tutorial — teach how to use/extend the project. Adjust templates accordingly.
- **Evidence:** The notebook structure follows a developer workflow (basics → registration → fusion → replacement) rather than reimplementing vLLM's internals.

### Chinese text in notebooks works well with JS builder
- **Phase encountered:** 3
- **Current behavior:** Skill warns about Chinese text issues
- **Problem:** No actual issues encountered. JS template literals handle Chinese text perfectly, and JSON.stringify handles all escaping.
- **Suggested fix:** Reduce the warning severity. The JS builder pattern already solves this completely.
- **Evidence:** All 6 notebooks with extensive Chinese content passed JSON validation.

## Notebook Standards

### Mermaid in code cells warning could be more prominent
- **Phase encountered:** 3
- **Current behavior:** Skill mentions mermaid must go in markdown cells
- **Problem:** This is correct and important. No issues encountered because the instruction was followed.
- **Suggested fix:** No change needed, the instruction is clear.

## Changelog

- 2026-04-05: Initial creation with 4 improvement suggestions
- 2026-04-12: Added continuation-mode suggestions from Notebook 06-09 session
- 2026-04-12: Phase 5 review — applied generalizable improvements to SKILL.md:
  - **Accepted → "Continuing an existing tutorial project"**: Added "Phase 1 (Continuation Mode)" section to SKILL.md with 5-step lighter variant for adding notebooks to existing projects.
  - **Accepted → "Cross-project analysis"**: Added "Phase 1 (Comparative Tutorial Mode)" section to SKILL.md with cross-project mapping table, comparison axes, and side-by-side structure guidance.
  - **Already addressed → "No original tests for non-library projects"**: Phase 1 Step 7 usage-tutorial mode was already in upstream SKILL.md update.
  - **Already addressed → "Tutorial vs Reimplementation distinction"**: Phase 1 Step 7 project-type classification was already in upstream SKILL.md update.
  - **Already addressed → "Chinese text works well with JS builder"**: Chinese Text Rules section was already updated with reduced severity in upstream.
  - **Already addressed → "Mermaid in code cells warning"**: Mermaid lint check was already added to builder script template in upstream.

## Process (Continuation)

### Continuing an existing tutorial project
- **Phase encountered:** 1
- **Current behavior:** Skill assumes starting a fresh project from scratch
- **Problem:** When continuing an existing tutorial (adding Notebooks 06-09 to an existing 00-05 project), the Phase 1 analysis should focus on the *new scope* while respecting the existing structure (diagram mode, naming conventions, etc.)
- **Suggested fix:** Add a "continuation mode" step in Phase 1 that reads existing SUMMARY.md, understands the established patterns, and plans only the new notebooks.
- **Evidence:** Had to read existing project state before adding new notebooks, without re-analyzing the entire vLLM codebase.

### Cross-project analysis
- **Phase encountered:** 1
- **Current behavior:** Skill focuses on a single target project
- **Problem:** The user asked to analyze *two* projects (vLLM's matmul operators AND the 03_matmul_optimization project) and compare them. The skill doesn't have guidance for multi-project comparative tutorials.
- **Suggested fix:** Add a "comparative tutorial" mode where notebooks explicitly bridge two codebases, with side-by-side source mapping tables.
- **Evidence:** Notebooks 07 and 09 had to compare vLLM's fused_moe_kernel with the matmul_optimization project's ultimate GEMM.
