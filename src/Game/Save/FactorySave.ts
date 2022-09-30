import Factory from '../Factory'
import Machine from '../Machine'
import Saveable from './Saveable'
import MachineSave from './MachineSave'

export default class FactorySave extends Saveable<Factory> {
    private machines!: MachineSave[]
    private factories!: FactorySave[]

    public constructor (obj?: Factory, blob?: any) {
        super()
        this.init(obj, blob)
    }

    protected fromObj = (factory: Factory): void => {
        this.machines = factory.machines.map((machine: Machine) => new MachineSave(machine))
        this.factories = factory.factories.map((factoryReq: Factory) => new FactorySave(factoryReq))
    }

    protected fromSave = (blob: FactorySave): void => {
        this.machines = blob.machines.map((machineSave: MachineSave) => new MachineSave(undefined, machineSave))
        this.factories = blob.factories.map((factorySave: FactorySave) => new FactorySave(undefined, factorySave))
    }

    public getObj = (): Factory => {
        const factory = new Factory(this.machines.map((machineSave: MachineSave) => machineSave.getObj()), this.factories.map((factorySave: FactorySave) => factorySave.getObj()))
        factory.factories.forEach((f) => f.setTopFactory(factory))
        return factory
    }
}
