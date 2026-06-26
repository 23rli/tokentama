import type { ScoreToolCall, ScorePromptMetadata, WasteCategory } from '@tokentama/shared-types';

export interface DetectorInput {
  promptText: string;
  responseText?: string;
  toolCalls: ScoreToolCall[];
  recentPrompts: string[];
  adoptedPreviousTip?: boolean;
  hadPreviousTip?: boolean;
  metadata?: ScorePromptMetadata;
}

export interface DetectorResult {
  category: WasteCategory;
  /** 0..1 severity of avoidable waste in this category. */
  severity: number;
  reason?: string;
  improvement?: string;
}

export interface Detector {
  readonly category: WasteCategory;
  detect(input: DetectorInput): DetectorResult;
}

/** Output of the positive structure detector (not a waste category). */
export interface StructureSignal {
  /** 0..1 — how well-structured the prompt is. */
  structureScore: number;
  reasons: string[];
}
