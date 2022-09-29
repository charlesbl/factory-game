import Factory from './Factory'
import Inventory from './Inventory'
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

    public get factory (): Factory {
        return this._factory
    }

    public get money (): number {
        return this._money
    }

    public get inventory (): Inventory {
        return this._inventory
    }

    constructor (factory?: Factory, money?: number, inventory?: Inventory, initManualMachine: boolean = false) {
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
        if (initManualMachine) {
            Ressources.MachineCrafts.forEach((machineCraft) => this._factory.buildMachine(machineCraft, true))
        }
    }

    update (): void {
        // TODO update unique game inventory using the factory
    }

    public cheatMoney (): void {
        this._money += 1000
    }
};
