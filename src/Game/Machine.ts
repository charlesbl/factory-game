import Id from "./Id";
import Game from "./Game";
import Craft from "./Craft";
import Factory from "./Factory";

const MANUAL_CRAFT_MIN = 500;
const MANUAL_CRAFT_MAX = 800;

export interface IMachineSave {
    name: string;
    pause: boolean;
    currentCraftDuration: number;
    isCrafting: boolean;
    craftId: number;
    manual: boolean;
}

export default class Machine extends Id {
    manual: boolean;
    name: string;
    craft: Craft;
    factory: Factory;
    pause: boolean;
    currentCraftDuration: number;
    isCrafting: boolean;
    
    constructor(name: string, craft: Craft, factory: Factory) {
        super();
        this.name = name;
        this.craft = craft;
        this.factory = factory;
        this.pause = false;
        this.currentCraftDuration = 0;
        this.isCrafting = false;
        this.manual = false;
    }

    getSave(): IMachineSave {
        return {
            name: this.name,
            pause: this.pause,
            currentCraftDuration: this.currentCraftDuration,
            isCrafting: this.isCrafting,
            craftId: this.craft.id,
            manual: this.manual
        };
    }

    static fromSave(factory: Factory, save: IMachineSave) {
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

    isCraftFinished(): boolean {
        return this.currentCraftDuration >= this.craft.duration;
    }

    update(delta: number) {
        if (!this.manual && !this.pause) {
            this.forward(delta);
        }
    }

    manualUpdate() {
        this.forward(Math.random() * (MANUAL_CRAFT_MAX - MANUAL_CRAFT_MIN) + MANUAL_CRAFT_MIN);
    }

    forward(delta: number) {
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

    getPercentage(): number {
        return 100 * this.currentCraftDuration / this.craft.duration;
    }

    destroy() {
        this.factory.destroyMachine(this);
    }

    togglePause() {
        this.pause = !this.pause;
    }
}