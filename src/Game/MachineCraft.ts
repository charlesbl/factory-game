import Craft from "./Craft";
import ItemStack from "./ItemStack";
import Factory from "./Factory";

export default class MachineCraft extends Craft {
    outputCraft: Craft;
    constructor(id: string, name: string, input: ItemStack[], outputCraft: Craft, duration: number) {
        super(id, name, input, [], duration);
        this.outputCraft = outputCraft;
    }

    produce(factory: Factory) {
        factory.buildMachine(this);
    }
}