import Game from '../Game'
import Saveable from './Saveable'
import FactorySave from './FactorySave'
import InventorySave from './InventorySave'

export default class GameSave extends Saveable<Game> {
    factory!: FactorySave
    money!: number
    inventory!: InventorySave

    constructor (obj?: Game, blob?: any) {
        super()
        this.init(obj, blob)
    }

    fromObj = (game: Game): void => {
        this.factory = new FactorySave(game.factory)
        this.money = game.money
        this.inventory = new InventorySave(game.inventory)
    }

    fromSave = (blob: Game): void => {
        this.factory = new FactorySave(undefined, blob.factory)
        this.money = blob.money
        this.inventory = new InventorySave(undefined, blob.inventory)
    }

    getObj = (): Game => {
        return new Game(this.factory.getObj(), this.money)
    }
}
