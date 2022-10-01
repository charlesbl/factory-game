import Game from '../Game'
import Saveable from './Saveable'
import FactorySave from './FactorySave'
import InventorySave from './InventorySave'
import CraftManagerSave from './CraftManagerSave'

export default class GameSave extends Saveable<Game> {
    private factory!: FactorySave
    private money!: number
    private inventory!: InventorySave
    private gameRessources!: CraftManagerSave

    public constructor (obj?: Game, blob?: GameSave) {
        super()
        this.init(obj, blob)
    }

    protected fromObj = (game: Game): void => {
        this.factory = new FactorySave(game.factory)
        this.money = game.money
        this.inventory = new InventorySave(game.inventory)
        this.gameRessources = new CraftManagerSave(game.craftManager)
    }

    protected fromSave = (blob: GameSave): void => {
        this.factory = new FactorySave(undefined, blob.factory)
        this.money = blob.money
        this.inventory = new InventorySave(undefined, blob.inventory)
        this.gameRessources = new CraftManagerSave(undefined, blob.gameRessources)
    }

    public getObj = (): Game => {
        const gameRessources = this.gameRessources.getObj()
        return new Game(this.factory.getObj(gameRessources), this.money, this.inventory.getObj(), gameRessources)
    }
}
