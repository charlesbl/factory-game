import Id from "./Id";

class Machine extends Id {
    constructor(name, factory, craft) {
        super();
        console.log(name);
        console.log(factory);
        console.log(craft);
        this.name = name;
        this.factory = factory;
        this.pause = false;
        this.craft = craft;
        this.currentCraftDuration = 0;
        this.isCrafting = false;
    }

    startCraft() {
        this.craft.consume(this.factory);
        this.isCrafting = true;
    }

    endCraft() {
        this.craft.produce(this.factory);
        if(this.craft.canCraft(this.factory)) {
            this.startCraft();
            this.currentCraftDuration -= this.craft.duration;
        } else {
            this.currentCraftDuration = 0;
            this.isCrafting = false;
        }
    }

    isCraftFinished() {
        return this.currentCraftDuration >= this.craft.duration;
    }

    update(delta) {
        if(!this.pause) {

            if(!this.isCrafting && this.craft.canCraft(this.factory)) {
                this.startCraft();
            }

            if(this.isCrafting) {
                this.currentCraftDuration += delta;
            }

            while(1) {
                if(this.isCraftFinished()) {
                    this.endCraft();
                } else {
                    break;
                }
            }
        }
    }

    getPercentage() {
        return 100 * this.currentCraftDuration / this.craft.duration;
    }

    destroy() {
        this.factory.destroyMachine(this);
    }
    togglePause() {
        this.pause = !this.pause;
    }
}
export default Machine;