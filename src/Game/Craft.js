class Craft {
    constructor(input, output, duration) {
        this.input = input;
        this.output = output;
        this.duration = duration;
    }
    canCraft (factory) {
        return this.input.every(itemStack => {
            return factory.inventory.contains(itemStack);
        });
    };
    craft (factory) {
        this.input.forEach(itemStack => {
            factory.inventory.remove(itemStack);
        });
        this.output.forEach(itemStack => {
            factory.inventory.add(itemStack);
        });
    };
}
export default Craft;