import Machine from '../Machine'
import Ressources from '../Resources/Ressources'
import Saveable from './Saveable'

export default class MachineSave extends Saveable<Machine> {
    name!: string
    craftId!: string
    manual!: boolean

    constructor (obj?: Machine, blob?: any) {
        super()
        this.init(obj, blob)
    }

    fromObj = (machine: Machine): void => {
        this.name = machine.name
        this.craftId = machine.craft.id
        this.manual = machine.manual
    }

    fromSave = (blob: MachineSave): void => {
        this.name = blob.name
        this.craftId = blob.craftId
        this.manual = blob.manual
    }

    getObj = (): Machine => {
        return new Machine(this.name, Ressources.getCraftById(this.craftId), this.manual)
    }
}