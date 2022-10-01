import Craft from './Craft'
import Ingredient from './Ingredient'
import MachineCraft from './MachineCraft'
import Ressources from './Resources/Ressources'
import rawCrafts from './Resources/Crafts.json'
import rawMachineCrafts from './Resources/MachineCrafts.json'

export default class CraftManager {
    private readonly _customCrafts: Craft[]
    private readonly _customMachineCrafts: MachineCraft[]

    private _crafts: Craft[]
    private _machineCrafts: MachineCraft[]

    public get crafts (): Craft[] {
        return this._crafts
    }

    public get machineCrafts (): MachineCraft[] {
        return this._machineCrafts
    }

    public get customCrafts (): Craft[] {
        return this._customCrafts
    }

    public get customMachineCrafts (): MachineCraft[] {
        return this._customMachineCrafts
    }

    public constructor (customCrafts: Craft[], customMachineCrafts: MachineCraft[]) {
        this._customCrafts = customCrafts
        this._customMachineCrafts = customMachineCrafts

        this._crafts = []
        this._machineCrafts = []
        this.updateCraftList()
        this.updateMachineCraftList()
    }

    private updateCraftList (): void {
        this._crafts = [...CraftManager.getBasicCrafts(), ...this._customCrafts]
    }

    private updateMachineCraftList (): void {
        this._machineCrafts = [...CraftManager.getBasicMachineCrafts(), ...this._customMachineCrafts]
    }

    public addCraft (craft: Craft): void {
        // TODO check if id exist
        this._customCrafts.push(craft)
        this.updateCraftList()
    }

    public removeCraft (craftId: string): void {
        // TODO
        this.updateCraftList()
        throw new Error('Not implemented')
    }

    public addMachineCraft (machineCraft: MachineCraft): void {
        // TODO check if id exist
        this._customMachineCrafts.push(machineCraft)
        this.updateMachineCraftList()
    }

    public removeMachineCraft (machineCraftId: string): void {
        // TODO

        this.updateMachineCraftList()
        throw new Error('Not implemented')
    }

    public getCraftById (id: string): Craft {
        return CraftManager.getCraftByIdInList(this._crafts, id)
    }

    public getMachineCraftById (id: string): MachineCraft {
        const req = this.machineCrafts.filter((craft) => craft.id === id)
        if (req.length !== 1) {
            throw new Error(`MachineCraft id "${id}" found ${req.length} times`)
        }
        return req[0]
    }

    private static getCraftByIdInList (crafts: Craft[], id: string): Craft {
        const req = crafts.filter((craft) => craft.id === id)
        if (req.length !== 1) {
            throw new Error(`Craft id "${id}" found ${req.length} times`)
        }
        return req[0]
    }

    public static getBasicCraftById (id: string): Craft {
        return this.getCraftByIdInList(CraftManager.getBasicCrafts(), id)
    }

    private static getBasicCrafts (): Craft[] {
        return rawCrafts.map((rawCraft: any) => {
            const input: Ingredient[] = rawCraft.input.map((rawItemStack: any) => new Ingredient(Ressources.getItemById(rawItemStack.itemId), rawItemStack.quantity))
            const outputItems: Ingredient[] = rawCraft.output.map((rawItemStack: any) => new Ingredient(Ressources.getItemById(rawItemStack.itemId), rawItemStack.quantity))
            return new Craft(rawCraft.id, rawCraft.name, input, outputItems)
        })
    }

    private static getBasicMachineCrafts (): MachineCraft[] {
        return rawMachineCrafts.map((rawCraft: any) => {
            const input = rawCraft.input.map((rawItemStack: any) => new Ingredient(Ressources.getItemById(rawItemStack.itemId), rawItemStack.quantity))
            return new MachineCraft(rawCraft.id, rawCraft.name, input, undefined, rawCraft.output)
        })
    }
}
