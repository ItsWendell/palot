export interface ManagedSkill {
	filename: string
	name: string
	description: string
	tags: string[]
	author: string
	created: string
	content: string
	raw: string
	origin: "user" | "project" | "external"
	externalRepo?: string
}

export type SkillImportRiskCategory =
	| "secret"
	| "env-credential"
	| "private-key"
	| "oauth-token"
	| "password"
	| "malware"
	| "obfuscated-code"
	| "remote-installer"
	| "destructive-command"
	| "credential-exfiltration"
	| "crypto-miner"
	| "prompt-injection"
	| "social-engineering"
	| "hidden-unicode"
	| "oversized-content"
	| "binary-content"
	| "invalid-url"
	| "fetch-error"
	| "empty-content"

export interface SkillImportRisk {
	category: SkillImportRiskCategory
	message: string
}

export interface SkillImportSafetyReview {
	allowed: boolean
	risks: SkillImportRisk[]
	contentBytes: number
	sourceCount: number
}

export interface SkillImportSource {
	url: string
	path: string
	bytes: number
}

export interface SkillDraft {
	filename: string
	name: string
	description: string
	tags: string[]
	author: string
	content: string
	raw: string
	sources: SkillImportSource[]
}

export interface SkillImportResult {
	ok: boolean
	url: string
	review: SkillImportSafetyReview
	draft?: SkillDraft
	blockedReason?: string
}

export interface SkillImportAuditEntry {
	url: string
	timestamp: string
	allowed: boolean
	blocked: boolean
	riskCategories: SkillImportRiskCategory[]
	sourceCount: number
	contentBytes: number
}
