import Game from '../Game'
import Saveable from './Saveable'
import FactorySave from './FactorySave'

export default class GameSave extends Saveable<Game> {
    factory!: FactorySave
    money!: number

    constructor (obj?: Game, blob?: any) {
        super()
        this.init(obj, blob)
    }

    fromObj = (game: Game): void => {
        this.factory = new FactorySave(game.factory)
        this.money = game.money
    }

    fromSave = (blob: Game): void => {
        this.factory = new FactorySave(undefined, blob.factory)
        this.money = blob.money
    }

    getObj = (): Game => {
        return new Game(this.factory.getObj(), this.money)
    }
}
