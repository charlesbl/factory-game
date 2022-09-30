import Factory from './Factory'
import Ingredient from './Ingredient'
import Inventory from './Inventory'
import ManualMachine from './ManualMachine'
import Ressources from './Resources/Ressources'

// TODO Rename Factory
// TODO Energy system
// TODO rework crafts
// TODO Download and load save
// TODO config menu

const INIT_MONEY = 1000

export default class Game {
    public readonly factory: Factory
    public readonly inventory: Inventory
    public readonly manualMachines: ManualMachine[]
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
        this.manualMachines = Ressources.getMachineCrafts().map((machineCraft) => new ManualMachine(machineCraft.name, machineCraft.outputCraft))
    }

    private canCraft (input: Ingredient[], productionTimeInSec: number): boolean {
        let ressourcesAvailable = true
        input.forEach((ingredient) => {
            const cost = ingredient.quantityPerSecond * productionTimeInSec
            if (this.inventory.getQuantity(ingredient.item) < cost) {
                ressourcesAvailable = false
            }
        })
        return ressourcesAvailable
    }

    private tryConsumeCraft (input: Ingredient[], output: Ingredient[], productionTimeInSec: number): boolean {
        if (this.canCraft(input, productionTimeInSec)) {
            input.forEach((ingredient) => {
                const cost = ingredient.quantityPerSecond * productionTimeInSec
                this.inventory.removeItem(ingredient.item, cost)
            })
            output.forEach((ingredient) => {
                this.inventory.addItem(ingredient.item, ingredient.quantityPerSecond * productionTimeInSec)
            })
            return true
        } else {
            return false
        }
    }

    private tryConsumeManualCraft (machine: ManualMachine, productionTimeInSec: number): boolean {
        if (machine.active) {
            return this.tryConsumeCraft(machine.craft.input, machine.craft.output, productionTimeInSec * 10)
        } else {
            return false
        }
    }

    private tryConsumeFactory (factory: Factory, productionTimeInSec: number): boolean {
        const success = this.tryConsumeCraft(factory.inputs, factory.outputs, productionTimeInSec)
        // if (!success) {
        //     factory.machines.forEach((m) => {
        //         this.tryConsumeCraft(m, productionTimeInSec)
        //     })
        //     factory.factories.forEach((f) => {
        //         this.tryConsumeFactory(f, productionTimeInSec)
        //     })
        // }
        console.log(success)
        return success
    }

    public update (delta: number): void {
        const deltaSecond = delta / 1000
        this.manualMachines.forEach((m) => {
            const success = this.tryConsumeManualCraft(m, deltaSecond)
            if (!success) {
                m.active = false
            }
        })
        this.factory.machines.forEach((m) => {
            this.tryConsumeCraft(m.craft.input, m.craft.output, deltaSecond)
        })
        this.factory.factories.forEach((f) => {
            this.tryConsumeFactory(f, deltaSecond)
        })
    }

    public cheatMoney (): void {
        this._money += 1000
    }
};
