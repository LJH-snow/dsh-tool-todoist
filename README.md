# @libai168/dsh-tool-todoist

Bounded Todoist REST API v1 tools for DeepSeek Harness. This independent integration is not created by, affiliated with, or supported by Todoist.

The MVP exposes authentication, task/project reads, task creation, and task completion. It uses TODOIST_API_TOKEN, the official https://api.todoist.com/api/v1 endpoint, and an injected fetch boundary in tests.

## Tools

- todoist_auth_test
- todoist_tasks_list
- todoist_projects_list
- todoist_task_create
- todoist_task_close

The client limits page sizes and text fields, rejects tmp- placeholder IDs, forwards cancellation, and never includes the token or raw API error body in results.
