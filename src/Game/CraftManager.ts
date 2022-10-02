import Craft from './Craft'
import Ingredient from './Ingredient'
import MachineCraft from './MachineCraft'
import Ressources from './Resources/Ressources'
import rawCrafts from './Resources/Crafts.json'
import rawMachineCrafts from './Resources/MachineCrafts.json'

export default class CraftManager {
    private _customCrafts: Craft[]
    private _customMachineCrafts: MachineCraft[]

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
        if (this.craftExist(craft.id)) {
            throw new Error(`craft id "${craft.id}" alrealy exist`)
        }
        this._customCrafts.push(craft)
        this.updateCraftList()
    }

    public addMachineCraft (machineCraft: MachineCraft): void {
        if (this.machineCraftExist(machineCraft.id)) {
            throw new Error(`MachineCraft id "${machineCraft.id}" alrealy exist`)
        }
        this._customMachineCrafts.push(machineCraft)
        this.updateMachineCraftList()
    }

    public removeCraft (craftId: string): void {
        this._customCrafts = this._customCrafts.filter((elem) => {
            return elem.id !== craftId
        })
        this.updateCraftList()
    }

    public removeMachineCraft (machineCraftId: string): void {
        this._customMachineCrafts = this._customMachineCrafts.filter((elem) => {
            return elem.id !== machineCraftId
        })
        this.updateMachineCraftList()
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

    private craftExist (id: string): boolean {
        return this.crafts.filter((craft) => craft.id === id).length > 0
    }

    private machineCraftExist (id: string): boolean {
        return this.machineCrafts.filter((craft) => craft.id === id).length > 0
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

    public static getBasicCrafts (): Craft[] {
        return rawCrafts.map((rawCraft: any) => {
            const input: Ingredient[] = rawCraft.input.map((rawItemStack: any) => new Ingredient(Ressources.getItemById(rawItemStack.itemId), rawItemStack.quantity))
            const outputItems: Ingredient[] = rawCraft.output.map((rawItemStack: any) => new Ingredient(Ressources.getItemById(rawItemStack.itemId), rawItemStack.quantity))
            return new Craft(rawCraft.id, rawCraft.name, input, outputItems, false)
        })
    }

    public static getBasicMachineCrafts (): MachineCraft[] {
        return rawMachineCrafts.map((rawCraft: any) => {
            const input = rawCraft.input.map((rawItemStack: any) => new Ingredient(Ressources.getItemById(rawItemStack.itemId), rawItemStack.quantity))
            return new MachineCraft(rawCraft.id, rawCraft.name, false, input, undefined, rawCraft.output)
        })
    }
}
