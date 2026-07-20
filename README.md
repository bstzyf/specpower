# SpecPower

[![CI](https://github.com/bstzyf/specpower/actions/workflows/ci.yml/badge.svg)](https://github.com/bstzyf/specpower/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/specpower.svg)](https://www.npmjs.com/package/specpower)
[![npm downloads](https://img.shields.io/npm/dm/specpower.svg)](https://www.npmjs.com/package/specpower)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**一句话：plan 想清楚，refine 打磨透，build 做到位，done 归档好。**

SpecPower 把两个开源框架合并成一个工具：
- **OpenSpec** — 结构化需求规划（proposal → specs → design → tasks）
- **Superpowers** — 工程执行纪律（TDD、系统化调试、代码审查、subagent 编排）

一个 CLI + 一套 Claude Code 技能，覆盖从「扫描代码库」到「归档上线」的完整开发生命周期。

---

## 前置依赖

- **Node.js ≥ 20.19.0**（`node --version` 检查）
- **Git**（用于 build 的 worktree 和 done 的分支管理）
- **Claude Code**（斜杠命令入口）

---

## 安装

### 方式 1：从 npm 全局安装（推荐，发布后可用）

```bash
npm install -g specpower
```

### 方式 2：从 GitHub 直接安装（发布前/最新代码）

```bash
npm install -g github:bstzyf/specpower
```

### 方式 3：本地源码安装（开发者 / 贡献者）

```bash
git clone https://github.com/bstzyf/specpower.git
cd specpower
npm install
npm run build
npm link
```

使用 `npm link` 后，在源码里改代码 → 重新 `npm run build` → 全局的 `specpower` 命令立即生效（符号链接）。

### 方式 4：通过本地 tarball 分发

在有源码的机器上打包：
```bash
npm run build
npm pack          # 生成 specpower-3.0.0.tgz
```
在目标机器上安装：
```bash
npm install -g ./specpower-3.0.0.tgz
```

### 验证安装

```bash
specpower --version   # 应输出 3.0.0
specpower --help
```

### 卸载

```bash
npm uninstall -g specpower
# 如果用的是 npm link：
npm unlink -g specpower
```

---

## 在项目中使用

### 初始化（每个项目一次）

```bash
cd your-project
specpower init
```

这一步会：
- 创建 `specpower/` 目录（存放 specs 和 changes）
- 写入 `specpower/config.yaml`（项目上下文 + `version:` 记录初始化时的包版本）
- 在 `.claude/skills/specpower-*/` 生成 10 个技能文件
- 在 `.claude/commands/specpower/` 生成 10 个斜杠命令别名
- 在 `.claude/specpower/` 拷贝 prompts、schemas、templates
- **自动追加** `.gitignore`，忽略可再生的 prompts/schemas/templates（幂等，不覆盖已有内容）

init 后，打开 Claude Code 会话，斜杠命令 `/specpower:*` 立即可用。

### 重复 init 会按版本漂移提示 sync

`init` 写入 `config.yaml` 时会盖一个 `version:` 戳（初始化时安装的包版本）。重复执行 `init` 时，它检测到项目已初始化后，会比较**当前安装的包版本**与 `config.yaml` 里记录的版本：

| 安装包 vs 记录版本 | 行为 |
|---|---|
| 相等（`equal`） | 不做事，直接提示"已初始化" |
| 更新（`newer`） | 提示「是否运行 sync 刷新 skills？」——TTY 下交互 `[y/N]`，非 TTY（CI/管道）自动**不阻塞**、只打印提示 |
| 未记录（`unknown`，老版本 init 的项目无 `version:` 字段） | 同 newer，提示 sync 以补盖版本戳 |
| 更旧（`older`，装了旧版包） | 仅警告，**不自动 sync**（向下同步会让 skills 回退），建议重装匹配版本 |

确认 sync 后，init 会调用 `specpower sync`（项目级）刷新 `.claude/` 资产并把 `config.yaml` 的 `version:` **外科手术式更新**为当前版本（保留注释），于是下次 init 看到 `equal`、不再重复提示。

非交互场景一键接受：

```bash
specpower init -y      # 已初始化且装了新版时，直接 sync，不问
```

> 注意：交互提示仅在 stdin 是 TTY 时出现；CI/脚本里要么用 `init -y`，要么单独跑 `specpower sync`。

### 重新初始化

```bash
# 删掉后重新跑 init
rm -rf specpower/config.yaml .claude/specpower/
specpower init
```

（init 检测到已初始化会拒绝运行，避免误覆盖）

### 升级时同步 skills：`specpower sync`

`npm install -g specpower@latest` 只更新**全局包**里的 skills，不会自动改写你项目里那份 `init` 时拷贝的副本（那是静态文件）。要让新版本的 skills 生效，跑一次 `specpower sync`：

```bash
npm install -g specpower@latest   # 更新全局包
specpower sync                    # 把新 skills 刷进当前项目，再 commit
```

`sync` 是**无守门**的强制刷新（不受"已初始化"拦截），会覆盖 `.claude/skills/specpower-*`、`.claude/commands/specpower/*`，并**清理已废弃**的旧技能目录/命令文件（被新版本删掉或改名的）。项目级（默认）还会一并刷新 `.claude/specpower/` 下的 prompts/schemas/templates，并把 `config.yaml` 的 `version:` 戳更新为当前包版本（保留注释），使下次 `init` 看到 `equal`、不再提示 sync。

#### 两种安装模型

sync 支持两种作用域，对应"skills 放哪一层"的两种取舍：

| 模型 | 命令 | skills 写到 | 适用 |
|---|---|---|---|
| **C 项目级**（默认） | `specpower sync` | `<项目>/.claude/` | skills 进 git 团队共享、每项目可锁版本；升级后需 sync 再 commit |
| **B 用户级** | `specpower sync --user` | `~/.claude/` | 个人多项目统一用最新版，不进 git、全机生效 |

**C（项目级）**：skills 和 prompts 都在项目 `.claude/`，SKILL.md 里的 prompt 引用保持相对路径（`.claude/specpower/prompts/...`），按项目 cwd 解析。流程：`init`（一次）→ 升级 → `sync` → commit。

**B（用户级）**：skills 装到 `~/.claude/skills/`，所有项目共用一份；`sync --user` 会把 SKILL.md 里的 prompt 引用**重写**为指向全局包的绝对路径（`<全局包>/prompts/...`），所以 prompts 不再逐用户拷贝，直接随 `npm install -g` 更新。注意：用户级 skills 不进 git，团队各人各自 `sync --user`；且全机所有项目统一吃同一版本，无法按项目锁版本。

> 选哪种？要 skills 进仓库给团队共享、按项目锁版本 → C；个人多项目、想升级即生效、不靠 git 同步 → B。

---

## 核心流程

**每阶段深度思考 → 多轮迭代精化**：每个阶段一次性产出实质内容（非占位骨架），再通过内部多轮迭代把 artifact 精化到稳态，最后进入执行。

```
/specpower:scan    [规划中 · v0.3] 扫描已有代码生成 specs 基线；当前请直接用 /specpower:plan 描述已有行为
       ↓
/specpower:plan    一次产出 4 个 artifact：proposal + delta specs + design + tasks（first-iteration 深度思考，非纯骨架）
       ↓
/specpower:refine  内部多轮精化循环（≥2 rounds，AI 收敛判定，不设上限）
                   每轮攻击性审查 + 4 个挑战行为：
                     · 挑战假设   · 提新 options
                     · 探边界     · 质疑 scope
                   可更新任意 artifact（proposal / specs / design / tasks）
       ↓
/specpower:build   Phase A：基于 refine 稳定后的 artifact，用 writing-plans 严格精化（rewrite）tasks.md
                   Phase B：逐任务 TDD 执行（subagent 模式）
                   design 有漏即停，回 refine 补齐
       ↓
/specpower:review  代码审查（对照 specs 检查回归）
       ↓
/specpower:test    全量测试（单元 + 集成 + E2E + 回归）
       ↓
/specpower:verify  双重校验（delta specs 验收 + 主 specs 回归）
       ↓
/specpower:done    归档变更 → specs 合并 → git 分支清理
                   默认要求 phase=built，可用 --force 跳过
```

另外两个快捷命令：
```
/specpower:fix     修 Bug 一条龙（调试 → TDD 修复 → 自动归档）
/specpower:snap    事后补档（从 git diff 反推变更记录）
```

### 新机制（v0.2.0）

- **plan 一次产出 4 artifact**：proposal、delta specs、design、tasks 同步生成，每个都是实质的"第一轮深度思考"（first-iteration），不再是占位骨架
- **refine 内部多轮循环**：至少 2 轮，AI 语义判断收敛，不设上限；每轮显式执行 4 个挑战行为（挑战假设 / 提新 options / 探边界 / 质疑 scope）；可更新任意 artifact
- **build Phase A 改为 rewrite**：不再是"生成" tasks.md，而是基于 refine 稳定后的 artifact 用 Superpowers writing-plans 严格规则"精化"重写；发现 design 缺漏即停并回 refine
- **`.specpower.yaml` 新增 `phase` 字段**：追踪变更生命周期（`plan` / `refined` / `built` / `archived`）；`specpower change archive` 默认要求 `phase=built`，可用 `--force` 跳过守门

---

## 快速上手示例

### 5 分钟跑通全流程

```bash
# 1. 安装（任选一种）
npm install -g specpower

# 2. 进入你的项目
cd my-project

# 3. 初始化
specpower init

# 4. 打开 Claude Code，在会话里输入：
/specpower:plan "给用户管理模块加个批量导入功能"
```

Claude Code 接下来会：
1. 读 `.claude/skills/specpower-plan/SKILL.md` 编排器
2. 问你几个澄清问题（一次一个）
3. 生成 `specpower/changes/bulk-import/proposal.md`
4. 展示 proposal 等你**确认**
5. 确认后生成 delta specs `specs/*/spec.md`
6. 提示你下一步是 `/specpower:refine`

### 更完整的示例（4 个场景）

#### 场景 1：新项目从零开始

```
/specpower:plan "添加用户注册和登录功能"
/specpower:refine           # 讨论技术方案，输出 design.md
/specpower:build            # TDD 实现，每任务用户确认
/specpower:review           # 代码审查
/specpower:test             # 跑测试
/specpower:verify           # 对照 specs 验收
/specpower:done             # 归档 + merge
```

#### 场景 2：接手已有项目（v0.2.x 工作流）

```bash
cd legacy-project
specpower init

# 在 Claude Code 里：
# 注意：/specpower:scan 当前规划在 v0.3，未实现。
# v0.2.x 的推荐做法是直接进 plan，在 proposal Q&A 里描述已有行为 +
# 新增变更，让 plan 为将要改动的 capability 生成 delta spec 基线。
/specpower:plan "描述已有行为 + 你这次要改的新功能"
/specpower:refine             # 对 plan 产出做 ≥2 轮攻击性审查
/specpower:build              # Phase A 重写 tasks.md → Phase B TDD
/specpower:done               # 归档，delta spec 合入主 specs/
```

#### 场景 3：紧急修 Bug

```
/specpower:fix "登录接口在 token 过期时返回 500 而不是 401"
```

一条命令包含：
1. 自动创建轻量变更
2. 定位相关 specs（对照规格理解预期行为）
3. 系统化调试（4 步法：调查 → 模式 → 假设 → 验证）
4. TDD 修复（先写复现测试让它红，再修代码让它绿）
5. 自动代码审查
6. 跑测试
7. 归档

紧急模式跳过审查：
```
/specpower:fix --urgent "生产环境崩溃"
```

#### 场景 4：同事改了代码没走流程，事后补档

```
/specpower:snap "重构了认证模块"
```

分析 git diff + git log，反推完整变更记录，推断受影响的 specs，用户确认后自动归档。

---

## 命令速查

### Claude Code 技能命令（在 Claude Code 会话里用）

| 命令 | 说明 |
|---|---|
| `/specpower:scan` | **[规划中 · v0.3]** 扫描已有代码库生成 specs 基线；v0.2.x 未实现，触发时 skill 会提示替代方案 |
| `/specpower:plan` | 需求规划：生成 proposal + delta specs |
| `/specpower:refine` | 技术方案探讨（brainstorming + design.md） |
| `/specpower:build` | 两阶段构建：生成计划 → subagent TDD 执行 |
| `/specpower:review` | 代码审查（含 specs 回归检查） |
| `/specpower:test` | 全量测试 + 验证（单元/集成/E2E/回归） |
| `/specpower:verify` | 双重校验：delta specs 验收 + 主 specs 回归 |
| `/specpower:done` | 归档变更 + specs 合并 + git 分支清理 |
| `/specpower:fix` | 修 Bug 快速通道（调试 → TDD → 归档） |
| `/specpower:snap` | 事后补档（从 git diff 反推变更记录） |

### CLI 命令（在终端里用）

| 命令 | 说明 |
|---|---|
| `specpower init` | 初始化项目（生成目录、技能、prompts） |
| `specpower change new <名称>` | 创建新的变更 |
| `specpower change status <名称>` | 查看变更的 artifact 完成状态 |
| `specpower change archive <名称>` | 归档变更（delta merge + 移入 archive） |
| `specpower validate <文件>` | 校验 spec 文件格式 |
| `specpower instructions <artifact> <change>` | 查看某个 artifact 的创建指令 |

CLI 命令会从当前目录**向上查找**项目根（找 `specpower/config.yaml`），类似 `git` 的行为。在项目任意子目录下运行都能工作。

---

## 架构

SpecPower 分三层，各司其职：

```
┌─────────────────────────────────────────────────┐
│  CLI 层（确定性逻辑）                              │
│  TypeScript 实现。负责文件操作、specs 校验、        │
│  artifact 状态追踪、delta merge、归档。            │
│  不涉及任何 AI 逻辑。                             │
├─────────────────────────────────────────────────┤
│  SKILL.md 层（编排层）                             │
│  每个命令一个 SKILL.md（50-100 行）。              │
│  定义工作流阶段、hard gate 门禁、用户确认点。       │
│  通过 Read 指令按需加载 prompt 文件。              │
├─────────────────────────────────────────────────┤
│  Prompts 层（执行指令）                            │
│  详细的指令文件，告诉 Claude Code 在每个阶段        │
│  具体怎么做：写 proposal、做 brainstorming、       │
│  执行 TDD、做 code review 等。                    │
│  按需加载，不会一次全部塞进 context。               │
└─────────────────────────────────────────────────┘
```

**为什么这样设计？**

- **渐进加载**：一个 SKILL.md 如果把所有 prompt 内嵌进去会超过 1000 行，Claude Code 容易"迷路"。拆成小文件按阶段加载，每个阶段的指令清晰聚焦。
- **Hard Gate 双重保障**：关键门禁（如"设计未确认不许写代码"）在 SKILL.md 编排层和 prompt 文件两处都声明，防止执行漂移。
- **CLI 处理确定性操作**：delta specs 合并、格式校验等需要精确文本操作的工作由 TypeScript 代码执行，不靠 AI 猜。

---

## 关键概念

### Specs（规格文件）

存放在 `specpower/specs/` 目录，是项目的 **Source of Truth（唯一事实来源）**。

每个 spec 文件描述一个功能模块的行为规格：

```markdown
### Requirement: 用户登录
系统应当支持通过邮箱和密码进行用户认证。

#### Scenario: 登录成功
- **WHEN** 用户提交有效凭据
- **THEN** 系统返回认证 token

#### Scenario: 登录失败
- **WHEN** 用户提交错误密码
- **THEN** 系统返回 401 错误
```

### Changes（变更记录）

存放在 `specpower/changes/` 目录。每次新功能或修复都是一个 change。

一个 change 包含：
- `proposal.md` — 为什么做、做什么
- `specs/` — delta specs（ADDED/MODIFIED/REMOVED/RENAMED 的需求变更）
- `design.md` — 技术方案
- `tasks.md` — 实施任务清单（带 checkbox）

归档时，delta specs 会自动合并到主 specs，change 移入 `specpower/changes/archive/`。

### Delta Specs（增量规格）

描述对现有 specs 的变更，支持四种操作：

```markdown
## ADDED Requirements
（新增的需求）

## MODIFIED Requirements
（修改的需求 — 必须包含完整更新内容）

## REMOVED Requirements
（删除的需求 — 必须说明原因和迁移方案）

## RENAMED Requirements
（重命名 — FROM: 旧名 / TO: 新名）
```

---

## 项目产生的目录结构

`specpower init` 后，你的项目会新增：

```
your-project/
├── specpower/              # 需求管理（应该跟踪到 git）
│   ├── config.yaml         # 项目上下文配置
│   ├── specs/              # 主 specs（Source of Truth）
│   ├── changes/            # 活跃的变更
│   │   └── <name>/         # 每个变更的 artifact
│   │       ├── proposal.md
│   │       ├── specs/
│   │       ├── design.md
│   │       └── tasks.md
│   └── changes/archive/    # 归档的变更
│
└── .claude/
    ├── skills/specpower-*/ # 10 个技能（应该跟踪）
    ├── commands/specpower/ # 10 个命令别名（应该跟踪）
    └── specpower/          # 资源文件（.gitignore 自动忽略）
        ├── prompts/
        ├── schemas/
        └── templates/
```

建议的 git 策略：
- **跟踪**：`specpower/`、`.claude/skills/`、`.claude/commands/specpower/`（团队共享的规格和技能）
- **忽略**：`.claude/specpower/{prompts,schemas,templates}/`（`specpower init` 自动忽略，因为这些可由升级 specpower 重新生成）

---

## 故障排查

### `specpower: command not found`

- 确认 `npm install -g` 成功
- 检查 `npm config get prefix` 下的 `bin` 目录是否在 PATH 里

### `No specpower project found at or above <dir>`

CLI 找不到项目根。确保：
- 你在一个跑过 `specpower init` 的项目目录里（或其子目录）
- `specpower/config.yaml` 存在

### `错误: Change "xxx" already exists`

变更名冲突。要么用不同名字，要么先归档已有的。

### Node 版本不兼容

specPower 需要 Node ≥ 20.19.0。用 `nvm` 切版本：
```bash
nvm install 20
nvm use 20
npm install -g specpower
```

### code-review-graph 安装失败

`/specpower:scan` 规划在 v0.3 实现时会用到 code-review-graph（当前在 optionalDependencies 里占位）。这个依赖是从 GitHub 安装的，如果网络问题导致失败，**不影响任何 v0.2.x 功能**——scan 本身在 v0.2.x 不可用，其余所有命令与此依赖无关。

---

## 来源与许可

SpecPower 基于两个开源项目构建（均为 MIT 许可）：
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — artifact graph、delta merge、validation 等核心运行时
- [Superpowers](https://github.com/obra/superpowers) — brainstorming、TDD、debugging、code review 等 prompt

所有来源内容已按 specPower 风格改写，通过 `<!-- SOURCE: ... -->` 注释标注出处。

**许可证：MIT**
