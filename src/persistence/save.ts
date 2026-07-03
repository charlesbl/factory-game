import type { FactoryContract } from '../compiler'
import { serializeContract } from '../compiler'
import { stringifyExact } from '../domain'
import type { FactoryBlueprint } from '../editor'
import { canonicalBlueprint } from '../editor'
import type { FactoryRuntimeInstance } from '../simulation'
import { database, type BlueprintRecord, type ContractRecord, type InstanceRecord, type MetadataRecord } from './database'

export interface SaveBundle { readonly format: 'factory-game'; readonly schemaVersion: 1; readonly metadata: readonly MetadataRecord[]; readonly blueprints: readonly BlueprintRecord[]; readonly contracts: readonly ContractRecord[]; readonly instances: readonly InstanceRecord[] }

export const saveGame = async (blueprints: readonly FactoryBlueprint[], contracts: readonly FactoryContract[], instances: readonly FactoryRuntimeInstance[], logicalTime: bigint): Promise<void> => {
  const metadata: MetadataRecord = { key: 'main', schemaVersion: 1, savedAt: new Date().toISOString(), logicalTime: logicalTime.toString() }
  await database.transaction('rw', database.metadata, database.blueprints, database.contracts, database.instances, async () => {
    await database.metadata.put(metadata)
    await database.blueprints.bulkPut(blueprints.map((blueprint) => ({ id: blueprint.id, schemaVersion: 4, revision: blueprint.revision, payload: canonicalBlueprint(blueprint) })))
    await database.contracts.bulkPut(contracts.map((contract) => ({ hash: contract.blueprintHash, schemaVersion: 1, payload: stringifyExact(serializeContract(contract)) })))
    await database.instances.bulkPut(instances.map((instance) => ({ id: instance.id, schemaVersion: 1, contractHash: instance.contract.blueprintHash, payload: stringifyExact(instance.getSnapshot()) })))
  })
}
export const exportGame = async (): Promise<string> => stringifyExact({
  format: 'factory-game', schemaVersion: 1, metadata: await database.metadata.toArray(), blueprints: await database.blueprints.toArray(), contracts: await database.contracts.toArray(), instances: await database.instances.toArray(),
} satisfies SaveBundle)
export const loadRecords = async (): Promise<SaveBundle> => ({
  format: 'factory-game', schemaVersion: 1, metadata: await database.metadata.toArray(), blueprints: await database.blueprints.toArray(), contracts: await database.contracts.toArray(), instances: await database.instances.toArray(),
})
export const importGame = async (raw: string): Promise<void> => {
  const bundle = JSON.parse(raw) as Partial<SaveBundle>
  if (bundle.format !== 'factory-game' || bundle.schemaVersion !== 1 || !Array.isArray(bundle.blueprints) || !bundle.blueprints.every((record) => record.schemaVersion === 4) || !Array.isArray(bundle.metadata)) throw new Error('Unsupported or corrupt save')
  const backup = await exportGame()
  try {
    await database.transaction('rw', database.metadata, database.blueprints, database.contracts, database.instances, async () => {
      await Promise.all([database.metadata.clear(), database.blueprints.clear(), database.contracts.clear(), database.instances.clear()])
      await database.metadata.bulkPut(bundle.metadata!); await database.blueprints.bulkPut(bundle.blueprints!); await database.contracts.bulkPut(bundle.contracts ?? []); await database.instances.bulkPut(bundle.instances ?? [])
    })
  } catch (error) { localStorage.setItem('factory-game-recovery', backup); throw error }
}
