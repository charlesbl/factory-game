import Craft from './Craft'
import MachineCraft from './MachineCraft'

export default class Machine {
    public readonly machineCraft: MachineCraft
    private _active: boolean

    public get craft (): Craft {
        return this.machineCraft.outputCraft
    }

    public get name (): string {
        return this.machineCraft.name
    }

    public get active (): boolean {
        return this._active
    }

    public set active (value: boolean) {
        this._active = value
    }

    public constructor (machineCraft: MachineCraft) {
        this.machineCraft = machineCraft
        this._active = true
    }
}
