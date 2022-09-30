import Machine from './Machine'

export default class ManualMachine extends Machine {
    private _active: boolean = false

    public get active (): boolean {
        return this._active
    }

    public set active (value: boolean) {
        this._active = value
    }
}
