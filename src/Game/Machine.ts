import Craft from './Craft'

export default class Machine {
    public readonly name: string
    public readonly craft: Craft

    public constructor (name: string, craft: Craft) {
        this.name = name
        this.craft = craft
    }
}
