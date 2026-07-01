import type { CompileDiagnostic, SerializedFactoryContract } from '../compiler'
import type { SerializedBlueprint } from '../editor'

export const COMPILER_PROTOCOL_VERSION = 1
export interface CompileRequest { readonly protocolVersion: 1; readonly requestId: string; readonly revision: number; readonly blueprint: SerializedBlueprint; readonly childContracts: readonly SerializedFactoryContract[] }
export type CompileResponse =
  | { readonly protocolVersion: 1; readonly requestId: string; readonly revision: number; readonly ok: true; readonly contract: SerializedFactoryContract }
  | { readonly protocolVersion: 1; readonly requestId: string; readonly revision: number; readonly ok: false; readonly diagnostics: readonly CompileDiagnostic[] }
