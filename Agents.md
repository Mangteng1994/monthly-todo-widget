# Agents.md

## 项目目标

本项目是一个思源笔记挂件，目录位于思源工作空间的 `data/widgets/monthly-todo-widget`。目标是提供一个月度待办视图，适合作为嵌入式挂件在思源文档中使用。

## 开发约定

- 优先保持实现简单，挂件应能直接由思源加载静态资源运行。
- 修改前先查看现有文件结构，沿用项目已有命名、样式和组织方式。
- 避免引入大型构建链，除非功能复杂度确实需要。
- 前端代码应兼容思源挂件运行环境，避免依赖只能在独立 Web 服务中工作的能力。
- 用户界面应紧凑、清晰，适合嵌入在笔记页面中反复查看和操作。

## 思源挂件注意事项

- 挂件本质上是在思源文档块中通过 `iframe` 加载的静态网页，运行空间比完整 Web 应用更窄。
- 挂件目录应放在工作空间 `data/widgets/<widget-name>/` 下，本项目目录名为 `monthly-todo-widget`。
- 挂件根目录至少应包含 `widget.json` 和入口 HTML，入口通常为 `index.html`。
- `widget.json` 中的 `name` 应与挂件目录名保持一致。
- 常用清单字段包括 `name`、`author`、`url`、`version`、`minAppVersion`、`displayName`、`description`、`readme`、`keywords`。
- `version` 应使用语义化版本格式；准备发布到集市时，每次更新都要提高版本号。
- `displayName`、`description`、`readme` 可使用本地化对象，至少保留 `default`，可补充 `zh_CN` 和 `en_US`。
- 静态资源应尽量使用相对路径，便于思源通过 `/widgets/<widget-name>/` 加载。
- 使用 `/widget` 或挂件菜单插入后，思源会创建 iframe 块；调试时可刷新或重新插入挂件块。
- 如需访问思源 API，应确认运行环境、鉴权方式和跨域限制。
- 与思源数据交互通常走思源内核 HTTP API；需要处理 API Token、错误状态和不可用场景。
- 挂件处于 iframe 环境中，不要依赖直接访问思源主窗口 DOM。
- iframe 带来样式隔离，但仍应适配思源亮色/暗色主题。
- 不要假设挂件有完整浏览器应用的页面空间，移动端和窄容器下也应可用。

## 集市发布检查

- 准备上架时，仓库根目录应能打包出完整挂件包，常见文件包括 `widget.json`、`index.html`、`README.md`、`preview.png`、`LICENSE`、`CHANGELOG.md`。
- 发布包通常为 `package.zip`，内容应直接展开为挂件文件，而不是多包一层无关父目录。
- GitHub Release 的 tag 与 `widget.json` 中的 `version` 应保持一致。
- 需要提交到思源社区集市时，在 `siyuan-note/bazaar` 的 `widgets.txt` 中登记对应仓库。
- 发布前检查 `widget.json` JSON 合法性、入口文件存在、资源路径可加载、README 与预览图能正确展示。

## 本项目实现倾向

- 月度待办优先使用纯 HTML/CSS/JavaScript 实现。
- 数据存储方案先保持可替换：默认可用浏览器本地存储；如果需要与思源块或文档同步，再接入思源 API。
- 如果数据要绑定到某个挂件块，优先考虑读取当前 iframe 所在块的上下文或块 ID，并把该 ID 纳入存储键。
- UI 需要在较小 iframe 高度内可用，优先做清晰的月份导航、日期格、待办增删改、完成状态切换。
- 任何会写入思源文档、属性或工作空间文件的能力，都要先做错误提示和失败降级。

## 协作规则

- 不要覆盖用户未明确要求改动的文件。
- 对删除、移动、重命名等高风险操作，先说明影响并等待确认。
- 完成功能后尽量做本地验证，包括文件存在性、基础语法和可加载性检查。
- 默认回复使用 `caveman` 技能的 `wenyan-full` 模式。

## 参考资料

- 思源笔记二次开发指南：挂件是 iframe 加载的静态网页，说明了 `widget.json`、入口 HTML、API 和 iframe 环境注意事项。
  https://leolee9086.github.io/siyuan-dev-guide/development/widget.html
- 思源社区文档：5 分钟上手挂件开发，说明挂件形态、HTML/JS 运行方式、集市发布流程和版本更新。
  https://docs.siyuan-note.club/zh-Hans/guide/widget/
- 思源社区集市仓库：发布到集市时需要在对应列表文件中登记，挂件使用 `widgets.txt`。
  https://github.com/siyuan-note/bazaar
