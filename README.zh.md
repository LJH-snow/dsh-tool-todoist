# @libai168/dsh-tool-todoist

面向 DeepSeek Harness 的 Todoist REST API v1 工具。此独立集成并非由 Todoist 创建、关联或支持。

MVP 提供认证检查、任务/项目读取、创建任务和完成任务。使用 TODOIST_API_TOKEN 与官方 https://api.todoist.com/api/v1 端点，测试通过注入 fetch，不访问真实账号。

客户端会限制分页和文本字段、拒绝 tmp- 临时 ID、转发取消信号，并确保 token 与原始错误响应不会出现在结果中。
