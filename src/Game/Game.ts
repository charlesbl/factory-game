import Factory from './Factory'
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

    constructor (factory?: Factory, money?: number, initManualMachine: boolean = true) {
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
        if (initManualMachine) {
            Ressources.MachineCrafts.forEach((machineCraft) => this._factory.buildMachine(machineCraft, true))
        }
    }

    update (): void {
        // TODO update unique game inventory using the factory
    }

    public get factory (): Factory {
        return this._factory
    }

    public get money (): number {
        return this._money
    }

    public cheatMoney (): void {
        this._money += 1000
    }
};
