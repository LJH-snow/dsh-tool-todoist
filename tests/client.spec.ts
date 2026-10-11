import { describe, expect, it } from 'vitest'
import { TodoistClient, TodoistClientError } from '../src/client.ts'

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

describe('TodoistClient', () => {
  it('reports token presence without exposing the token', () => {
    const token = 'todoist-secret-token'
    const client = new TodoistClient({ apiToken: token, fetchImpl: async () => response({}) })
    expect(client.hasToken()).toBe(true)
    expect(JSON.stringify({ configured: client.hasToken() })).not.toContain(token)
    expect(new TodoistClient({ apiToken: '', fetchImpl: async () => response({}) }).hasToken()).toBe(false)
  })

  it('authenticates through user info and sends a bearer token', async () => {
    let request: Request | undefined
    const client = new TodoistClient({ apiToken: 'todoist-secret', fetchImpl: async (input, init) => {
      request = new Request(input, init)
      return response({ id: '123', name: 'Ada', email: 'ada@example.com', karma: 999999 })
    } })
    await expect(client.authTest()).resolves.toEqual({ ok: true, id: '123', name: 'Ada', email: 'ada@example.com' })
    expect(request?.url).toBe('https://api.todoist.com/api/v1/user')
    expect(request?.headers.get('authorization')).toBe('Bearer todoist-secret')
  })

  it('lists bounded tasks and forwards cursor filters', async () => {
    let request: Request | undefined
    const client = new TodoistClient({ apiToken: 'secret', fetchImpl: async input => {
      request = new Request(input)
      return response({ results: Array.from({ length: 80 }, (_, i) => ({ id: 'task-' + i, project_id: 'p1', content: 'task ' + i, description: 'd'.repeat(500), labels: ['work'], priority: 4, due: { string: 'today' }, checked: false })), next_cursor: 'next.cursor' })
    } })
    const result = await client.listTasks({ projectId: 'p1', label: 'work', cursor: 'prev.cursor', limit: 200 })
    expect(result.tasks).toHaveLength(50)
    expect(result.tasks[0]).toMatchObject({ id: 'task-0', projectId: 'p1', content: 'task 0', checked: false })
    expect(result.tasks[0].description.length).toBeLessThanOrEqual(500)
    expect(result.nextCursor).toBe('next.cursor')
    expect(request?.url).toContain('/tasks?')
    expect(request?.url).toContain('project_id=p1')
    expect(request?.url).toContain('label=work')
    expect(request?.url).toContain('cursor=prev.cursor')
    expect(request?.url).toContain('limit=50')
  })

  it('creates a bounded task with only supported fields', async () => {
    let request: Request | undefined
    const client = new TodoistClient({ apiToken: 'secret', maxInputChars: 12, fetchImpl: async (input, init) => {
      request = new Request(input, init)
      return response({ id: 'task-1', project_id: 'p1', content: 'hello world!', description: 'desc', labels: ['one'], priority: 2, checked: false })
    } })
    const task = await client.createTask({ content: 'hello world! extra', description: 'desc', projectId: 'p1', labels: ['one'], priority: 2, dueString: 'tomorrow', unknownField: 'drop' } as never)
    expect(task).toMatchObject({ id: 'task-1', projectId: 'p1', content: 'hello world!' })
    const body = await request?.json() as Record<string, unknown>
    expect(body).toEqual({ content: 'hello world!', description: 'desc', project_id: 'p1', labels: ['one'], priority: 2, due_string: 'tomorrow' })
    expect(body).not.toHaveProperty('unknownField')
  })

  it('rejects temporary task ids and closes a real task', async () => {
    let request: Request | undefined
    const client = new TodoistClient({ apiToken: 'secret', fetchImpl: async (input, init) => { request = new Request(input, init); return response(undefined) } })
    await expect(client.closeTask('tmp-123')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(client.closeTask('6XGgmFVcrGgMpVr')).resolves.toEqual({ ok: true, taskId: '6XGgmFVcrGgMpVr' })
    expect(request?.method).toBe('POST')
    expect(request?.url).toBe('https://api.todoist.com/api/v1/tasks/6XGgmFVcrGgMpVr/close')
  })

  it('maps API errors without exposing token or response body', async () => {
    const client = new TodoistClient({ apiToken: 'todoist-secret', fetchImpl: async () => response({ error: 'token todoist-secret and private body' }, { status: 401, headers: { 'x-request-id': 'req_123' } }) })
    const error = await client.listProjects().catch(value => value as TodoistClientError)
    expect(error).toMatchObject({ status: 401, requestId: 'req_123' })
    expect(error.message).not.toContain('todoist-secret')
    expect(error.message).not.toContain('private body')
  })

  it('requires a token for the real transport and supports timeout cancellation', async () => {
    await expect(new TodoistClient({ apiToken: '' }).listProjects()).rejects.toMatchObject({ code: 'MISSING_API_TOKEN' })
    const client = new TodoistClient({ apiToken: 'secret', timeoutMs: 20, fetchImpl: async (_input, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')), { once: true })) })
    await expect(client.listProjects()).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('rejects unsafe base URLs', () => {
    expect(() => new TodoistClient({ baseUrl: 'http://localhost/api/v1' })).toThrow(TodoistClientError)
    expect(() => new TodoistClient({ baseUrl: 'https://api.todoist.com/api/v1?token=secret' })).toThrow(TodoistClientError)
    expect(() => new TodoistClient({ baseUrl: 'https://evil.example/api/v1' })).toThrow(TodoistClientError)
  })
})
