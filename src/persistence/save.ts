import type { FactoryContract } from '../compiler'
import { serializeContract } from '../compiler'
import { parseExact, stringifyExact } from '../domain'
import type { FactoryBlueprint } from '../editor'
import { canonicalBlueprint } from '../editor'
import type { FactoryRuntimeInstance } from '../simulation'
import type { WorldRuntime } from '../world'
import { parseWorldRuntime, serializeWorldRuntime } from '../world'
import { database, type BlueprintRecord, type ContractRecord, type DependencyRecord, type DraftRecord, type FactoryRecord, type FactoryVersionRecord, type InstanceRecord, type InventoryRecord, type MetadataRecord, type WorldRecord } from './database'

export interface SaveBundle { readonly format: 'factory-game'; readonly schemaVersion: 4; readonly metadata: readonly MetadataRecord[]; readonly blueprints: readonly BlueprintRecord[]; readonly contracts: readonly ContractRecord[]; readonly instances: readonly InstanceRecord[]; readonly inventories: readonly InventoryRecord[]; readonly factories: readonly FactoryRecord[]; readonly drafts: readonly DraftRecord[]; readonly factoryVersions: readonly FactoryVersionRecord[]; readonly dependencies: readonly DependencyRecord[]; readonly worlds: readonly WorldRecord[] }

export const saveGame = async (blueprints: readonly FactoryBlueprint[], contracts: readonly FactoryContract[], instances: readonly FactoryRuntimeInstance[], logicalTime: bigint, world?: WorldRuntime): Promise<void> => {
  const savedAt = new Date().toISOString(); const metadata: MetadataRecord = { key: 'main', schemaVersion: 1, savedAt, logicalTime: logicalTime.toString() }
  await database.transaction('rw', database.metadata, database.blueprints, database.contracts, database.instances, database.worlds, async () => {
    await Promise.all([database.blueprints.clear(), database.contracts.clear(), database.instances.clear(), ...(world === undefined ? [] : [database.worlds.clear()])])
    await database.metadata.put(metadata)
    await database.blueprints.bulkPut(blueprints.map((blueprint) => ({ id: blueprint.id, schemaVersion: 5, revision: blueprint.revision, payload: canonicalBlueprint(blueprint) })))
    await database.contracts.bulkPut(contracts.map((contract) => ({ hash: contract.blueprintHash, schemaVersion: 1, payload: stringifyExact(serializeContract(contract)) })))
    await database.instances.bulkPut(instances.map((instance) => ({ id: instance.id, schemaVersion: 1, contractHash: instance.contract.blueprintHash, payload: stringifyExact(instance.getSnapshot()) })))
    if (world !== undefined) await database.worlds.put({ id: 'main', schemaVersion: 2, revision: world.revision, savedAt, payload: stringifyExact(serializeWorldRuntime(world)) })
  })
}
export const exportGame = async (): Promise<string> => stringifyExact({
  format: 'factory-game', schemaVersion: 4, metadata: await database.metadata.toArray(), blueprints: await database.blueprints.toArray(), contracts: await database.contracts.toArray(), instances: await database.instances.toArray(), inventories: await database.inventories.toArray(), factories: await database.factories.toArray(), drafts: await database.drafts.toArray(), factoryVersions: await database.factoryVersions.toArray(), dependencies: await database.dependencies.toArray(), worlds: await database.worlds.toArray(),
} satisfies SaveBundle)
export const loadRecords = async (): Promise<SaveBundle> => ({
  format: 'factory-game', schemaVersion: 4, metadata: await database.metadata.toArray(), blueprints: await database.blueprints.toArray(), contracts: await database.contracts.toArray(), instances: await database.instances.toArray(), inventories: await database.inventories.toArray(), factories: await database.factories.toArray(), drafts: await database.drafts.toArray(), factoryVersions: await database.factoryVersions.toArray(), dependencies: await database.dependencies.toArray(), worlds: await database.worlds.toArray(),
})
export const importGame = async (raw: string): Promise<void> => {
  const bundle = parseExact<Partial<Omit<SaveBundle, 'schemaVersion'>> & { readonly schemaVersion?: number }>(raw)
  if (bundle.format !== 'factory-game' || bundle.schemaVersion !== 4 || !Array.isArray(bundle.metadata) || !Array.isArray(bundle.blueprints) || !bundle.blueprints.every((record) => record.schemaVersion === 5) || !Array.isArray(bundle.contracts) || !Array.isArray(bundle.instances) || !Array.isArray(bundle.inventories) || !Array.isArray(bundle.factories) || !Array.isArray(bundle.drafts) || !Array.isArray(bundle.factoryVersions) || !Array.isArray(bundle.dependencies) || !Array.isArray(bundle.worlds) || !bundle.worlds.every((record) => record.schemaVersion === 2 && typeof record.savedAt === 'string')) throw new Error('Unsupported or corrupt save: only schema 4 is accepted')
  const valid = bundle as SaveBundle; for (const record of valid.worlds) parseWorldRuntime(record.payload)
  await database.transaction('rw', [database.metadata, database.blueprints, database.contracts, database.instances, database.inventories, database.factories, database.drafts, database.factoryVersions, database.dependencies, database.worlds], async () => {
    await Promise.all([database.metadata.clear(), database.blueprints.clear(), database.contracts.clear(), database.instances.clear(), database.inventories.clear(), database.factories.clear(), database.drafts.clear(), database.factoryVersions.clear(), database.dependencies.clear(), database.worlds.clear()])
    await database.metadata.bulkPut(valid.metadata); await database.blueprints.bulkPut(valid.blueprints); await database.contracts.bulkPut(valid.contracts); await database.instances.bulkPut(valid.instances); await database.inventories.bulkPut(valid.inventories); await database.factories.bulkPut(valid.factories); await database.drafts.bulkPut(valid.drafts); await database.factoryVersions.bulkPut(valid.factoryVersions); await database.dependencies.bulkPut(valid.dependencies); await database.worlds.bulkPut(valid.worlds)
  })
}
