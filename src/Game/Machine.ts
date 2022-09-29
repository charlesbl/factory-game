import Craft from "./Craft";

const MANUAL_CRAFT_FACTOR: number = 2;

export default class Machine {
    name: string;
    craft: Craft;
    manual: boolean;

    constructor(name: string, craft: Craft, manual: boolean = false) {
        this.name = name;
        this.craft = craft;
        this.manual = manual;
    }
}