import Craft from './Craft'

export default class Machine {
    name: string
    craft: Craft

    constructor (name: string, craft: Craft) {
        this.name = name
        this.craft = craft
    }
}
