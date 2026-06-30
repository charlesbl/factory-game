import Craft from './Craft'
import Factory from './Factory'
import CraftManager from './CraftManager'
import Ingredient from './Ingredient'
import Inventory from './Inventory'
import Machine from './Machine'
import Ressources from './Resources/Ressources'

// TODO View for create/edit/delete custom machines
// TODO Construction time for machines and factories
// TODO rework crafts
// TODO Download and load save
// TODO config menu

const MANUAL_CRAFTING_FACTOR = 20

export default class Game {
    public readonly factory: Factory
    public readonly inventory: Inventory
    public readonly manualMachines: Machine[]
    private readonly _craftManager: CraftManager

    public get craftManager (): CraftManager {
        return this._craftManager
    }

    public constructor (factory?: Factory, inventory?: Inventory, craftManager?: CraftManager) {
        if (factory !== undefined) {
            this.factory = factory
        } else {
            this.factory = new Factory()
            this.factory.name = 'Usine principale'
        }

        if (inventory !== undefined) {
            this.inventory = inventory
        } else {
            this.inventory = new Inventory()
        }

        if (craftManager !== undefined) {
            this._craftManager = craftManager
        } else {
            this._craftManager = new CraftManager([], [])
        }

        this.manualMachines = CraftManager.getBasicMachineCrafts().map((machineCraft) => {
            const m = new Machine(machineCraft)
            m.active = false
            return m
        })
    }

    private tryConsumeManualCraft (machine: Machine, productionTimeInSec: number): boolean {
        if (machine.active) {
            return machine.craft.tryConsumeCraft(this.inventory, productionTimeInSec * MANUAL_CRAFTING_FACTOR)
        } else {
            return false
        }
    }

    private tryConsumeFactory (factory: Factory, productionTimeInSec: number): boolean {
        const [inputs, outputs] = Ingredient.simplifyIngredient(factory.inputs, factory.outputs)
        const success = new Craft('temp', 'temp', inputs, outputs, true).tryConsumeCraft(this.inventory, productionTimeInSec)
        if (!success) {
            factory.machines.forEach((m) => {
                m.active = m.craft.tryConsumeCraft(this.inventory, productionTimeInSec)
            })
            factory.factories.forEach((f) => {
                this.tryConsumeFactory(f, productionTimeInSec)
            })
            factory.updateInputsAndOutputs()
        }
        return success
    }

    public update (delta: number): void {
        const deltaSecond = delta / 1000
        this.manualMachines.forEach((m) => {
            m.active = this.tryConsumeManualCraft(m, deltaSecond)
        })
        this.tryConsumeFactory(this.factory, deltaSecond)
    }

    public grantResources (): void {
        Ressources.getItems().forEach((i) => this.inventory.addItem(i, 100))
    }
};
