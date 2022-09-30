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
    private readonly _factory: Factory
    private _money: number
    private readonly _inventory: Inventory
    private readonly _manualMachines: ManualMachine[]

    public get factory (): Factory {
        return this._factory
    }

    public get money (): number {
        return this._money
    }

    public get inventory (): Inventory {
        return this._inventory
    }

    public get manualMachines (): ManualMachine[] {
        return this._manualMachines
    }

    constructor (factory?: Factory, money?: number, inventory?: Inventory) {
        if (factory !== undefined) {
            this._factory = factory
        } else {
            this._factory = new Factory()
        }
        if (money !== undefined) {
            this._money = money
        } else {
            this._money = INIT_MONEY
        }
        if (inventory !== undefined) {
            this._inventory = inventory
        } else {
            this._inventory = new Inventory()
        }
        this._manualMachines = Ressources.getMachineCrafts().map((machineCraft) => new ManualMachine(machineCraft.name, machineCraft.outputCraft))
    }

    update (delta: number): void {
        const deltaSecond = delta / 1000
        // TODO update unique game inventory using the factory
        this._manualMachines.forEach((m) => {
            if (m.active) {
                m.craft.input.forEach((ingredient) => {
                    this._inventory.removeItem(ingredient.item, ingredient.quantityPerSecond * deltaSecond)
                })
                m.craft.output.forEach((ingredient) => {
                    this._inventory.addItem(ingredient.item, ingredient.quantityPerSecond * deltaSecond)
                })
            }
        })

        this._factory.inputs.forEach((ingredient) => {
            this._inventory.removeItem(ingredient.item, ingredient.quantityPerSecond * deltaSecond)
        })
        this._factory.outputs.forEach((ingredient) => {
            this._inventory.addItem(ingredient.item, ingredient.quantityPerSecond * deltaSecond)
        })
    }

    public cheatMoney (): void {
        this._money += 1000
    }
};
