import Craft from './Craft'
import Factory from './Factory'
import Ingredient from './Ingredient'
import Inventory from './Inventory'
import Machine from './Machine'
import MachineCraft from './MachineCraft'
import Ressources from './Resources/Ressources'

// TODO Rename Factory
// TODO Energy system
// TODO rework crafts
// TODO Download and load save
// TODO config menu

const INIT_MONEY = 1000
const MANUAL_CRAFTING_FACTOR = 20

export default class Game {
    public readonly factory: Factory
    public readonly inventory: Inventory
    public readonly manualMachines: Machine[]
    private _money: number

    public get money (): number {
        return this._money
    }

    public constructor (factory?: Factory, money?: number, inventory?: Inventory) {
        if (factory !== undefined) {
            this.factory = factory
        } else {
            this.factory = new Factory()
        }
        if (money !== undefined) {
            this._money = money
        } else {
            this._money = INIT_MONEY
        }
        if (inventory !== undefined) {
            this.inventory = inventory
        } else {
            this.inventory = new Inventory()
        }
        this.manualMachines = Ressources.getMachineCrafts().map((machineCraft) => {
            const m = new Machine(machineCraft.name, machineCraft.outputCraft)
            m.active = false
            return m
        })
    }

    public tryConsumeMachineCraft (craft: MachineCraft, factory: Factory): boolean {
        if (craft.canCraft(this.inventory)) {
            craft.input.forEach((ingredient) => {
                const cost = ingredient.quantityPerSecond
                this.inventory.removeItem(ingredient.item, cost)
            })
            factory.buildMachine(craft)
            return true
        } else {
            return false
        }
    }

    private tryConsumeCraft (craft: Craft, productionTimeInSec: number): boolean {
        if (craft.canCraft(this.inventory, productionTimeInSec)) {
            craft.input.forEach((ingredient) => {
                const cost = ingredient.quantityPerSecond * productionTimeInSec
                this.inventory.removeItem(ingredient.item, cost)
            })
            craft.output.forEach((ingredient) => {
                this.inventory.addItem(ingredient.item, ingredient.quantityPerSecond * productionTimeInSec)
            })
            return true
        } else {
            return false
        }
    }

    private tryConsumeManualCraft (machine: Machine, productionTimeInSec: number): boolean {
        if (machine.active) {
            return this.tryConsumeCraft(machine.craft, productionTimeInSec * MANUAL_CRAFTING_FACTOR)
        } else {
            return false
        }
    }

    private tryConsumeFactory (factory: Factory, productionTimeInSec: number): boolean {
        const [inputs, outputs] = Ingredient.simplifyIngredient(factory.inputs, factory.outputs)
        console.log(factory.inputs)
        const success = this.tryConsumeCraft(new Craft('temp', 'temp', inputs, outputs), productionTimeInSec)
        if (!success) {
            factory.machines.forEach((m) => {
                m.active = this.tryConsumeCraft(m.craft, productionTimeInSec)
            })
            factory.factories.forEach((f) => {
                this.tryConsumeFactory(f, productionTimeInSec)
            })
            factory.updateInputsAndOutputs()
            console.log('update factory')
        }
        return success
    }

    public update (delta: number): void {
        const deltaSecond = delta / 1000
        this.manualMachines.forEach((m) => {
            m.active = this.tryConsumeManualCraft(m, deltaSecond)
        })
        this.tryConsumeFactory(this.factory, deltaSecond)
    }

    public cheatMoney (): void {
        this._money += 1000
    }
};
