import { describe, expect, it } from 'vitest';
import { createBusinessToolRegistry } from '../businessToolGroups';

describe('business tool groups', () => {
  it('is opt-in and exposes built-in groups even while disabled', () => {
    const registry = createBusinessToolRegistry(false, [], {});
    expect(registry.enabled).toBe(false);
    expect(registry.groups).toMatchObject([
      { id: 'fde-hq', source: 'built-in', enabled: false },
      { id: 'all-mcp', source: 'built-in', enabled: false },
    ]);
    expect(registry.matchTool({ toolName: 'mcp_workiq_ask_work_iq', toolKind: 'mcp' })).toBeUndefined();
  });

  it('classifies known HQ services only when the FDE HQ group is enabled', () => {
    const registry = createBusinessToolRegistry(true, ['fde-hq'], {});
    expect(registry.matchTool({
      toolName: 'mcp_azuredevops_m_wit_work_item',
      toolKind: 'mcp',
    })).toEqual({
      groupId: 'fde-hq',
      groupName: 'FD&E HQ',
      serviceId: 'azure-devops',
      serviceName: 'Azure DevOps',
    });
    expect(registry.matchTool({ toolName: 'mcp_contoso_lookup', toolKind: 'mcp' })).toBeUndefined();
    expect(registry.matchesWorkflow('fde-project-intake')).toBe(true);
    expect(registry.matchWorkflow('fde-project-intake')).toEqual({
      groupId: 'fde-hq',
      groupName: 'FD&E HQ',
    });
    expect(registry.matchesWorkflow('unrelated-skill')).toBe(false);
    expect(registry.matchWorkflow('unrelated-skill')).toBeUndefined();
  });

  it('uses All MCP tools as a catch-all without capturing local tools', () => {
    const registry = createBusinessToolRegistry(true, ['all-mcp'], {});
    expect(registry.matchTool({ toolName: 'mcp_contoso_lookup', toolKind: 'mcp' })).toMatchObject({
      groupId: 'all-mcp',
      serviceId: 'contoso',
    });
    expect(registry.matchTool({ toolName: 'read_file', toolKind: 'local' })).toBeUndefined();
  });

  it('loads custom groups from settings and gives them precedence', () => {
    const registry = createBusinessToolRegistry(
      true,
      ['finance-suite', 'all-mcp'],
      {
        'finance-suite': {
          name: 'Finance Suite',
          description: 'Finance-specific connectors.',
          mcpOnly: true,
          workflows: ['close-cycle'],
          services: {
            ledger: { name: 'Finance Ledger', match: ['contoso_ledger', 'ledger_lookup'] },
          },
        },
      },
    );
    expect(registry.groups).toContainEqual(expect.objectContaining({
      id: 'finance-suite',
      name: 'Finance Suite',
      source: 'custom',
      enabled: true,
    }));
    expect(registry.matchTool({
      toolName: 'mcp_contoso_ledger_lookup',
      toolKind: 'mcp',
    })).toMatchObject({
      groupId: 'finance-suite',
      serviceId: 'ledger',
      serviceName: 'Finance Ledger',
    });
    expect(registry.matchesWorkflow('monthly-close-cycle')).toBe(true);
  });

  it('ignores malformed, empty, and built-in-shadowing custom groups', () => {
    const registry = createBusinessToolRegistry(
      true,
      ['fde-hq', 'empty', 'broken'],
      {
        'fde-hq': {
          name: 'Shadowed built-in',
          workflows: ['wrong'],
        },
        empty: { name: 'Empty' },
        broken: {
          services: {
            missingMatch: { name: 'No match array' },
            tooLong: { match: ['x'.repeat(101)] },
          },
        },
      },
    );
    expect(registry.groups.map((group) => group.id)).toEqual(['fde-hq', 'all-mcp']);
    expect(registry.groups[0]?.name).toBe('FD&E HQ');
  });

  it('produces the same signature regardless of custom-group property order', () => {
    const first = createBusinessToolRegistry(true, ['b', 'a'], {
      b: { workflows: ['b'] },
      a: { services: { z: { match: ['z'] }, a: { match: ['a'] } } },
    });
    const second = createBusinessToolRegistry(true, ['a', 'b'], {
      a: { services: { a: { match: ['a'] }, z: { match: ['z'] } } },
      b: { workflows: ['b'] },
    });
    expect(second.signature).toBe(first.signature);
  });
});