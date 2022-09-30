import Craft from './Craft'

export default class Machine {
    public readonly name: string
    public readonly craft: Craft
    private _active: boolean

    public get active (): boolean {
        return this._active
    }

    public set active (value: boolean) {
        this._active = value
    }

    public constructor (name: string, craft: Craft) {
        this.name = name
        this.craft = craft
        this._active = true
    }
}
