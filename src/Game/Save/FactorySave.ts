import Factory from '../Factory'
import Machine from '../Machine'
import Saveable from './Saveable'
import MachineSave from './MachineSave'
import CraftManager from '../CraftManager'

export default class FactorySave extends Saveable<Factory> {
    private machines!: MachineSave[]
    private factories!: FactorySave[]
    private name!: string

    public constructor (obj?: Factory, blob?: FactorySave) {
        super()
        this.init(obj, blob)
    }

    protected fromObj = (factory: Factory): void => {
        this.machines = factory.machines.map((machine: Machine) => new MachineSave(machine))
        this.factories = factory.factories.map((factoryReq: Factory) => new FactorySave(factoryReq))
        this.name = factory.name
    }

    protected fromSave = (blob: FactorySave): void => {
        this.machines = blob.machines.map((machineSave: MachineSave) => new MachineSave(undefined, machineSave))
        this.factories = blob.factories.map((factorySave: FactorySave) => new FactorySave(undefined, factorySave))
        this.name = blob.name
    }

    public getObj = (craftManager: CraftManager): Factory => {
        const factory = new Factory(this.machines.map((machineSave: MachineSave) => machineSave.getObj(craftManager)), this.factories.map((factorySave: FactorySave) => factorySave.getObj(craftManager)))
        factory.factories.forEach((f) => f.setTopFactory(factory))
        factory.name = this.name
        return factory
    }
}
