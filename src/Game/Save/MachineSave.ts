import CraftManager from '../CraftManager'
import Machine from '../Machine'
import Saveable from './Saveable'

export default class MachineSave extends Saveable<Machine> {
    private machineCraftId!: string

    public constructor (obj?: Machine, blob?: MachineSave) {
        super()
        this.init(obj, blob)
    }

    protected readonly fromObj = (machine: Machine): void => {
        this.machineCraftId = machine.machineCraft.id
    }

    protected readonly fromSave = (blob: MachineSave): void => {
        this.machineCraftId = blob.machineCraftId
    }

    public readonly getObj = (craftManager: CraftManager): Machine => {
        return new Machine(craftManager.getMachineCraftById(this.machineCraftId))
    }
}
