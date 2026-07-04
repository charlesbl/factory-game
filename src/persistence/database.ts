import Dexie, { type EntityTable } from 'dexie'

export interface MetadataRecord { readonly key: string; readonly schemaVersion: number; readonly savedAt: string; readonly logicalTime: string }
export interface BlueprintRecord { readonly id: string; readonly schemaVersion: number; readonly revision: number; readonly payload: string }
export interface ContractRecord { readonly hash: string; readonly schemaVersion: number; readonly payload: string }
export interface InstanceRecord { readonly id: string; readonly schemaVersion: number; readonly contractHash: string; readonly payload: string }
export interface InventoryRecord { readonly id: string; readonly schemaVersion: number; readonly resourceId: string; readonly quantity: number; readonly capacity: number }
export interface DependencyRecord { readonly key: string; readonly parentId: string; readonly childId: string }
export interface FactoryRecord { readonly id: string; readonly name: string; readonly nextVersion: number; readonly createdAt: string; readonly updatedAt: string }
export interface DraftRecord { readonly factoryId: string; readonly schemaVersion: number; readonly baseVersion?: number; readonly revision: number; readonly autosavedAt: string; readonly payload: string }
export interface FactoryVersionRecord { readonly key: string; readonly factoryId: string; readonly version: number; readonly schemaVersion: number; readonly revision: number; readonly contractHash: string; readonly publishedAt: string; readonly recovered?: boolean; readonly payload: string }

export class FactoryDatabase extends Dexie {
  metadata!: EntityTable<MetadataRecord, 'key'>
  blueprints!: EntityTable<BlueprintRecord, 'id'>
  contracts!: EntityTable<ContractRecord, 'hash'>
  instances!: EntityTable<InstanceRecord, 'id'>
  inventories!: EntityTable<InventoryRecord, 'id'>
  dependencies!: EntityTable<DependencyRecord, 'key'>
  factories!: EntityTable<FactoryRecord, 'id'>
  drafts!: EntityTable<DraftRecord, 'factoryId'>
  factoryVersions!: EntityTable<FactoryVersionRecord, 'key'>
  constructor(name = 'factory-game') {
    super(name)
    this.version(1).stores({ metadata: '&key', blueprints: '&id,revision', contracts: '&hash', instances: '&id,contractHash', inventories: '&id,resourceId', dependencies: '&key,parentId,childId' })
    this.version(2).stores({
      metadata: '&key', blueprints: '&id,revision', contracts: '&hash', instances: '&id,contractHash', inventories: '&id,resourceId',
      dependencies: '&key,parentId,childId', factories: '&id,&name,nextVersion', drafts: '&factoryId,revision', factoryVersions: '&key,factoryId,version,contractHash',
    })
  }
}
export const database = new FactoryDatabase()
