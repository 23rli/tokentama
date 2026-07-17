import { describe, expect, it } from 'vitest';
import { attributeToolCall, extractLoadedSkills } from '../toolAttribution';

describe('tool attribution', () => {
  it('marks MCP tools without coupling transcript parsing to a business group', () => {
    expect(attributeToolCall('mcp_azuredevops_m_wit_work_item')).toEqual({
      toolKind: 'mcp',
    });
    expect(attributeToolCall('mcp_workiq_ask_work_iq')).toEqual({
      toolKind: 'mcp',
    });
  });

  it('keeps unknown MCP servers measurable without a vendor-specific dependency', () => {
    expect(attributeToolCall('mcp_contoso_lookup')).toEqual({
      toolKind: 'mcp',
    });
  });

  it('recognizes a loaded skill from object or JSON-string arguments', () => {
    const path = 'C:\\ai\\hq\\HQ\\.github\\skills\\fde-project-intake\\SKILL.md';
    expect(extractLoadedSkills({ filePath: path, startLine: 1 })).toEqual(['fde-project-intake']);
    expect(extractLoadedSkills(JSON.stringify({ filePath: path }))).toEqual(['fde-project-intake']);
    expect(attributeToolCall('read_file', { filePath: path })).toMatchObject({
      toolKind: 'local',
      loadedSkills: ['fde-project-intake'],
    });
  });

  it('deduplicates multiple skill paths without retaining any raw arguments', () => {
    const result = attributeToolCall('read_file', {
      files: [
        '.github/skills/fde-hq/SKILL.md',
        '.github/skills/fde-project-intake/SKILL.md',
        '.github/skills/fde-hq/SKILL.md',
      ],
      apiKey: 'not-retained',
    });
    expect(result.loadedSkills).toEqual(['fde-hq', 'fde-project-intake']);
    expect(JSON.stringify(result)).not.toContain('not-retained');
  });

  it('does not treat ordinary argument text as a skill path', () => {
    expect(extractLoadedSkills({ query: 'tell me about skills' })).toEqual([]);
  });
});