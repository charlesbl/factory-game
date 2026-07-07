import { deserializeContract, serializeContract, type FactoryContract, type SerializedFactoryContract } from '../compiler'
import { asId, parseExact, stringifyExact } from '../domain'
import type { FactoryId } from '../domain'
import { canonicalBlueprint, deserializeBlueprint, serializeBlueprint, type FactoryBlueprint } from '../editor'
import { database, type ContractRecord, type DependencyRecord, type DraftRecord, type FactoryRecord, type FactoryVersionRecord } from '../persistence/database'
import type { FactoryDefinition, FactoryDraft, FactoryVersion } from './model'
import { draftKey, versionDependencies, versionKey } from './model'

export interface FactoryLibrarySnapshot {
  readonly definitions: readonly FactoryDefinition[]
  readonly drafts: readonly FactoryDraft[]
  readonly versions: readonly FactoryVersion[]
}

const definitionFromRecord = (record: FactoryRecord): FactoryDefinition => ({ ...record, id: asId<FactoryId>(record.id) })
const versionFromRecord = (record: FactoryVersionRecord, contract: FactoryContract): FactoryVersion => ({
  factoryId: asId<FactoryId>(record.factoryId), version: record.version, blueprint: deserializeBlueprint(JSON.parse(record.payload)), contract,
  publishedAt: record.publishedAt, ...(record.recovered ? { recovered: true } : {}),
})
const dependencyRecords = (parentId: string, blueprint: FactoryBlueprint): readonly DependencyRecord[] =>
  versionDependencies(blueprint).map((child) => ({ key: `${parentId}->${versionKey(child)}`, parentId, childId: versionKey(child) }))

const ensureUniqueName = async (name: string, exceptId?: FactoryId): Promise<string> => {
  const normalized = name.trim()
  if (normalized.length === 0) throw new Error('Factory name is required')
  const records = await database.factories.toArray()
  if (records.some((record) => record.id !== exceptId && record.name.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)) throw new Error('A factory with this name already exists')
  return normalized
}

export const loadFactoryLibrary = async (): Promise<FactoryLibrarySnapshot> => {
  const [factoryRecords, draftRecords, versionRecords, contractRecords] = await Promise.all([
    database.factories.toArray(), database.drafts.toArray(), database.factoryVersions.toArray(), database.contracts.toArray(),
  ])
  const contracts = new Map(contractRecords.map((record) => [record.hash, deserializeContract(parseExact<SerializedFactoryContract>(record.payload))]))
  const versions = versionRecords.flatMap((record) => { const contract = contracts.get(record.contractHash); return contract === undefined ? [] : [versionFromRecord(record, contract)] })
  return {
    definitions: factoryRecords.map(definitionFromRecord).sort((a, b) => a.name.localeCompare(b.name)),
    drafts: draftRecords.map((record) => ({ factoryId: asId<FactoryId>(record.factoryId), ...(record.baseVersion === undefined ? {} : { baseVersion: record.baseVersion }), blueprint: deserializeBlueprint(JSON.parse(record.payload)), autosavedAt: record.autosavedAt })),
    versions,
  }
}

export const createFactoryDefinition = async (blueprint: FactoryBlueprint, requestedName: string): Promise<FactoryDefinition> => {
  const name = await ensureUniqueName(requestedName); const now = new Date().toISOString()
  const definition: FactoryDefinition = { id: blueprint.id, name, nextVersion: 1, createdAt: now, updatedAt: now }
  await database.transaction('rw', database.factories, database.drafts, database.dependencies, async () => {
    await database.factories.add(definition)
    await database.drafts.put({ factoryId: blueprint.id, schemaVersion: 5, revision: blueprint.revision, autosavedAt: now, payload: canonicalBlueprint(blueprint) })
    await database.dependencies.bulkPut(dependencyRecords(draftKey(blueprint.id), blueprint))
  })
  return definition
}

export const renameFactoryDefinition = async (definition: FactoryDefinition, requestedName: string): Promise<FactoryDefinition> => {
  const name = await ensureUniqueName(requestedName, definition.id); const updatedAt = new Date().toISOString(); const next = { ...definition, name, updatedAt }
  await database.factories.put(next); return next
}

export const saveFactoryDraft = async (factoryId: FactoryId, blueprint: FactoryBlueprint, baseVersion?: number): Promise<FactoryDraft> => {
  const autosavedAt = new Date().toISOString(); const parentId = draftKey(factoryId)
  const record: DraftRecord = { factoryId, schemaVersion: 5, revision: blueprint.revision, autosavedAt, ...(baseVersion === undefined ? {} : { baseVersion }), payload: canonicalBlueprint(blueprint) }
  await database.transaction('rw', database.drafts, database.dependencies, async () => {
    await database.drafts.put(record); await database.dependencies.where('parentId').equals(parentId).delete(); await database.dependencies.bulkPut(dependencyRecords(parentId, blueprint))
  })
  return { factoryId, blueprint, ...(baseVersion === undefined ? {} : { baseVersion }), autosavedAt }
}

export const deleteFactoryDraft = async (factoryId: FactoryId): Promise<void> => {
  const parentId = draftKey(factoryId)
  await database.transaction('rw', database.drafts, database.dependencies, async () => {
    await database.drafts.delete(factoryId)
    await database.dependencies.where('parentId').equals(parentId).delete()
  })
}

export const deleteFactoryDefinition = async (factoryId: FactoryId): Promise<void> => {
  await database.transaction('rw', database.factories, database.drafts, database.factoryVersions, database.blueprints, async () => {
    if (await database.drafts.get(factoryId) !== undefined) throw new Error('Factory still has a draft')
    if (await database.factoryVersions.where('factoryId').equals(factoryId).count() > 0) throw new Error('Factory still has published versions')
    await database.factories.delete(factoryId); await database.blueprints.delete(factoryId)
  })
}

const samePublishedContent = (a: FactoryBlueprint, b: FactoryBlueprint): boolean => {
  const normalize = (blueprint: FactoryBlueprint) => { const value = serializeBlueprint(blueprint); return JSON.stringify({ ...value, id: '', revision: 0 }) }
  return normalize(a) === normalize(b)
}

export const publishFactoryVersion = async (definition: FactoryDefinition, draft: FactoryDraft, contract: FactoryContract): Promise<{ readonly definition: FactoryDefinition; readonly version: FactoryVersion }> => {
  if (draft.factoryId !== definition.id || draft.blueprint.id !== definition.id) throw new Error('Draft identity does not match factory')
  const existing = await database.factoryVersions.where('factoryId').equals(definition.id).toArray(); const latest = existing.sort((a, b) => b.version - a.version)[0]
  if (latest !== undefined && samePublishedContent(deserializeBlueprint(JSON.parse(latest.payload)), draft.blueprint)) throw new Error('This draft is already published')
  const versionNumber = definition.nextVersion; const publishedAt = new Date().toISOString(); const key = versionKey({ factoryId: definition.id, version: versionNumber })
  const versionRecord: FactoryVersionRecord = { key, factoryId: definition.id, version: versionNumber, schemaVersion: 5, revision: draft.blueprint.revision, contractHash: contract.blueprintHash, publishedAt, payload: canonicalBlueprint(draft.blueprint) }
  const contractRecord: ContractRecord = { hash: contract.blueprintHash, schemaVersion: 1, payload: stringifyExact(serializeContract(contract)) }
  const nextDefinition = { ...definition, nextVersion: versionNumber + 1, updatedAt: publishedAt }
  await database.transaction('rw', database.factories, database.drafts, database.factoryVersions, database.contracts, database.dependencies, async () => {
    if (await database.factoryVersions.get(key) !== undefined) throw new Error('Version already exists')
    await database.factoryVersions.add(versionRecord); await database.contracts.put(contractRecord); await database.factories.put(nextDefinition)
    await database.drafts.put({ factoryId: definition.id, schemaVersion: 5, baseVersion: versionNumber, revision: draft.blueprint.revision, autosavedAt: publishedAt, payload: canonicalBlueprint(draft.blueprint) })
    await database.dependencies.bulkPut(dependencyRecords(key, draft.blueprint)); await database.dependencies.where('parentId').equals(draftKey(definition.id)).delete(); await database.dependencies.bulkPut(dependencyRecords(draftKey(definition.id), draft.blueprint))
  })
  return { definition: nextDefinition, version: { factoryId: definition.id, version: versionNumber, blueprint: draft.blueprint, contract, publishedAt } }
}

export const restoreFactoryVersionAsDraft = async (version: FactoryVersion): Promise<FactoryDraft> => {
  const blueprint = { ...version.blueprint, revision: version.blueprint.revision + 1 }
  return saveFactoryDraft(version.factoryId, blueprint, version.version)
}

export const versionUsages = async (factoryId: FactoryId, version: number): Promise<readonly string[]> => {
  const childId = versionKey({ factoryId, version }); const dependencies = await database.dependencies.where('childId').equals(childId).toArray()
  const draftBases = (await database.drafts.toArray()).filter((draft) => draft.factoryId === factoryId && draft.baseVersion === version)
  const contractHash = (await database.factoryVersions.get(childId))?.contractHash
  const instances = contractHash === undefined ? [] : await database.instances.where('contractHash').equals(contractHash).toArray()
  return [...dependencies.map((dependency) => dependency.parentId), ...draftBases.map((draft) => draftKey(asId<FactoryId>(draft.factoryId))), ...instances.map((instance) => `instance:${instance.id}`)]
}

export const deleteFactoryVersion = async (factoryId: FactoryId, version: number): Promise<void> => {
  const key = versionKey({ factoryId, version }); const usages = await versionUsages(factoryId, version)
  if (usages.length > 0) throw new Error(`Version is still used by ${usages.join(', ')}`)
  await database.transaction('rw', database.factoryVersions, database.dependencies, async () => { await database.factoryVersions.delete(key); await database.dependencies.where('parentId').equals(key).delete() })
}
