import Machine from '../Machine'
import Ressources from '../Resources/Ressources'
import Saveable from './Saveable'

export default class MachineSave extends Saveable<Machine> {
    private name!: string
    private craftId!: string

    public constructor (obj?: Machine, blob?: any) {
        super()
        this.init(obj, blob)
    }

    protected readonly fromObj = (machine: Machine): void => {
        this.name = machine.name
        this.craftId = machine.craft.id
    }

    protected readonly fromSave = (blob: MachineSave): void => {
        this.name = blob.name
        this.craftId = blob.craftId
    }

    public readonly getObj = (): Machine => {
        return new Machine(this.name, Ressources.getCraftById(this.craftId))
    }
}
