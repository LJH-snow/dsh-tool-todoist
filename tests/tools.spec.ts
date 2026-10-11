import { describe, expect, it } from 'vitest'
import { createTools } from '../src/index.ts'
import { TodoistClient, type TodoistFetch } from '../src/client.ts'

const fetchImpl: TodoistFetch = async (input, init) => {
  const url = new URL(input.toString())
  if (url.pathname.endsWith('/tasks') && init?.method === 'POST') return new Response(JSON.stringify({ id: 't1', project_id: 'p1', content: 'ship', description: '', labels: [], priority: 1, checked: false }), { headers: { 'content-type': 'application/json' } })
  if (url.pathname.endsWith('/user')) return new Response(JSON.stringify({ id: 'u1', name: 'Ada', email: 'ada@example.com' }), { headers: { 'content-type': 'application/json' } })
  if (url.pathname.endsWith('/projects')) return new Response(JSON.stringify({ results: [{ id: 'p1', name: 'Inbox', description: '', color: 'charcoal', is_archived: false, is_favorite: true, view_style: 'list' }], next_cursor: null }), { headers: { 'content-type': 'application/json' } })
  if (url.pathname.endsWith('/tasks')) return new Response(JSON.stringify({ results: [{ id: 't1', project_id: 'p1', content: 'ship', description: '', labels: [], priority: 1, checked: false }], next_cursor: null }), { headers: { 'content-type': 'application/json' } })
  return new Response(null, { status: 200 })
}

describe('dsh-tool-todoist tools', () => {
  it('registers the five bounded tools with safe call kinds', () => {
    const tools = createTools(new TodoistClient({ apiToken: 'secret', fetchImpl }))
    expect(tools.map(tool => tool.name)).toEqual(['todoist_auth_test', 'todoist_tasks_list', 'todoist_projects_list', 'todoist_task_create', 'todoist_task_close'])
    expect(tools[0].presentCall({})).toMatchObject({ kind: 'read' })
    expect(tools[1].presentCall({})).toMatchObject({ kind: 'read' })
    expect(tools[3].presentCall({ content: 'ship' })).toMatchObject({ kind: 'edit' })
    expect(tools[4].presentCall({ taskId: 't1' })).toMatchObject({ kind: 'edit' })
  })

  it('renders safe bounded results without a token', () => {
    const tools = createTools(new TodoistClient({ apiToken: 'todoist-secret', fetchImpl }))
    const tasks = tools.find(tool => tool.name === 'todoist_tasks_list')!
    const view = tasks.output.render({}, { ok: true, tasks: [{ id: 't1', content: 'ship', projectId: 'p1', description: '', labels: [], priority: 1, checked: false }], nextCursor: null }) as Array<{ text: string }>
    expect(view[0].text).toContain('t1')
    expect(view[0].text).not.toContain('todoist-secret')
  })

  it('executes auth, list, create, and close tools end to end', async () => {
    const tools = createTools(new TodoistClient({ apiToken: 'secret', fetchImpl }))
    expect(await tools[0].execute({})).toMatchObject({ ok: true, id: 'u1' })
    expect(await tools[1].execute({})).toMatchObject({ ok: true, tasks: [{ id: 't1' }] })
    expect(await tools[2].execute({})).toMatchObject({ ok: true, projects: [{ id: 'p1' }] })
    expect(await tools[3].execute({ content: 'ship' })).toMatchObject({ ok: true, id: 't1' })
    expect(await tools[4].execute({ taskId: 't1' })).toMatchObject({ ok: true, taskId: 't1' })
  })
})
