import { describe, expect, it } from 'vitest'
import { TodoistClient, TodoistClientError } from '../src/client.ts'

describe('Todoist endpoint security', () => {
  it('rejects credentials, query, fragments, insecure, private, and non-Todoist endpoints', () => {
    for (const baseUrl of [
      'http://api.todoist.com/api/v1',
      'https://user:secret@api.todoist.com/api/v1',
      'https://api.todoist.com/api/v1?token=secret',
      'https://api.todoist.com/api/v1#fragment',
      'https://api.todoist.com:8443/api/v1',
      'https://localhost/api/v1',
      'https://127.0.0.1/api/v1',
      'https://10.0.0.1/api/v1',
      'https://example.com/api/v1',
      'https://api.todoist.com/api/v2',
    ]) {
      expect(() => new TodoistClient({ baseUrl })).toThrow(TodoistClientError)
    }
  })

  it('accepts the official Todoist API endpoint and normalizes a trailing slash', () => {
    const client = new TodoistClient({ baseUrl: 'https://api.todoist.com/api/v1/' })
    expect(client.getBaseUrl()).toBe('https://api.todoist.com/api/v1')
  })
})
