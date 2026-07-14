export const INPUT_TRACE_PROVENANCE_SCHEMA_VERSION: "aico8.input-trace-provenance.v1";

export interface InputTraceProvenanceValidationResult {
  valid: boolean;
  errors: string[];
}

export function inputTraceSha256(trace: unknown): string;
export function validateInputTraceProvenance(value: unknown): InputTraceProvenanceValidationResult;
export function assertInputTraceProvenance(value: unknown): void;
