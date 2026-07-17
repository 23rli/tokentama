import type { ToolCallInfo } from '@tokentama/shared-types';

type ToolAttribution = Pick<
  ToolCallInfo,
  'toolKind' | 'loadedSkills'
>;

/**
 * Reduce a transcript tool event to content-free attribution metadata. Tool
 * arguments are inspected only long enough to recognize a SKILL.md path and are
 * deliberately not copied into PromptEvent.
 */
export function attributeToolCall(toolName: string, args?: unknown): ToolAttribution {
  const normalized = normalizeToolName(toolName);
  const loadedSkills = extractLoadedSkills(args);
  const skillAttribution = loadedSkills.length > 0 ? { loadedSkills } : {};
  const isMcp = normalized.startsWith('mcp_') || normalized.includes('_mcp_');
  return {
    toolKind: isMcp ? 'mcp' : 'local',
    ...skillAttribution,
  };
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function extractLoadedSkills(args: unknown): string[] {
  const skills = new Set<string>();
  visitArgument(args, skills);
  return [...skills];
}

function visitArgument(value: unknown, skills: Set<string>, depth = 0): void {
  if (depth > 5 || value == null) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/SKILL\.md/i.test(trimmed) || trimmed.length > 100_000) return;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        visitArgument(JSON.parse(trimmed), skills, depth + 1);
        return;
      } catch {
        // It may be a non-JSON path-like string; scan only for normalized names.
      }
    }
    const normalized = trimmed.replace(/\\+/g, '/');
    const pattern = /(?:^|\/)skills\/([^/"'?#]+)\/SKILL\.md(?:$|[?#"'])/gi;
    for (const match of normalized.matchAll(pattern)) {
      if (match[1]) skills.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitArgument(item, skills, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const child of Object.values(value as Record<string, unknown>)) {
    visitArgument(child, skills, depth + 1);
  }
}