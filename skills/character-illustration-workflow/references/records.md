# 记录格式与命令

在仓库根目录运行。始终使用独立的 `--run`，下例采用先成图路线。配方的 `display_title` 控制页面标题，`asset_id` 标识项目；角色属性和完整提示词需要逐项编辑。

```sh
node tools/deliver.mjs --run runs/my-character init --recipe tools/recipes-v3.json
node tools/deliver.mjs --run runs/my-character prepare DIRECT_V3
node tools/deliver.mjs --run runs/my-character prompt DIRECT_V3
```

然后在实际图像工具中执行生成，将真实 PNG 导入。以下尖括号是需要替换的参数，不要原样执行：

```text
node tools/deliver.mjs --run runs/my-character ingest DIRECT_V3 <PNG路径>
node tools/deliver.mjs --run runs/my-character qa DIRECT_V3 <QA文件路径>
node tools/deliver.mjs --run runs/my-character select direct DIRECT_V3 <选择理由> <人工证据文件路径>
node tools/deliver.mjs --run runs/my-character prepare LINE_V3
node tools/deliver.mjs --run runs/my-character render
node tools/preview.mjs --run runs/my-character --port 8777
```

QA 文件示例结构如下；内容必须来自实际读图，不能把此示例当成已经完成的检查：

```json
{
  "hard_fail": [],
  "observations": ["填写实际观察"],
  "manual_retouch": ["填写尚需人工处理的项目"],
  "structure_check": {"status": "uncertain", "notes": "待实际检查"}
}
```

`structure_check.status` 为 pass、fail 或 uncertain。只有实际检查通过并无 hard_fail 的候选才能选中。review 默认需要人工证据；demo 只有在明确授权的批次中使用，选中者记录为 agent_demo。

`project.json` 保存阶段、候选、引用、哈希、选择和 QA。`events.jsonl` 保存操作事件。`prepare` 检查前序选择，固定参考 ID 与哈希；`ingest` 不覆盖已有图像。重新选择上游后，下游结果过期但原件保留。

未生成的提示词可以修订，旧文件会归档，之后需要重新 prepare：

```text
node tools/deliver.mjs --run runs/my-character set-prompt LINE_V3 <新提示词文件>
node tools/deliver.mjs --run runs/my-character add <修正配方JSON>
```

修正配方包含新的安全 ID、原图所属 stage、kind=image、repair_of、完整 prompt 与 reference_specs；父候选必须有真实图片，且修正不能超过 repair_limit。

`status` 查询状态；`render` 写比较页；`verify` 写核验结果并对缺项返回非零。完成前需写 `REPORT.md`，先成图页面的 `MANUAL_RETOUCH.md` 用于尚未完成的修绘清单。`finish` 表示试跑完成待人工复核，不代表人工定稿。`block <原因>` 记录未完成。

`assets/project-template.json` 是空白状态模板，不是候选配方。三份 tools/recipes 文件才是 CLI 示例：schema 1 兼容路线、schema 2 从零路线、schema 2 先成图路线。

源图片绝对路径和人工证据可能进入本地记录。runs 默认不提交；公开自己的项目时需另行制作脱敏副本，不修改原始证据后仍宣称它是原记录。CLI 只约束自身记录操作，不认证证据作者，不拦截外部生成工具。
