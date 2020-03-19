class Craft {
    constructor(id, name, input, output, duration) {
        this.id = id;
        this.name = name;
        this.input = input;
        this.output = output;
        this.duration = duration;
    }

    canCraft (factory) {
        return this.input.every(itemStack => {
            return factory.inventory.contains(itemStack);
        });
    }

    consume(factory) {
        this.input.forEach(itemStack => {
            factory.inventory.remove(itemStack);
        });
    }

    produce(factory) {
        if(this.output instanceof Array) {
            this.output.forEach(itemStack => {
                factory.inventory.add(itemStack);
            });
        } else if (this.output instanceof Craft) {
            factory.buildMachine(this);
        }
    }

    craft (factory) {
        this.consume(factory);
        this.produce(factory);
    }

    tryCraft(factory) {
        if(this.canCraft(factory)) {
            this.craft(factory);
            return true;
        } else {
            return false;
        }
    }
}
export default Craft;