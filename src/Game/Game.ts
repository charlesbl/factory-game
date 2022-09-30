import Factory from './Factory'
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

    public update (delta: number): void {
        const deltaSecond = delta / 1000
        this.manualMachines.forEach((m) => {
            if (m.active) {
                m.craft.input.forEach((ingredient) => {
                    this.inventory.removeItem(ingredient.item, ingredient.quantityPerSecond * deltaSecond)
                })
                m.craft.output.forEach((ingredient) => {
                    this.inventory.addItem(ingredient.item, ingredient.quantityPerSecond * deltaSecond)
                })
            }
        })

        this.factory.inputs.forEach((ingredient) => {
            this.inventory.removeItem(ingredient.item, ingredient.quantityPerSecond * deltaSecond)
        })
        this.factory.outputs.forEach((ingredient) => {
            this.inventory.addItem(ingredient.item, ingredient.quantityPerSecond * deltaSecond)
        })
    }

    public cheatMoney (): void {
        this._money += 1000
    }
};
