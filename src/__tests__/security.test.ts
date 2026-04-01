import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Security tests — validates URL scheme blocking, profile name sanitization,
// and profile path validation from Sprint 1 hardening.
//
// These test the security logic as implemented in index.ts tool handlers.
// Rather than importing the full MCP server, we replicate the critical
// validation logic here and test it in isolation.
// ---------------------------------------------------------------------------

const PROFILE_DIR = path.join(os.homedir(), '.hydrachrome', 'profiles');

// ── URL validation (mirrors the navigate tool handler) ──────────────

function validateUrl(url: string): { ok: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `Invalid URL: ${url}` };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: `Blocked URL scheme: ${parsed.protocol} — only http/https allowed.` };
  }
  return { ok: true };
}

// ── Profile name sanitization (mirrors session_save_profile) ────────

function sanitizeProfileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '');
}

// ── Profile path validation (mirrors session_create) ────────────────

function validateProfilePath(profilePath: string): { ok: boolean; error?: string } {
  const resolved = path.resolve(profilePath);
  if (!resolved.startsWith(path.resolve(PROFILE_DIR))) {
    return { ok: false, error: `profilePath must be within ${PROFILE_DIR}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security — URL Scheme Blocking', () => {
  it('allows http:// URLs', () => {
    const result = validateUrl('http://example.com');
    expect(result.ok).toBe(true);
  });

  it('allows https:// URLs', () => {
    const result = validateUrl('https://example.com/path?q=1');
    expect(result.ok).toBe(true);
  });

  it('blocks file:// URLs', () => {
    const result = validateUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Blocked URL scheme');
    expect(result.error).toContain('file:');
  });

  it('blocks javascript: URLs', () => {
    const result = validateUrl('javascript:alert(1)');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Blocked URL scheme');
    expect(result.error).toContain('javascript:');
  });

  it('blocks data: URLs', () => {
    const result = validateUrl('data:text/html,<h1>evil</h1>');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Blocked URL scheme');
    expect(result.error).toContain('data:');
  });

  it('blocks ftp: URLs', () => {
    const result = validateUrl('ftp://files.example.com/secret.txt');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Blocked URL scheme');
  });

  it('rejects malformed URLs', () => {
    const result = validateUrl('not-a-url');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('rejects empty string', () => {
    const result = validateUrl('');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });
});

describe('Security — Profile Name Sanitization', () => {
  it('allows clean alphanumeric names', () => {
    expect(sanitizeProfileName('google')).toBe('google');
    expect(sanitizeProfileName('my-profile')).toBe('my-profile');
    expect(sanitizeProfileName('test_123')).toBe('test_123');
  });

  it('strips path traversal characters', () => {
    expect(sanitizeProfileName('../../evil')).toBe('evil');
    expect(sanitizeProfileName('../../../etc/passwd')).toBe('etcpasswd');
  });

  it('strips dots', () => {
    expect(sanitizeProfileName('my.profile')).toBe('myprofile');
    expect(sanitizeProfileName('...hidden')).toBe('hidden');
  });

  it('strips slashes and special characters', () => {
    expect(sanitizeProfileName('a/b\\c')).toBe('abc');
    expect(sanitizeProfileName('name with spaces')).toBe('namewithspaces');
    expect(sanitizeProfileName('injection"; rm -rf /')).toBe('injectionrm-rf');
  });

  it('returns empty string for fully invalid names', () => {
    expect(sanitizeProfileName('...')).toBe('');
    expect(sanitizeProfileName('////')).toBe('');
    expect(sanitizeProfileName('   ')).toBe('');
  });
});

describe('Security — Profile Path Validation', () => {
  it('accepts paths within the profiles directory', () => {
    const validPath = path.join(PROFILE_DIR, 'google.json');
    const result = validateProfilePath(validPath);
    expect(result.ok).toBe(true);
  });

  it('rejects paths outside the profiles directory', () => {
    const result = validateProfilePath('/etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('profilePath must be within');
  });

  it('rejects path traversal attempts', () => {
    const traversal = path.join(PROFILE_DIR, '..', '..', 'etc', 'passwd');
    const result = validateProfilePath(traversal);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('profilePath must be within');
  });

  it('rejects relative paths that resolve outside profiles dir', () => {
    const result = validateProfilePath('../../sensitive-file.json');
    expect(result.ok).toBe(false);
  });

  it('accepts nested paths within profiles directory', () => {
    const nested = path.join(PROFILE_DIR, 'subdir', 'profile.json');
    const result = validateProfilePath(nested);
    expect(result.ok).toBe(true);
  });

  it('rejects symlink-style tricks with ..', () => {
    const tricky = path.join(PROFILE_DIR, 'legit', '..', '..', '..', 'etc', 'shadow');
    const result = validateProfilePath(tricky);
    expect(result.ok).toBe(false);
  });
});
