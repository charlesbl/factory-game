import Craft from './Craft'

export default class Machine {
    name: string
    craft: Craft
    manual: boolean

    constructor (name: string, craft: Craft, manual: boolean = false) {
        this.name = name
        this.craft = craft
        this.manual = manual
    }
}
