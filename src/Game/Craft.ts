import ItemStack from "./ItemStack";
import Factory from "./Factory";

class Craft {
    id: string;
    name: string;
    input: ItemStack[];
    output: ItemStack[];
    duration: number;
    constructor(id: string, name: string, input: ItemStack[], output: ItemStack[], duration: number) {
        this.id = id;
        this.name = name;
        this.input = input;
        this.output = output;
        this.duration = duration;
    }

    canCraft(factory: Factory) {
        return this.input.every(itemStack => {
            return factory.inventory.contains(itemStack);
        });
    }

    consume(factory: Factory) {
        this.input.forEach(itemStack => {
            factory.inventory.remove(itemStack);
        });
    }

    produce(factory: Factory) {
        this.output.forEach(itemStack => {
            factory.inventory.add(itemStack);
        });
    }

    craft(factory: Factory) {
        this.consume(factory);
        this.produce(factory);
    }

    tryCraft(factory: Factory) {
        if (this.canCraft(factory)) {
            this.craft(factory);
            return true;
        } else {
            return false;
        }
    }
}
export default Craft;