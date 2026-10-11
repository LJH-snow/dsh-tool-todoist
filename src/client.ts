export const DEFAULT_TODOIST_BASE_URL = 'https://api.todoist.com/api/v1'
export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_INPUT_CHARS = 4_000
export const DEFAULT_MAX_OUTPUT_CHARS = 500
export const MAX_PAGE_SIZE = 50
export const MAX_LABELS = 20

export type TodoistFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface TodoistUserSummary {
  id: string
  name: string
  email: string
}

export interface TodoistDueSummary {
  date?: string
  string?: string
  recurring?: boolean
}

export interface TodoistTaskSummary {
  id: string
  projectId: string
  sectionId?: string
  parentId?: string
  content: string
  description: string
  labels: string[]
  priority: number
  due?: TodoistDueSummary
  checked: boolean
}

export interface TodoistProjectSummary {
  id: string
  name: string
  description: string
  color: string
  isArchived: boolean
  isFavorite: boolean
  viewStyle: string
}

export interface TodoistPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface TodoistTaskPage {
  tasks: TodoistTaskSummary[]
  nextCursor: string | null
}

export interface TodoistProjectPage {
  projects: TodoistProjectSummary[]
  nextCursor: string | null
}

export interface TodoistListTasksOptions {
  projectId?: string
  sectionId?: string
  parentId?: string
  label?: string
  ids?: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface TodoistListProjectsOptions {
  folderId?: number
  workspaceId?: number
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface TodoistCreateTaskInput {
  content: string
  description?: string
  projectId?: string
  sectionId?: string
  parentId?: string
  labels?: string[]
  priority?: number
  dueString?: string
  dueDate?: string
  dueDatetime?: string
  dueLang?: string
  signal?: AbortSignal
}

export interface TodoistClientOptions {
  apiToken?: string
  baseUrl?: string
  fetchImpl?: TodoistFetch
  timeoutMs?: number
  maxInputChars?: number
  maxOutputChars?: number
}

export class TodoistClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'TodoistClientError'
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, max: number): string {
  if (typeof value !== 'string') return value == null ? '' : String(value).slice(0, max)
  return value.slice(0, max)
}

function optionalString(value: unknown, max: number): string | undefined {
  const result = stringValue(value, max).trim()
  return result ? result : undefined
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value as number))) : fallback
}

function normalizeBaseUrl(value?: string): string {
  const raw = value ?? DEFAULT_TODOIST_BASE_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new TodoistClientError('Todoist base URL is invalid.', 400, undefined, 'INVALID_ENDPOINT')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TodoistClientError('Todoist base URL must use HTTPS without credentials, query, or fragment.', 400, undefined, 'INVALID_ENDPOINT')
  }
  if (url.hostname.toLowerCase() !== 'api.todoist.com') {
    throw new TodoistClientError('Todoist base URL must use the official api.todoist.com endpoint.', 400, undefined, 'INVALID_ENDPOINT')
  }
  if (url.port && url.port !== '443') {
    throw new TodoistClientError('Todoist base URL must use the default HTTPS port.', 400, undefined, 'INVALID_ENDPOINT')
  }
  if (url.pathname.replace(/\/+$/, '') !== '/api/v1') {
    throw new TodoistClientError('Todoist base URL must end at /api/v1.', 400, undefined, 'INVALID_ENDPOINT')
  }
  url.pathname = '/api/v1'
  url.port = ''
  return url.toString().replace(/\/$/, '')
}

function safeErrorMessage(error: unknown, secret: string): string {
  const raw = error instanceof Error ? error.message : 'Todoist request failed.'
  return raw
    .split(secret || '\u0000').join('[redacted]')
    .replace(/authorization\s*:\s*(?:bearer\s+)?[^\s,;]+/gi, 'Authorization: [redacted]')
    .replace(/bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .slice(0, 300)
}

function requestIdOf(response: Response): string | undefined {
  const value = response.headers.get('x-request-id') ?? response.headers.get('request-id')
  return value ? value.slice(0, 120) : undefined
}

function taskFrom(value: unknown, maxOutputChars: number): TodoistTaskSummary {
  const raw = record(value)
  const dueRaw = record(raw.due)
  const due = Object.keys(dueRaw).length > 0 ? {
    date: optionalString(dueRaw.date, 120),
    string: optionalString(dueRaw.string, maxOutputChars),
    recurring: typeof dueRaw.is_recurring === 'boolean' ? dueRaw.is_recurring : undefined,
  } : undefined
  return {
    id: stringValue(raw.id, 160),
    projectId: stringValue(raw.project_id, 160),
    sectionId: optionalString(raw.section_id, 160),
    parentId: optionalString(raw.parent_id, 160),
    content: stringValue(raw.content, maxOutputChars),
    description: stringValue(raw.description, maxOutputChars),
    labels: Array.isArray(raw.labels) ? raw.labels.slice(0, MAX_LABELS).map(item => stringValue(item, 100)).filter(Boolean) : [],
    priority: clamp(numberValue(raw.priority, 1), 1, 4, 1),
    due,
    checked: raw.checked === true,
  }
}

function projectFrom(value: unknown, maxOutputChars: number): TodoistProjectSummary {
  const raw = record(value)
  return {
    id: stringValue(raw.id, 160),
    name: stringValue(raw.name, maxOutputChars),
    description: stringValue(raw.description, maxOutputChars),
    color: stringValue(raw.color, 80),
    isArchived: raw.is_archived === true,
    isFavorite: raw.is_favorite === true,
    viewStyle: stringValue(raw.view_style, 80),
  }
}

export class TodoistClient {
  private readonly apiToken: string
  private readonly baseUrl: string
  private readonly fetchImpl: TodoistFetch
  private readonly timeoutMs: number
  private readonly maxInputChars: number
  private readonly maxOutputChars: number

  constructor(options: TodoistClientOptions = {}) {
    this.apiToken = options.apiToken ?? process.env.TODOIST_API_TOKEN ?? ''
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.timeoutMs = clamp(options.timeoutMs, 100, 120_000, DEFAULT_TIMEOUT_MS)
    this.maxInputChars = clamp(options.maxInputChars, 1, 100_000, DEFAULT_MAX_INPUT_CHARS)
    this.maxOutputChars = clamp(options.maxOutputChars, 1, 100_000, DEFAULT_MAX_OUTPUT_CHARS)
  }

  hasToken(): boolean { return this.apiToken.length > 0 }
  getBaseUrl(): string { return this.baseUrl }

  async authTest(signal?: AbortSignal): Promise<{ ok: true; id: string; name: string; email: string }> {
    const raw = await this.request('/user', { method: 'GET' }, signal)
    return {
      ok: true,
      id: stringValue(record(raw).id, 160),
      name: stringValue(record(raw).name, 200),
      email: stringValue(record(raw).email, 240),
    }
  }

  async listTasks(options: TodoistListTasksOptions = {}): Promise<TodoistTaskPage> {
    const query = new URLSearchParams()
    this.addString(query, 'project_id', options.projectId, 160)
    this.addString(query, 'section_id', options.sectionId, 160)
    this.addString(query, 'parent_id', options.parentId, 160)
    this.addString(query, 'label', options.label, 100)
    this.addString(query, 'ids', options.ids, 1_000)
    this.addString(query, 'cursor', options.cursor, 240)
    query.set('limit', String(clamp(options.limit, 1, MAX_PAGE_SIZE, MAX_PAGE_SIZE)))
    const raw = record(await this.request('/tasks', { method: 'GET', query }, options.signal))
    const values = Array.isArray(raw.results) ? raw.results : []
    return { tasks: values.slice(0, MAX_PAGE_SIZE).map(item => taskFrom(item, this.maxOutputChars)), nextCursor: optionalString(raw.next_cursor, 240) ?? null }
  }

  async listProjects(options: TodoistListProjectsOptions = {}): Promise<TodoistProjectPage> {
    const query = new URLSearchParams()
    if (Number.isInteger(options.folderId) && (options.folderId as number) > 0) query.set('folder_id', String(options.folderId))
    if (Number.isInteger(options.workspaceId) && (options.workspaceId as number) > 0) query.set('workspace_id', String(options.workspaceId))
    this.addString(query, 'cursor', options.cursor, 240)
    query.set('limit', String(clamp(options.limit, 1, MAX_PAGE_SIZE, MAX_PAGE_SIZE)))
    const raw = record(await this.request('/projects', { method: 'GET', query }, options.signal))
    const values = Array.isArray(raw.results) ? raw.results : []
    return { projects: values.slice(0, MAX_PAGE_SIZE).map(item => projectFrom(item, this.maxOutputChars)), nextCursor: optionalString(raw.next_cursor, 240) ?? null }
  }

  async createTask(input: TodoistCreateTaskInput): Promise<TodoistTaskSummary> {
    const content = typeof input.content === 'string' ? input.content.trim().slice(0, this.maxInputChars) : ''
    if (!content) throw new TodoistClientError('content is required.', 400, undefined, 'INVALID_ARGUMENT')
    const body: Record<string, unknown> = { content }
    this.addBodyString(body, 'description', input.description, this.maxInputChars)
    this.addBodyString(body, 'project_id', input.projectId, 160)
    this.addBodyString(body, 'section_id', input.sectionId, 160)
    this.addBodyString(body, 'parent_id', input.parentId, 160)
    if (Array.isArray(input.labels)) {
      const labels = input.labels.filter(item => typeof item === 'string').slice(0, MAX_LABELS).map(item => item.trim().slice(0, 100)).filter(Boolean)
      if (labels.length) body.labels = labels
    }
    if (input.priority !== undefined) body.priority = clamp(input.priority, 1, 4, 1)
    this.addBodyString(body, 'due_string', input.dueString, 240)
    this.addBodyString(body, 'due_date', input.dueDate, 120)
    this.addBodyString(body, 'due_datetime', input.dueDatetime, 120)
    this.addBodyString(body, 'due_lang', input.dueLang, 40)
    const raw = await this.request('/tasks', { method: 'POST', body }, input.signal)
    return taskFrom(raw, this.maxOutputChars)
  }

  async closeTask(taskId: string, signal?: AbortSignal): Promise<{ ok: true; taskId: string }> {
    const id = typeof taskId === 'string' ? taskId.trim() : ''
    if (!id || id.startsWith('tmp-')) throw new TodoistClientError('A real Todoist task ID is required; tmp- IDs are not valid REST IDs.', 400, undefined, 'INVALID_ARGUMENT')
    await this.request('/tasks/' + encodeURIComponent(id) + '/close', { method: 'POST' }, signal)
    return { ok: true, taskId: id.slice(0, 160) }
  }

  private addString(query: URLSearchParams, key: string, value: unknown, max: number): void {
    if (typeof value === 'string' && value.trim()) query.set(key, value.trim().slice(0, max))
  }

  private addBodyString(body: Record<string, unknown>, key: string, value: unknown, max: number): void {
    if (typeof value === 'string' && value.trim()) body[key] = value.trim().slice(0, max)
  }

  private async request(path: string, options: { method: string; query?: URLSearchParams; body?: Record<string, unknown> }, callerSignal?: AbortSignal): Promise<unknown> {
    if (!this.hasToken()) throw new TodoistClientError('TODOIST_API_TOKEN is not configured.', undefined, undefined, 'MISSING_API_TOKEN')
    const query = options.query?.toString()
    const url = this.baseUrl + path + (query ? '?' + query : '')
    const controller = new AbortController()
    let timedOut = false
    const onCallerAbort = () => controller.abort(callerSignal?.reason ?? new Error('Todoist request aborted.'))
    if (callerSignal) {
      if (callerSignal.aborted) onCallerAbort()
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Todoist request timed out.')) }, this.timeoutMs)
    try {
      const headers: Record<string, string> = { accept: 'application/json', authorization: 'Bearer ' + this.apiToken }
      const init: RequestInit = { method: options.method, headers, signal: controller.signal }
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json'
        init.body = JSON.stringify(options.body)
      }
      const response = await this.fetchImpl(url, init)
      const requestId = requestIdOf(response)
      let data: unknown = null
      try { data = await response.json() } catch { data = null }
      if (!response.ok) throw new TodoistClientError('Todoist API request failed.', response.status, requestId, 'HTTP_' + response.status)
      return data
    } catch (error) {
      if (error instanceof TodoistClientError) throw error
      if (timedOut) throw new TodoistClientError('Todoist request timed out.', undefined, undefined, 'TIMEOUT')
      if (callerSignal?.aborted) throw new TodoistClientError('Todoist request was cancelled.', undefined, undefined, 'ABORTED')
      throw new TodoistClientError(safeErrorMessage(error, this.apiToken), undefined, undefined, 'REQUEST_FAILED')
    } finally {
      clearTimeout(timer)
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort)
    }
  }
}

export { normalizeBaseUrl }
