import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  TodoistClient,
  TodoistClientError,
  type TodoistClientOptions,
  type TodoistFetch,
  type TodoistTaskSummary,
  type TodoistProjectSummary,
} from './client.js'

export { TodoistClient, TodoistClientError }
export type {
  TodoistClientOptions,
  TodoistFetch,
  TodoistTaskSummary,
  TodoistProjectSummary,
  TodoistTaskPage,
  TodoistProjectPage,
  TodoistCreateTaskInput,
} from './client.js'

export const name = 'dsh-tool-todoist'
export const inject = ['tools']

export interface TodoistPluginConfig extends TodoistClientOptions {}

type Exec = { signal?: AbortSignal } | undefined
function text(value: string) { return [{ type: 'text' as const, text: value }] }
function signalOf(exec: Exec): AbortSignal | undefined { return exec?.signal }
function errorResult(error: unknown): { ok: false; reason: string; status?: number; requestId?: string; code?: string } {
  if (error instanceof TodoistClientError) return { ok: false, reason: error.message, status: error.status, requestId: error.requestId, code: error.code }
  return { ok: false, reason: 'Todoist request failed.' }
}
function taskLine(task: TodoistTaskSummary): string {
  const due = task.due?.string || task.due?.date || ''
  return [task.id, task.content, task.projectId, task.checked ? 'completed' : 'active', due].filter(Boolean).join(' | ')
}
function projectLine(project: TodoistProjectSummary): string {
  return [project.id, project.name, project.description, project.isFavorite ? 'favorite' : ''].filter(Boolean).join(' | ')
}

export function apply(ctx: Context, config: TodoistPluginConfig = {}) {
  const client = new TodoistClient(config)
  for (const tool of createTools(client)) ctx.tools.register(tool)
}

export function createTools(client: TodoistClient) {
  return [
    defineTool({
      name: 'todoist_auth_test',
      description: 'Verify Todoist API access without exposing the API token or full user profile.',
      parameters: {},
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            ok: { type: 'boolean' }, id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' },
            reason: { type: 'string' }, status: { type: 'integer' }, requestId: { type: 'string' }, code: { type: 'string' },
          },
        } as const,
        render: (_args, value) => {
          const v = value as { ok?: boolean; id?: string; name?: string; reason?: string }
          return text(v.ok ? 'Todoist authentication succeeded for ' + (v.name || v.id || 'the configured account') + '.' : 'Todoist authentication failed: ' + (v.reason || 'request failed.'))
        },
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'Verify Todoist API token', kind: 'read' } },
      presentResult(_args, result: ToolResult): ToolResultView { return { card: 'generic', title: result.isError ? 'Todoist authentication failed' : 'Todoist authenticated' } },
      async execute(_args, exec) {
        try { return await client.authTest(signalOf(exec)) }
        catch (error) { return errorResult(error) }
      },
    }),
    defineTool({
      name: 'todoist_tasks_list',
      description: 'List a bounded page of active Todoist tasks with optional project, section, parent, label, ID, and cursor filters.',
      parameters: {
        projectId: { type: 'string', description: 'Optional Todoist project ID.' },
        sectionId: { type: 'string', description: 'Optional Todoist section ID.' },
        parentId: { type: 'string', description: 'Optional parent task ID.' },
        label: { type: 'string', description: 'Optional personal label name.' },
        ids: { type: 'string', description: 'Optional comma-separated task IDs.' },
        cursor: { type: 'string', description: 'Optional opaque pagination cursor.' },
        limit: { type: 'integer', description: 'Optional page size, capped at 50.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            ok: { type: 'boolean' }, reason: { type: 'string' }, status: { type: 'integer' }, requestId: { type: 'string' }, code: { type: 'string' },
            nextCursor: { type: 'string' },
            tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              id: { type: 'string' }, projectId: { type: 'string' }, sectionId: { type: 'string' }, parentId: { type: 'string' }, content: { type: 'string' }, description: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, priority: { type: 'integer' }, checked: { type: 'boolean' }, due: { type: 'object', additionalProperties: false, properties: { date: { type: 'string' }, string: { type: 'string' }, recurring: { type: 'boolean' } } },
            } } },
          },
        } as const,
        render: (_args, value) => {
          const v = value as { ok?: boolean; tasks?: TodoistTaskSummary[]; nextCursor?: string | null; reason?: string }
          if (!v.ok) return text('Todoist task list failed: ' + (v.reason || 'request failed.'))
          const lines = (v.tasks || []).map(taskLine)
          return text(lines.join('\n') || 'No active Todoist tasks returned.' + (v.nextCursor ? '\nnextCursor=' + v.nextCursor : ''))
        },
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'List Todoist tasks', kind: 'read' } },
      presentResult(_args, result: ToolResult): ToolResultView { return { card: 'generic', title: result.isError ? 'Todoist task list failed' : 'Todoist tasks' } },
      async execute(args, exec) {
        try {
          const a = args as { projectId?: string; sectionId?: string; parentId?: string; label?: string; ids?: string; cursor?: string; limit?: number }
          const page = await client.listTasks({ ...a, signal: signalOf(exec) })
          return { ok: true, tasks: page.tasks, nextCursor: page.nextCursor ?? undefined }
        } catch (error) { return errorResult(error) }
      },
    }),
    defineTool({
      name: 'todoist_projects_list',
      description: 'List a bounded page of active Todoist personal and workspace projects.',
      parameters: {
        folderId: { type: 'integer', description: 'Optional numeric folder ID.' },
        workspaceId: { type: 'integer', description: 'Optional numeric workspace ID.' },
        cursor: { type: 'string', description: 'Optional opaque pagination cursor.' },
        limit: { type: 'integer', description: 'Optional page size, capped at 50.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            ok: { type: 'boolean' }, reason: { type: 'string' }, status: { type: 'integer' }, requestId: { type: 'string' }, code: { type: 'string' }, nextCursor: { type: 'string' },
            projects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, color: { type: 'string' }, isArchived: { type: 'boolean' }, isFavorite: { type: 'boolean' }, viewStyle: { type: 'string' } } } },
          },
        } as const,
        render: (_args, value) => {
          const v = value as { ok?: boolean; projects?: TodoistProjectSummary[]; nextCursor?: string | null; reason?: string }
          if (!v.ok) return text('Todoist project list failed: ' + (v.reason || 'request failed.'))
          const lines = (v.projects || []).map(projectLine)
          return text(lines.join('\n') || 'No active Todoist projects returned.' + (v.nextCursor ? '\nnextCursor=' + v.nextCursor : ''))
        },
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'List Todoist projects', kind: 'read' } },
      presentResult(_args, result: ToolResult): ToolResultView { return { card: 'generic', title: result.isError ? 'Todoist project list failed' : 'Todoist projects' } },
      async execute(args, exec) {
        try {
          const a = args as { folderId?: number; workspaceId?: number; cursor?: string; limit?: number }
          const page = await client.listProjects({ ...a, signal: signalOf(exec) })
          return { ok: true, projects: page.projects, nextCursor: page.nextCursor ?? undefined }
        } catch (error) { return errorResult(error) }
      },
    }),
    defineTool({
      name: 'todoist_task_create',
      description: 'Create one bounded Todoist task with content and optional project, labels, priority, and due fields.',
      parameters: {
        content: { type: 'string', required: true, description: 'Task content.' },
        description: { type: 'string', description: 'Optional task description.' },
        projectId: { type: 'string', description: 'Optional project ID.' },
        sectionId: { type: 'string', description: 'Optional section ID.' },
        parentId: { type: 'string', description: 'Optional parent task ID.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Optional personal label names.' },
        priority: { type: 'integer', description: 'Optional priority from 1 to 4.' },
        dueString: { type: 'string', description: 'Optional human-readable due date.' },
        dueDate: { type: 'string', description: 'Optional due date.' },
        dueDatetime: { type: 'string', description: 'Optional due date and time.' },
        dueLang: { type: 'string', description: 'Optional due-date language.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            ok: { type: 'boolean' }, reason: { type: 'string' }, status: { type: 'integer' }, requestId: { type: 'string' }, code: { type: 'string' },
            id: { type: 'string' }, projectId: { type: 'string' }, content: { type: 'string' }, description: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, priority: { type: 'integer' }, checked: { type: 'boolean' },
          },
        } as const,
        render: (_args, value) => {
          const v = value as { ok?: boolean; id?: string; content?: string; reason?: string }
          return text(v.ok ? 'Created Todoist task ' + (v.id || '') + ': ' + (v.content || '') : 'Todoist task creation failed: ' + (v.reason || 'request failed.'))
        },
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: 'Create Todoist task: ' + String((args as { content?: unknown }).content || 'task'), kind: 'edit' } },
      presentResult(_args, result: ToolResult): ToolResultView { return { card: 'generic', title: result.isError ? 'Todoist task creation failed' : 'Todoist task created' } },
      async execute(args, exec) {
        try {
          const a = args as { content: string; description?: string; projectId?: string; sectionId?: string; parentId?: string; labels?: string[]; priority?: number; dueString?: string; dueDate?: string; dueDatetime?: string; dueLang?: string }
          return { ok: true, ...await client.createTask({ ...a, signal: signalOf(exec) }) }
        } catch (error) { return errorResult(error) }
      },
    }),
    defineTool({
      name: 'todoist_task_close',
      description: 'Mark one real Todoist task complete. Client-side tmp- placeholder IDs are rejected.',
      parameters: { taskId: { type: 'string', required: true, description: 'Todoist task ID, not a tmp- placeholder.' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, taskId: { type: 'string' }, reason: { type: 'string' }, status: { type: 'integer' }, requestId: { type: 'string' }, code: { type: 'string' } } } as const,
        render: (_args, value) => {
          const v = value as { ok?: boolean; taskId?: string; reason?: string }
          return text(v.ok ? 'Completed Todoist task ' + (v.taskId || '') + '.' : 'Todoist task completion failed: ' + (v.reason || 'request failed.'))
        },
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: 'Complete Todoist task: ' + String((args as { taskId?: unknown }).taskId || 'task'), kind: 'edit' } },
      presentResult(_args, result: ToolResult): ToolResultView { return { card: 'generic', title: result.isError ? 'Todoist task completion failed' : 'Todoist task completed' } },
      async execute(args, exec) {
        try { return await client.closeTask((args as { taskId: string }).taskId, signalOf(exec)) }
        catch (error) { return errorResult(error) }
      },
    }),
  ]
}
