class Machine {
    constructor(factory, craft) {
        this.factory = factory;
        this.pause = false;
        this.craft = craft;
        this.machineInterval = setInterval(() => this.tryCraft(), craft.duration);
    }
    tryCraft () {
        if(!this.pause) {
            if (this.craft.canCraft(this.factory)) {
                this.craft.craft(this.factory);
            }
            else {
                console.log("Can't craft " + this.craft.output);
            }
        }
    };
}
export default Machine;