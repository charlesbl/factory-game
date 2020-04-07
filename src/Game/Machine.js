import Id from "./Id";
import Game from "./Game";

const MANUAL_CRAFT_MIN = 500;
const MANUAL_CRAFT_MAX = 800;

class Machine extends Id {
    constructor(name, craft, factory) {
        super();
        this.name = name;
        this.craft = craft;
        this.factory = factory;
        this.pause = false;
        this.currentCraftDuration = 0;
        this.isCrafting = false;
        this.manual = false;
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

    static fromSave(factory, save) {
        var machine = new Machine(save.name, Game.getCraftById(save.craftId), factory);
        machine.pause = save.pause;
        machine.currentCraftDuration = save.currentCraftDuration;
        machine.isCrafting = save.isCrafting;
        machine.manual = save.manual;
        return machine;
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