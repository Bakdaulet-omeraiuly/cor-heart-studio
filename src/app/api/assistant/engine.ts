// The only import of the diagnosis engine in the assistant (spec: .kiro/specs/assistant-chat/, "Engine boundary").
export { assess } from "@/domain/diagnosis";
export type { Assessment, Finding, Evidence } from "@/domain/diagnosis";
