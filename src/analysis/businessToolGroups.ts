import type {
  BusinessToolGroupInfo,
  ToolCallInfo,
} from '@tokentama/shared-types';

interface ServiceRule {
  id: string;
  name: string;
  pattern: RegExp;
}

interface GroupDefinition {
  info: Omit<BusinessToolGroupInfo, 'enabled'>;
  services: ServiceRule[];
  workflowMarkers: string[];
  mcpOnly: boolean;
  catchAllMcp?: boolean;
}

export interface BusinessToolMatch {
  groupId: string;
  groupName: string;
  serviceId: string;
  serviceName: string;
}

export interface BusinessWorkflowGroupMatch {
  groupId: string;
  groupName: string;
}

export interface BusinessToolRegistry {
  enabled: boolean;
  groups: BusinessToolGroupInfo[];
  signature: string;
  matchTool(call: Pick<ToolCallInfo, 'toolName' | 'toolKind'>): BusinessToolMatch | undefined;
  matchWorkflow(name: string): BusinessWorkflowGroupMatch | undefined;
  matchesWorkflow(name: string): boolean;
}

const FDE_HQ_SERVICES: ServiceRule[] = [
  rule('sharepoint-lists', 'SharePoint Lists', /sharepoint_?lists/),
  rule('azure-devops', 'Azure DevOps', /azure_?devops|(?:^|_)ado(?:_|$)|(?:^|_)wit(?:_|$)|work_?item/),
  rule('workiq', 'WorkIQ', /work_?iq/),
  rule('sharepoint', 'SharePoint', /sharepoint/),
  rule('outlook-mail', 'Outlook Mail', /(?:^|_)(?:mail|outlook)(?:_|$)/),
  rule('calendar', 'Outlook Calendar', /calendar|meeting/),
  rule('teams', 'Microsoft Teams', /(?:^|_)teams?(?:_|$)/),
  rule('planner', 'Microsoft Planner', /planner/),
  rule('word', 'Microsoft Word', /(?:^|_)word(?:_|$)/),
  rule('onedrive', 'OneDrive', /one_?drive/),
  rule('fabric', 'Fabric / Power BI', /fabric|power_?bi|analysis_?services/),
  rule('kusto', 'Azure Data Explorer', /kusto|azure_?data_?explorer/),
  rule('icm', 'ICM', /(?:^|_)icm(?:_|$)/),
  rule('enghub', 'Engineering Hub', /eng_?hub/),
  rule('bluebird', 'Bluebird', /bluebird/),
  rule('mrc', 'Microsoft Release Communications', /(?:^|_)mrc(?:_|$)/),
  rule('s360', 'S360', /s360/),
  rule('security', 'Microsoft Security', /security/),
  rule('service-tree', 'ServiceTree', /service_?tree/),
  rule('microsoft-learn', 'Microsoft Learn', /msft_?learn|microsoft_?learn/),
  rule('playwright', 'Playwright', /playwright/),
  rule('markitdown', 'MarkItDown', /mark_?it_?down/),
];

const BUILT_INS: GroupDefinition[] = [
  {
    info: {
      id: 'fde-hq',
      name: 'FD&E HQ',
      description: 'Agency-backed Microsoft 365, Azure DevOps, Fabric, security, and utility tools used by FD&E HQ.',
      source: 'built-in',
    },
    services: FDE_HQ_SERVICES,
    workflowMarkers: ['fde-', 'fabric-pivot-builder'],
    mcpOnly: true,
  },
  {
    info: {
      id: 'all-mcp',
      name: 'All MCP tools',
      description: 'Track every MCP tool, including servers Token Lens does not recognize yet.',
      source: 'built-in',
    },
    services: [],
    workflowMarkers: [],
    mcpOnly: true,
    catchAllMcp: true,
  },
];

/** Build a runtime registry from settings. Custom groups are data, not code. */
export function createBusinessToolRegistry(
  enabledInput: unknown,
  enabledGroupsInput: unknown,
  customGroupsInput: unknown,
): BusinessToolRegistry {
  const enabled = enabledInput === true;
  const enabledIds = sanitizeEnabledGroups(enabledGroupsInput);
  const custom = sanitizeCustomGroups(customGroupsInput);
  const definitions = [...BUILT_INS, ...custom];
  const enabledSet = new Set(enabledIds);
  const groups = definitions.map((definition) => ({
    ...definition.info,
    enabled: enabledSet.has(definition.info.id),
  }));
  // User-defined groups are most specific, then named built-ins; all-mcp is
  // deliberately last so it acts as a fallback rather than stealing matches.
  const active = [
    ...custom.filter((group) => enabledSet.has(group.info.id)),
    ...BUILT_INS.filter((group) => enabledSet.has(group.info.id) && !group.catchAllMcp),
    ...BUILT_INS.filter((group) => enabledSet.has(group.info.id) && group.catchAllMcp),
  ];

  return {
    enabled,
    groups,
    signature: JSON.stringify({
      enabled,
      enabledGroups: [...enabledSet].sort(),
      customGroups: custom.map(serializeDefinition),
    }),
    matchTool(call) {
      if (!enabled) return undefined;
      const normalized = normalizeToolName(call.toolName);
      for (const group of active) {
        if (group.mcpOnly && call.toolKind !== 'mcp') continue;
        const service = group.services.find((candidate) => candidate.pattern.test(normalized));
        if (service) return match(group, service.id, service.name);
        if (group.catchAllMcp && call.toolKind === 'mcp') {
          const id = extractMcpServerId(normalized);
          return match(group, id, humanize(id));
        }
      }
      return undefined;
    },
    matchWorkflow(name) {
      if (!enabled) return undefined;
      const normalized = normalizeToolName(name);
      const group = active.find((candidate) =>
        candidate.workflowMarkers.some((marker) =>
          marker === '*' || normalized.includes(normalizeToolName(marker)),
        ),
      );
      return group
        ? { groupId: group.info.id, groupName: group.info.name }
        : undefined;
    },
    matchesWorkflow(name) {
      return !!this.matchWorkflow(name);
    },
  };
}

function sanitizeEnabledGroups(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((item): item is string => typeof item === 'string').map(normalizeId).filter(Boolean))];
}

function sanitizeCustomGroups(input: unknown): GroupDefinition[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const builtInIds = new Set(BUILT_INS.map((group) => group.info.id));
  const groups: GroupDefinition[] = [];
  for (const [rawId, rawGroup] of Object.entries(input as Record<string, unknown>)) {
    const id = normalizeId(rawId);
    if (!id || builtInIds.has(id) || !rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) continue;
    const source = rawGroup as Record<string, unknown>;
    const services = sanitizeCustomServices(source.services);
    const workflowMarkers = sanitizeMarkers(source.workflows);
    if (services.length === 0 && workflowMarkers.length === 0) continue;
    groups.push({
      info: {
        id,
        name: cleanLabel(source.name) ?? humanize(id),
        description: cleanLabel(source.description) ?? 'User-defined business-tool group.',
        source: 'custom',
      },
      services,
      workflowMarkers,
      mcpOnly: source.mcpOnly === true,
    });
  }
  return groups.sort((a, b) => a.info.id.localeCompare(b.info.id));
}

function sanitizeCustomServices(input: unknown): ServiceRule[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const services: ServiceRule[] = [];
  for (const [rawId, rawService] of Object.entries(input as Record<string, unknown>)) {
    const id = normalizeId(rawId);
    if (!id || !rawService || typeof rawService !== 'object' || Array.isArray(rawService)) continue;
    const source = rawService as Record<string, unknown>;
    const markers = sanitizeMarkers(source.match);
    if (markers.length === 0) continue;
    // Custom matching is intentionally substring-only: no user-supplied regular
    // expressions execute inside the extension host.
    const pattern = new RegExp(markers.map(escapeRegExp).join('|'));
    services.push(rule(id, cleanLabel(source.name) ?? humanize(id), pattern));
  }
  return services.sort((a, b) => a.id.localeCompare(b.id));
}

function sanitizeMarkers(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(
    input
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeToolName)
      .filter((item) => item.length > 0 && item.length <= 100),
  )].slice(0, 100);
}

function match(group: GroupDefinition, serviceId: string, serviceName: string): BusinessToolMatch {
  return {
    groupId: group.info.id,
    groupName: group.info.name,
    serviceId,
    serviceName,
  };
}

function rule(id: string, name: string, pattern: RegExp): ServiceRule {
  return { id, name, pattern };
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function extractMcpServerId(normalized: string): string {
  const afterMcp = normalized.replace(/^.*?mcp_/, '');
  return afterMcp.split('_').find(Boolean) ?? 'mcp';
}

function humanize(id: string): string {
  if (id === 'mcp') return 'MCP service';
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 120 ? cleaned : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeDefinition(group: GroupDefinition): object {
  return {
    id: group.info.id,
    name: group.info.name,
    description: group.info.description,
    services: group.services.map((service) => ({ id: service.id, name: service.name, pattern: service.pattern.source })),
    workflows: group.workflowMarkers,
    mcpOnly: group.mcpOnly,
  };
}