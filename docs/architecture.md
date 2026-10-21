# 实际架构

`deliver.mjs` 读取配方，在工作区内的 run 目录保存 `project.json` 和 `events.jsonl`。PNG、完整提示词和 QA 分别进入 `images/`、`prompts/`、`qa/`。没有数据库、远程服务或生成引擎。

`prepare` 固定阶段参考的实际 ID、顺序、作用和哈希；`ingest` 导入外部 PNG；`qa` 保存检查；`select` 更新选择并使依赖旧上游的结果过期。`verify` 核对记录和文件，同时写出 `verification.json`，不是只读命令。

schema 1 为兼容路线；schema 2 使用配方的 `stage_order`。schema 2 页面由 `gallery-v2.mjs` 导出的两个生成器负责。文件名中的 v2 不表示仅支持第二轮案例。

`reference-core.mjs` 是独立可导入模块。其规则沿用原参考目录设计，包括数值收藏门槛、来源证据和策展字段，不是通用艺术质量评分。`sampleReferences` 的 seed 只复现本地排序，不控制图像模型。发行版没有私有目录数据、采集服务或参考库 CLI。

公开案例仅包含获得批准的图片、相对路径清单和独立 HTML。它不携带生成提示词、用户选择证据或原始调用日志。

`preview.mjs` 仅绑定 loopback，供本机浏览静态文件，不应直接当作公网应用部署。
