import Id from "./Id";
import Game from "./Game";

const MANUAL_CRAFT_MIN = 500;
const MANUAL_CRAFT_MAX = 1500;

class Machine extends Id {
    constructor(name, craft, factory, save) {
        super();
        this.factory = factory;
        this.manual = false;
        if (save === undefined) {
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
            this.manual = save.manual;
        }
    }

    getSave() {
        return {
            name: this.name,
            pause: this.pause,
            currentCraftDuration: this.currentCraftDuration,
            isCrafting: this.isCrafting,
            craftId: this.craft.id,
            manual: this.manual
        };
    }

    startCraft() {
        this.craft.consume(this.factory);
        this.isCrafting = true;
    }

    endCraft() {
        this.craft.produce(this.factory);
        if (this.craft.canCraft(this.factory)) {
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
        if (!this.manual && !this.pause) {
            this.forward(delta);
        }
    }

    manualUpdate(delta) {
        this.forward(Math.random() * (MANUAL_CRAFT_MAX - MANUAL_CRAFT_MIN) + MANUAL_CRAFT_MIN);
    }

    forward(delta) {
        if (!this.isCrafting && this.craft.canCraft(this.factory)) {
            this.startCraft();
        }

        if (this.isCrafting) {
            this.currentCraftDuration += delta;
        }

        while (1) {
            if (this.isCraftFinished()) {
                this.endCraft();
            } else {
                break;
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