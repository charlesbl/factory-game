import Id from "./Id";
import Game from "./Game";

class Machine extends Id {
    constructor(name, craft, factory, save) {
        super();
        this.factory = factory;
        if(save === undefined) {
            this.name = name;
            this.pause = false;
            this.craft = craft;
            this.currentCraftDuration = 0;
            this.isCrafting = false;
        } else {
            this.name = save.name;
            this.pause = save.pause;
            this.craft = Game.getCraftById(save.craftId);
            this.currentCraftDuration = save.currentCraftDuration;
            this.isCrafting = save.isCrafting;
        }
    }

    getSave() {
        return {
            name: this.name,
            pause: this.pause,
            currentCraftDuration: this.currentCraftDuration,
            isCrafting: this.isCrafting,
            craftId: this.craft.id
        };
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