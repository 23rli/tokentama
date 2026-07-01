import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashText } from '../telemetry/hash';

/**
 * Local, on-device corpus of every captured prompt and its leaner rewrite.
 *
 * This is the training substrate for an auto-rewriter: each record pairs the
 * ORIGINAL prompt with the lean version and the token delta, plus the signals
 * (model, reasoning effort, waste categories, retries) that explain it. It never
 * leaves the machine — export is explicit via the exportCorpus command.
 *
 * Raw prompt text is stored when `storeRawText` is on (default) because training
 * a text→text rewriter on your own style requires the real text; a hash is always
 * stored so records remain correlatable even when raw text is off.
 */
export interface CorpusRecordInput {
  sessionId: string;
  turnIndex: number;
  source: string;
  promptText: string;
  model?: string;
  reasoningEffort?: string;
  overallScore: number;
  wasteScore: number;
  wasteCategories: string[];
  inputTokens: number;
  outputTokens: number;
  tokensReal: boolean;
  retryCount: number;
  rewrittenPrompt?: string;
  estimatedTokenReductionPct?: number;
  adopted?: boolean;
}

export interface CorpusRecord {
  v: 1;
  ts: string;
  sessionId: string;
  turnIndex: number;
  source: string;
  promptHash: string;
  promptChars: number;
  /** Raw prompt text — present only when storeRawText is enabled. */
  promptText?: string;
  model?: string;
  reasoningEffort?: string;
  overallScore: number;
  wasteScore: number;
  wasteCategories: string[];
  inputTokens: number;
  outputTokens: number;
  tokensReal: boolean;
  retryCount: number;
  /** Leaner rewrite — present only when storeRawText is enabled. */
  rewrittenPrompt?: string;
  estimatedTokenReductionPct?: number;
  adopted?: boolean;
}

/** A supervised training example for the rewriter: original prompt → lean rewrite. */
export interface TrainingPair {
  input: string;
  output: string;
  model?: string;
  reasoningEffort?: string;
  wasteCategories: string[];
  estimatedTokenReductionPct?: number;
}

/** Minimal surface ScoreService depends on (keeps the engine free of fs/vscode). */
export interface CorpusSink {
  record(input: CorpusRecordInput): void;
}

/** Build a corpus record. Pure — hashing/raw-text policy applied here. */
export function buildCorpusRecord(input: CorpusRecordInput, storeRawText: boolean): CorpusRecord {
  const rec: CorpusRecord = {
    v: 1,
    ts: new Date().toISOString(),
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    source: input.source,
    promptHash: hashText(input.promptText),
    promptChars: input.promptText.length,
    overallScore: Math.round(input.overallScore),
    wasteScore: Math.round(input.wasteScore),
    wasteCategories: input.wasteCategories,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    tokensReal: input.tokensReal,
    retryCount: input.retryCount,
  };
  if (storeRawText) {
    rec.promptText = input.promptText;
    if (input.rewrittenPrompt) rec.rewrittenPrompt = input.rewrittenPrompt;
  }
  if (input.model) rec.model = input.model;
  if (input.reasoningEffort) rec.reasoningEffort = input.reasoningEffort;
  if (input.estimatedTokenReductionPct !== undefined) {
    rec.estimatedTokenReductionPct = input.estimatedTokenReductionPct;
  }
  if (input.adopted !== undefined) rec.adopted = input.adopted;
  return rec;
}

/**
 * Turn a record into a training pair, or null when it can't teach a rewrite
 * (no raw text, no rewrite, or the rewrite isn't actually leaner).
 */
export function toTrainingPair(rec: CorpusRecord): TrainingPair | null {
  const input = rec.promptText?.trim();
  const output = rec.rewrittenPrompt?.trim();
  if (!input || !output || input === output) return null;
  if (output.length >= input.length) return null;
  return {
    input,
    output,
    model: rec.model,
    reasoningEffort: rec.reasoningEffort,
    wasteCategories: rec.wasteCategories,
    estimatedTokenReductionPct: rec.estimatedTokenReductionPct,
  };
}

export class CorpusStore implements CorpusSink {
  private readonly file: string;
  private readonly keys = new Set<string>();
  /** In-memory record cache so reads never re-parse the file. */
  private records: CorpusRecord[] = [];

  constructor(
    private readonly dir: string,
    private readonly enabled: () => boolean,
    private readonly storeRawText: () => boolean,
  ) {
    this.file = join(dir, 'corpus.jsonl');
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      for (const line of readFileSync(this.file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as CorpusRecord;
          this.records.push(rec);
          this.keys.add(`${rec.sessionId}:${rec.turnIndex}`);
        } catch {
          /* skip malformed line */
        }
      }
    } catch {
      /* corpus unreadable — start fresh */
    }
  }

  record(input: CorpusRecordInput): void {
    if (!this.enabled()) return;
    const key = `${input.sessionId}:${input.turnIndex}`;
    if (this.keys.has(key)) return;
    const rec = buildCorpusRecord(input, this.storeRawText());
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8');
      this.keys.add(key);
      this.records.push(rec);
    } catch {
      /* best-effort — never break scoring on a write error */
    }
  }

  count(): number {
    return this.keys.size;
  }

  all(): CorpusRecord[] {
    return this.records;
  }

  /** All valid (original → lean) training pairs currently in the corpus. */
  trainingPairs(): TrainingPair[] {
    return this.all()
      .map(toTrainingPair)
      .filter((p): p is TrainingPair => p !== null);
  }

  get filePath(): string {
    return this.file;
  }
}
