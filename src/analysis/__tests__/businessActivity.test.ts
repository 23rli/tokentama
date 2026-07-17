import { describe, expect, it } from 'vitest';
import type { PromptEvent } from '@tokentama/shared-types';
import { sanitizeBusinessToolRates, summarizeBusinessActivity } from '../businessActivity';
import { createBusinessToolRegistry } from '../businessToolGroups';

const costOptions = { usdPerMillionTokens: 1, usdPerCredit: 0 };
const fdeRegistry = createBusinessToolRegistry(true, ['fde-hq'], {});

function event(overrides: Partial<PromptEvent> = {}): PromptEvent {
  return {
    eventId: 'event-1',
    sessionId: 'session-1',
    userId: 'local',
    turnIndex: 0,
    source: 'transcript',
    timestamp: '2026-07-15T12:00:00.000Z',
    promptText: 'Run the intake',
    toolCalls: [],
    tokens: {
      inputTokens: 900,
      outputTokens: 100,
      estimatedCostUsd: 0,
      estimated: false,
    },
    ...overrides,
  };
}

describe('summarizeBusinessActivity', () => {
  it('attributes AI and configured MCP costs to a loaded skill', () => {
    const summary = summarizeBusinessActivity(
      [
        event({
          toolCalls: [
            { toolName: 'read_file', toolKind: 'local', loadedSkills: ['fde-project-intake'], success: true },
            {
              toolName: 'mcp_azuredevops_m_wit_work_item',
              toolKind: 'mcp',
              success: true,
              durationMs: 30_000,
            },
          ],
        }),
      ],
      { 'azure-devops': { usdPerCall: 0.1, usdPerMinute: 0.2 } },
      costOptions,
      fdeRegistry,
    );

    expect(summary.totalToolCalls).toBe(2);
    expect(summary.businessCalls).toBe(1);
    expect(summary.pricedCalls).toBe(1);
    expect(summary.externalCostUsd).toBeCloseTo(0.2, 8);
    expect(summary.aiCostUsd).toBeCloseTo(0.001, 8);
    expect(summary.trackedCostUsd).toBeCloseTo(0.201, 8);
    expect(summary.services[0]).toMatchObject({
      id: 'azure-devops',
      groupId: 'fde-hq',
      calls: 1,
      successfulCalls: 1,
      estimatedCostUsd: 0.2,
    });
    expect(summary.skills).toEqual([{ name: 'fde-project-intake', invocations: 1 }]);
    expect(summary.workflows[0]).toMatchObject({
      id: 'skill:fde-project-intake',
      kind: 'skill',
      turns: 1,
      toolCalls: 2,
      businessCalls: 1,
      externalCostUsd: 0.2,
    });
  });

  it('keeps calls without a rate visible and marks totals partial', () => {
    const summary = summarizeBusinessActivity(
      [
        event({
          toolCalls: [
            {
              toolName: 'mcp_workiq_ask_work_iq',
              toolKind: 'mcp',
              success: false,
              durationMs: 500,
            },
          ],
        }),
      ],
      {},
      costOptions,
      fdeRegistry,
    );

    expect(summary.unpricedCalls).toBe(1);
    expect(summary.failedBusinessCalls).toBe(1);
    expect(summary.externalCostUsd).toBe(0);
    expect(summary.services[0]?.estimatedCostUsd).toBeUndefined();
    expect(summary.trackedCostUsd).toBeCloseTo(0.001, 8);
  });

  it('recognizes saved prompts and agents when no skill file was loaded', () => {
    const summary = summarizeBusinessActivity(
      [
        event({ promptText: '/prompt fde-project-new' }),
        event({ eventId: 'event-2', turnIndex: 1, promptText: '@fde-tpm file a story' }),
      ],
      {},
      costOptions,
      fdeRegistry,
    );
    expect(summary.workflows.map((row) => row.id).sort()).toEqual([
      'agent:fde-tpm',
      'prompt:fde-project-new',
    ]);
  });

  it('compares explicit FD&E HQ workflow spend with Other Copilot without double counting', () => {
    const summary = summarizeBusinessActivity(
      [
        event({ promptText: '/prompt fde-project-new' }),
        event({ eventId: 'event-2', turnIndex: 1, promptText: 'Refactor an unrelated parser' }),
      ],
      {},
      costOptions,
      fdeRegistry,
    );
    expect(summary.attribution).toEqual([
      expect.objectContaining({
        id: 'fde-hq:explicit-workflow',
        name: 'FD&E HQ workflow',
        basis: 'explicit-workflow',
        confidence: 'high',
        turns: 1,
        meteredTurns: 1,
        tokens: 1_000,
        aiCostUsd: 0.001,
      }),
      expect.objectContaining({
        id: 'other:copilot',
        name: 'Other Copilot',
        basis: 'other',
        confidence: 'unattributed',
        turns: 1,
        tokens: 1_000,
        aiCostUsd: 0.001,
      }),
    ]);
    expect(summary.attribution.reduce((sum, row) => sum + row.turns, 0)).toBe(2);
  });

  it('labels a generic turn with a known FD&E MCP as medium-confidence associated spend', () => {
    const summary = summarizeBusinessActivity(
      [event({
        promptText: 'Look up the work item',
        toolCalls: [{
          toolName: 'mcp_azuredevops_m_wit_work_item',
          toolKind: 'mcp',
          success: true,
        }],
      })],
      {},
      costOptions,
      fdeRegistry,
    );
    expect(summary.attribution).toEqual([
      expect.objectContaining({
        id: 'fde-hq:tool-associated',
        name: 'FD&E HQ associated',
        basis: 'tool-associated',
        confidence: 'medium',
        turns: 1,
        mcpCalls: 1,
      }),
    ]);
  });

  it('uses mixed only when tool calls match several groups, and explicit workflow takes precedence', () => {
    const registry = createBusinessToolRegistry(
      true,
      ['fde-hq', 'finance-suite'],
      {
        'finance-suite': {
          mcpOnly: true,
          services: {
            ledger: { name: 'Ledger', match: ['contoso_ledger'] },
          },
        },
      },
    );
    const toolCalls = [
      { toolName: 'mcp_azuredevops_m_wit_work_item', toolKind: 'mcp' as const, success: true },
      { toolName: 'mcp_contoso_ledger_lookup', toolKind: 'mcp' as const, success: true },
    ];
    const mixed = summarizeBusinessActivity(
      [event({ promptText: 'Compare records', toolCalls })],
      {},
      costOptions,
      registry,
    );
    expect(mixed.attribution).toEqual([
      expect.objectContaining({
        id: 'mixed:selected-groups',
        basis: 'mixed',
        confidence: 'low',
        turns: 1,
        mcpCalls: 2,
      }),
    ]);

    const explicit = summarizeBusinessActivity(
      [event({ promptText: '@fde-tpm compare records', toolCalls })],
      {},
      costOptions,
      registry,
    );
    expect(explicit.attribution).toEqual([
      expect.objectContaining({
        id: 'fde-hq:explicit-workflow',
        confidence: 'high',
        turns: 1,
      }),
    ]);
  });

  it('excludes unrelated Copilot turns from a selected business group', () => {
    const summary = summarizeBusinessActivity(
      [
        event({ promptText: 'Refactor an unrelated parser' }),
        event({
          eventId: 'event-2',
          turnIndex: 1,
          promptText: 'Look up the work item',
          toolCalls: [{
            toolName: 'mcp_azuredevops_m_wit_work_item',
            toolKind: 'mcp',
            success: true,
          }],
        }),
      ],
      {},
      costOptions,
      fdeRegistry,
    );
    expect(summary.turns).toBe(1);
    expect(summary.aiCostUsd).toBeCloseTo(0.001, 8);
    expect(summary.workflows).toHaveLength(1);
    expect(summary.workflows[0]?.id).toBe('general:copilot');
  });

  it('returns no attribution while business-tool tracking is off', () => {
    const summary = summarizeBusinessActivity(
      [event({ promptText: '@fde-tpm file a story' })],
      {},
      costOptions,
      createBusinessToolRegistry(false, ['fde-hq'], {}),
    );
    expect(summary.turns).toBe(0);
    expect(summary.aiCostUsd).toBeUndefined();
    expect(summary.workflows).toEqual([]);
    expect(summary.attribution).toEqual([]);
  });

  it('reclassifies the same history when a group is disabled and re-enabled', () => {
    const history = [event({
      promptText: 'Look up the work item',
      toolCalls: [{
        toolName: 'mcp_azuredevops_m_wit_work_item',
        toolKind: 'mcp',
        success: true,
      }],
    })];
    const enabled = summarizeBusinessActivity(history, {}, costOptions, fdeRegistry);
    const disabled = summarizeBusinessActivity(
      history,
      {},
      costOptions,
      createBusinessToolRegistry(true, [], {}),
    );
    const reEnabled = summarizeBusinessActivity(
      history,
      {},
      costOptions,
      createBusinessToolRegistry(true, ['fde-hq'], {}),
    );
    expect(enabled.businessCalls).toBe(1);
    expect(disabled.businessCalls).toBe(0);
    expect(reEnabled).toEqual(enabled);
  });

  it('does not add partial cost when a duration-based rate lacks runtime', () => {
    const summary = summarizeBusinessActivity(
      [event({
        toolCalls: [{
          toolName: 'mcp_workiq_ask_work_iq',
          toolKind: 'mcp',
          success: true,
        }],
      })],
      { workiq: { usdPerCall: 0.1, usdPerMinute: 0.2 } },
      costOptions,
      fdeRegistry,
    );
    expect(summary.pricedCalls).toBe(0);
    expect(summary.unpricedCalls).toBe(1);
    expect(summary.externalCostUsd).toBe(0);
  });

  it('includes known output-only Copilot cost as a partial minimum', () => {
    const summary = summarizeBusinessActivity(
      [event({
        toolCalls: [{
          toolName: 'mcp_workiq_ask_work_iq',
          toolKind: 'mcp',
          success: true,
        }],
        tokens: {
          inputTokens: 4,
          outputTokens: 2_000,
          inputEstimated: true,
          outputEstimated: false,
          estimatedCostUsd: 0,
          estimated: true,
        },
      })],
      {},
      costOptions,
      fdeRegistry,
    );
    expect(summary.aiCostUsd).toBeCloseTo(0.002, 8);
    expect(summary.aiCostPartial).toBe(true);
    expect(summary.workflows[0]?.aiCostPartial).toBe(true);
  });

  it('marks credit-priced workflow cost partial when credits are estimated', () => {
    const summary = summarizeBusinessActivity(
      [event({
        toolCalls: [{
          toolName: 'mcp_workiq_ask_work_iq',
          toolKind: 'mcp',
          success: true,
        }],
        tokens: {
          inputTokens: 2_000,
          outputTokens: 10,
          inputEstimated: false,
          outputEstimated: true,
          estimatedCredits: 3,
          estimatedCostUsd: 0,
          estimated: false,
        },
      })],
      {},
      { usdPerMillionTokens: 0, usdPerCredit: 0.1 },
      fdeRegistry,
    );
    expect(summary.aiCostUsd).toBeCloseTo(0.3, 8);
    expect(summary.aiCostPartial).toBe(true);
  });

  it('treats real credit-priced cost as complete while keeping token coverage separate', () => {
    const summary = summarizeBusinessActivity(
      [event({
        toolCalls: [{
          toolName: 'mcp_workiq_ask_work_iq',
          toolKind: 'mcp',
          success: true,
        }],
        tokens: {
          inputTokens: 4,
          outputTokens: 2_000,
          inputEstimated: true,
          outputEstimated: false,
          copilotCredits: 5,
          estimatedCostUsd: 0,
          estimated: true,
        },
      })],
      {},
      { usdPerMillionTokens: 0, usdPerCredit: 0.1 },
      fdeRegistry,
    );
    expect(summary.aiCostUsd).toBeCloseTo(0.5, 8);
    expect(summary.aiCostPartial).toBe(false);
  });
});

describe('sanitizeBusinessToolRates', () => {
  it('accepts numeric shorthand and drops negative or malformed values', () => {
    expect(
      sanitizeBusinessToolRates({
        WorkIQ: 0.03,
        kusto: { usdPerMinute: 0.2 },
        invalid: -1,
        nope: { usdPerCall: 'free' },
      }),
    ).toEqual({
      workiq: { usdPerCall: 0.03 },
      kusto: { usdPerMinute: 0.2 },
    });
  });
});